// =============================================================================
// SymphonyScript - Bytecode Assembler (RFC-038)
// =============================================================================

import type { ClipNode, ClipOperation, NoteOp } from '../clip/types'
import type { AssemblerOptions } from './types'
import { noteToMidi } from '../util/midi'
import { parseDuration } from '../util/duration'
import {
  SBC_MAGIC,
  SBC_VERSION,
  DEFAULT_PPQ,
  DEFAULT_BPM,
  REG,
  REGION,
  OP,
  EVENT_SIZE,
  TEMPO_ENTRY_SIZE
} from './constants'

// =============================================================================
// Types
// =============================================================================

interface TieState {
  pitch: number
  duration: number
  velocity: number
}

interface AssemblyFrame {
  ops: readonly ClipOperation[]
  pc: number
  loopRemaining?: number
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Assemble a ClipNode into a SharedArrayBuffer containing SBC bytecode.
 * Uses two-pass assembly: first calculates size, then emits bytecode.
 *
 * @param clip - The clip to assemble
 * @param options - Assembly options (bpm, ppq, capacities)
 * @returns SharedArrayBuffer containing the complete VM memory
 */
export function assembleToBytecode(
  clip: ClipNode,
  options: AssemblerOptions = {}
): SharedArrayBuffer {
  const {
    bpm = DEFAULT_BPM,
    ppq = DEFAULT_PPQ,
    eventCapacity = 10000,
    tempoCapacity = 100
  } = options

  // Pass 1: Calculate bytecode size
  const bytecodeSize = calculateBytecodeSize(clip, ppq)

  // Calculate total buffer size
  const eventRegionSize = eventCapacity * EVENT_SIZE
  const tempoRegionSize = tempoCapacity * TEMPO_ENTRY_SIZE
  const totalSize = REGION.BYTECODE + bytecodeSize + eventRegionSize + tempoRegionSize

  // Allocate SharedArrayBuffer (4 bytes per int32)
  const buffer = new SharedArrayBuffer(totalSize * 4)
  const memory = new Int32Array(buffer)

  // Write header registers
  memory[REG.MAGIC] = SBC_MAGIC
  memory[REG.VERSION] = SBC_VERSION
  memory[REG.PPQ] = ppq
  memory[REG.BPM] = bpm
  memory[REG.BYTECODE_START] = REGION.BYTECODE
  memory[REG.BYTECODE_END] = REGION.BYTECODE + bytecodeSize
  memory[REG.EVENT_START] = REGION.BYTECODE + bytecodeSize
  memory[REG.EVENT_CAPACITY] = eventCapacity
  memory[REG.TEMPO_START] = REGION.BYTECODE + bytecodeSize + eventRegionSize
  memory[REG.TEMPO_CAPACITY] = tempoCapacity

  // Initialize execution state registers
  memory[REG.PC] = REGION.BYTECODE
  memory[REG.TICK] = 0
  memory[REG.STATE] = 0x00 // IDLE
  memory[REG.STACK_SP] = 0
  memory[REG.LOOP_SP] = 0
  memory[REG.TRANS_SP] = 0
  memory[REG.TRANSPOSITION] = 0
  memory[REG.EVENT_WRITE] = 0
  memory[REG.EVENT_READ] = 0
  memory[REG.TEMPO_COUNT] = 0

  // Pass 2: Emit bytecode
  const totalTicks = emitBytecode(memory, clip, ppq)

  // Backpatch total length
  memory[REG.TOTAL_LENGTH] = totalTicks

  return buffer
}

// =============================================================================
// Pass 1: Size Calculation
// =============================================================================

/**
 * Calculate the bytecode size for a clip (in ints).
 */
function calculateBytecodeSize(clip: ClipNode, ppq: number): number {
  let size = 0
  const activeTies = new Map<string, TieState>()

  const stack: AssemblyFrame[] = [{
    ops: clip.operations,
    pc: 0
  }]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]

    if (frame.pc >= frame.ops.length) {
      // Handle loop iteration
      if (frame.loopRemaining !== undefined && frame.loopRemaining > 0) {
        frame.loopRemaining--
        frame.pc = 0
        continue
      }
      stack.pop()
      continue
    }

    const op = frame.ops[frame.pc++]
    size += calculateOpSize(op, activeTies, ppq, stack)
  }

  // Add EOF
  size += 1

  // Emit any remaining tied notes
  for (const [,] of activeTies) {
    size += 4 // NOTE opcode + pitch + vel + dur
  }

  return size
}

/**
 * Calculate size of a single operation.
 */
function calculateOpSize(
  op: ClipOperation,
  activeTies: Map<string, TieState>,
  ppq: number,
  stack: AssemblyFrame[]
): number {
  switch (op.kind) {
    case 'note': {
      const noteOp = op as NoteOp
      const key = tieKey(noteOp)
      const durationTicks = durationToTicks(noteOp.duration, ppq)

      if (noteOp.tie === 'start') {
        // Start tie - store state, no emit yet
        const pitch = noteToMidi(noteOp.note) ?? 60
        activeTies.set(key, {
          pitch,
          duration: durationTicks,
          velocity: Math.round(noteOp.velocity * 127)
        })
        return 0
      } else if (noteOp.tie === 'continue') {
        // Continue tie - extend duration
        const active = activeTies.get(key)
        if (active) {
          active.duration += durationTicks
        }
        return 0
      } else if (noteOp.tie === 'end') {
        // End tie - will emit merged note
        const active = activeTies.get(key)
        if (active) {
          active.duration += durationTicks
          activeTies.delete(key)
          return 4 // NOTE opcode + pitch + vel + dur
        }
        // Orphaned end - emit as regular note
        return 4
      }
      // Regular note
      return 4 // NOTE opcode + pitch + vel + dur
    }

    case 'rest':
      return 2 // REST opcode + dur

    case 'tempo':
      return 2 // TEMPO opcode + bpm

    case 'control':
      return 3 // CC opcode + ctrl + val

    case 'pitch_bend':
      return 2 // BEND opcode + val

    case 'transpose': {
      // TRANSPOSE wrapper: TRANSPOSE(n) + inner op + TRANSPOSE(0)
      // Calculate inner op size recursively (inline, not via stack)
      const innerSize = calculateOpSize(op.operation, activeTies, ppq, stack)
      return 2 + innerSize + 2 // TRANSPOSE(n) + inner + TRANSPOSE(0)
    }

    case 'stack': {
      // STACK_START + (BRANCH_START + BRANCH_END) × N + STACK_END
      let size = 2 // STACK_START count
      for (const child of op.operations) {
        size += 1 // BRANCH_START
        // Push child for size calculation
        stack.push({ ops: [child], pc: 0 })
        size += 1 // BRANCH_END
      }
      size += 1 // STACK_END
      return size
    }

    case 'loop': {
      if (op.count <= 0) {
        // Skip loop body
        return 2 // LOOP_START + count (will skip)
      }
      // LOOP_START + body × count + LOOP_END
      let size = 2 // LOOP_START count
      // Push loop body for size calculation with count
      stack.push({
        ops: op.operations,
        pc: 0,
        loopRemaining: op.count - 1
      })
      size += 1 // LOOP_END
      return size
    }

    case 'clip':
      // Nested clip - push its operations
      stack.push({ ops: op.clip.operations, pc: 0 })
      return 0

    // Unsupported operations (skip)
    case 'dynamics':
    case 'aftertouch':
    case 'vibrato':
    case 'automation':
    case 'block':
    case 'scope':
    case 'time_signature':
      return 0

    default:
      return 0
  }
}

// =============================================================================
// Pass 2: Bytecode Emission
// =============================================================================

/**
 * Emit bytecode to memory and return total ticks.
 */
function emitBytecode(memory: Int32Array, clip: ClipNode, ppq: number): number {
  let pc: number = REGION.BYTECODE
  let currentTick = 0
  const activeTies = new Map<string, TieState>()

  const stack: AssemblyFrame[] = [{
    ops: clip.operations,
    pc: 0
  }]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]

    if (frame.pc >= frame.ops.length) {
      // Handle loop iteration
      if (frame.loopRemaining !== undefined && frame.loopRemaining > 0) {
        frame.loopRemaining--
        frame.pc = 0
        continue
      }
      stack.pop()
      continue
    }

    const op = frame.ops[frame.pc++]
    const result = emitOp(memory, pc, op, activeTies, ppq, stack, currentTick)
    pc = result.pc
    currentTick = result.tick
  }

  // Emit any remaining tied notes (orphaned starts)
  for (const [, state] of activeTies) {
    memory[pc++] = OP.NOTE
    memory[pc++] = state.pitch
    memory[pc++] = state.velocity
    memory[pc++] = state.duration
    currentTick += state.duration
  }

  // Emit EOF
  memory[pc++] = OP.EOF

  return currentTick
}

interface EmitResult {
  pc: number
  tick: number
}

/**
 * Emit a single operation to memory.
 */
function emitOp(
  memory: Int32Array,
  pc: number,
  op: ClipOperation,
  activeTies: Map<string, TieState>,
  ppq: number,
  stack: AssemblyFrame[],
  currentTick: number
): EmitResult {
  switch (op.kind) {
    case 'note': {
      const noteOp = op as NoteOp
      const key = tieKey(noteOp)
      const pitch = noteToMidi(noteOp.note) ?? 60
      const velocity = Math.round(noteOp.velocity * 127)
      const durationTicks = durationToTicks(noteOp.duration, ppq)

      if (noteOp.tie === 'start') {
        // Start tie - store state, no emit
        activeTies.set(key, { pitch, duration: durationTicks, velocity })
        return { pc, tick: currentTick }
      } else if (noteOp.tie === 'continue') {
        // Continue tie - extend duration
        const active = activeTies.get(key)
        if (active) {
          active.duration += durationTicks
        }
        return { pc, tick: currentTick }
      } else if (noteOp.tie === 'end') {
        // End tie - emit merged note
        const active = activeTies.get(key)
        if (active) {
          active.duration += durationTicks
          memory[pc++] = OP.NOTE
          memory[pc++] = active.pitch
          memory[pc++] = active.velocity
          memory[pc++] = active.duration
          const newTick = currentTick + active.duration
          activeTies.delete(key)
          return { pc, tick: newTick }
        }
        // Orphaned end - emit as regular note
        memory[pc++] = OP.NOTE
        memory[pc++] = pitch
        memory[pc++] = velocity
        memory[pc++] = durationTicks
        return { pc, tick: currentTick + durationTicks }
      }

      // Regular note
      memory[pc++] = OP.NOTE
      memory[pc++] = pitch
      memory[pc++] = velocity
      memory[pc++] = durationTicks
      return { pc, tick: currentTick + durationTicks }
    }

    case 'rest': {
      const durationTicks = durationToTicks(op.duration, ppq)
      memory[pc++] = OP.REST
      memory[pc++] = durationTicks
      return { pc, tick: currentTick + durationTicks }
    }

    case 'tempo': {
      memory[pc++] = OP.TEMPO
      memory[pc++] = op.bpm
      return { pc, tick: currentTick }
    }

    case 'control': {
      memory[pc++] = OP.CC
      memory[pc++] = op.controller
      memory[pc++] = op.value
      return { pc, tick: currentTick }
    }

    case 'pitch_bend': {
      // Convert semitones to MIDI pitch bend value (0-16383, center 8192)
      // Assuming ±2 semitone range
      const bendValue = Math.round(8192 + (op.semitones / 2) * 8191)
      memory[pc++] = OP.BEND
      memory[pc++] = Math.max(0, Math.min(16383, bendValue))
      return { pc, tick: currentTick }
    }

    case 'transpose': {
      // Emit TRANSPOSE(n) to push new transposition
      memory[pc++] = OP.TRANSPOSE
      memory[pc++] = op.semitones

      // Emit inner operation inline
      const innerResult = emitOp(memory, pc, op.operation, activeTies, ppq, stack, currentTick)
      pc = innerResult.pc
      currentTick = innerResult.tick

      // Emit TRANSPOSE(0) to pop transposition
      memory[pc++] = OP.TRANSPOSE
      memory[pc++] = 0

      return { pc, tick: currentTick }
    }

    case 'stack': {
      // Emit STACK_START with branch count
      memory[pc++] = OP.STACK_START
      memory[pc++] = op.operations.length

      // Flatten: emit BRANCH_START, content, BRANCH_END for each branch
      for (const child of op.operations) {
        memory[pc++] = OP.BRANCH_START

        // Emit child operation inline
        const result = emitOp(memory, pc, child, activeTies, ppq, stack, currentTick)
        pc = result.pc
        // Note: tick doesn't advance between branches (they run in parallel)

        memory[pc++] = OP.BRANCH_END
      }

      memory[pc++] = OP.STACK_END
      return { pc, tick: currentTick } // Tick will be updated by VM at runtime
    }

    case 'loop': {
      memory[pc++] = OP.LOOP_START
      memory[pc++] = op.count

      if (op.count <= 0) {
        // Empty loop - just emit the header (VM will skip)
        memory[pc++] = OP.LOOP_END
        return { pc, tick: currentTick }
      }

      // Emit loop body once (VM handles repetition)
      for (const child of op.operations) {
        const result = emitOp(memory, pc, child, activeTies, ppq, stack, currentTick)
        pc = result.pc
        currentTick = result.tick
      }

      memory[pc++] = OP.LOOP_END
      return { pc, tick: currentTick }
    }

    case 'clip': {
      // Inline nested clip operations
      for (const child of op.clip.operations) {
        const result = emitOp(memory, pc, child, activeTies, ppq, stack, currentTick)
        pc = result.pc
        currentTick = result.tick
      }
      return { pc, tick: currentTick }
    }

    // Unsupported operations (skip)
    case 'dynamics':
    case 'aftertouch':
    case 'vibrato':
    case 'automation':
    case 'block':
    case 'scope':
    case 'time_signature':
      return { pc, tick: currentTick }

    default:
      return { pc, tick: currentTick }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate unique key for tie tracking.
 * Format: ${expressionId}:${note} to prevent voice collisions.
 */
function tieKey(noteOp: NoteOp): string {
  const exprId = noteOp.expressionId ?? 0
  return `${exprId}:${noteOp.note}`
}

/**
 * Convert duration notation to ticks.
 */
function durationToTicks(duration: import('../types/primitives').NoteDuration, ppq: number): number {
  const beats = parseDuration(duration)
  return Math.round(beats * ppq)
}
