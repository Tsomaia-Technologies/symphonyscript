// =============================================================================
// SymphonyScript - Builder-to-VM Compiler (RFC-040)
// =============================================================================

import { OP } from '../vm/constants'
import { BUILDER_OP } from './constants'
import type {
  ExtractedEvent,
  HumanizeContext,
  QuantizeContext,
  GrooveContext
} from './types'

/**
 * Result of bytecode-to-bytecode compilation.
 */
export interface CompileResult {
  /** VM bytecode (relative timing) */
  vmBuf: number[]
  /** Total ticks (for TOTAL_LENGTH register) */
  totalTicks: number
}

/**
 * Compile Builder Bytecode to VM Bytecode.
 * 
 * 5-Phase compilation:
 * 1. Extract events with transform contexts (atomic overrides block)
 * 2. Apply transforms (Quantize → Groove → Humanize)
 * 3. Sort by final tick
 * 4. Emit VM bytecode with REST gaps
 * 5. Return result (SharedArrayBuffer created by caller)
 * 
 * @param builderBuf - Builder bytecode buffer
 * @param ppq - Pulses per quarter note
 * @param seed - Seed for deterministic humanization
 * @param grooveTemplates - Registered groove templates for atomic groove
 */
export function compileBuilderToVM(
  builderBuf: number[],
  ppq: number,
  seed: number,
  grooveTemplates: readonly number[][]
): CompileResult {
  // Phase 1: Extract events with transform contexts
  const { events, structural } = extractEvents(builderBuf, grooveTemplates)

  // Phase 2: Apply transforms (Quantize → Groove → Humanize)
  for (const event of events) {
    event.finalTick = applyTransforms(event, ppq, seed)
  }

  // Phase 3: Sort by final tick
  events.sort((a, b) => (a.finalTick ?? a.tick) - (b.finalTick ?? b.tick))

  // Phase 4: Emit VM bytecode with REST gaps
  const vmBuf = emitVMBytecode(events, structural)

  // Calculate total ticks
  let totalTicks = 0
  for (const event of events) {
    const tick = event.finalTick ?? event.tick
    if (event.opcode === OP.NOTE) {
      const endTick = tick + event.args[2] // duration is args[2]
      if (endTick > totalTicks) totalTicks = endTick
    } else if (tick > totalTicks) {
      totalTicks = tick
    }
  }

  return { vmBuf, totalTicks }
}

// =============================================================================
// Phase 1: Extract Events
// =============================================================================

interface ExtractionResult {
  events: ExtractedEvent[]
  structural: StructuralOp[]
}

interface StructuralOp {
  opcode: number
  position: number // original buffer position for ordering
  args: number[]
}

/**
 * Extract events from Builder bytecode with transform contexts.
 * Atomic modifiers (NOTE_MOD_*) override block context.
 */
function extractEvents(
  buf: number[],
  grooveTemplates: readonly number[][]
): ExtractionResult {
  const events: ExtractedEvent[] = []
  const structural: StructuralOp[] = []

  // Context stacks for block-scoped transforms
  const humanizeStack: HumanizeContext[] = []
  const quantizeStack: QuantizeContext[] = []
  const grooveStack: GrooveContext[] = []

  let i = 0
  let eventIndex = 0

  while (i < buf.length) {
    const opcode = buf[i]

    switch (opcode) {
      // --- Transform Context (Block-Scoped) ---
      case BUILDER_OP.HUMANIZE_PUSH:
        humanizeStack.push({
          timingPpt: buf[i + 1],
          velocityPpt: buf[i + 2]
        })
        i += 3
        break

      case BUILDER_OP.HUMANIZE_POP:
        humanizeStack.pop()
        i += 1
        break

      case BUILDER_OP.QUANTIZE_PUSH:
        quantizeStack.push({
          gridTicks: buf[i + 1],
          strengthPct: buf[i + 2]
        })
        i += 3
        break

      case BUILDER_OP.QUANTIZE_POP:
        quantizeStack.pop()
        i += 1
        break

      case BUILDER_OP.GROOVE_PUSH: {
        const len = buf[i + 1]
        const offsets = buf.slice(i + 2, i + 2 + len)
        grooveStack.push({ offsets })
        i += 2 + len
        break
      }

      case BUILDER_OP.GROOVE_POP:
        grooveStack.pop()
        i += 1
        break

      // --- Event: NOTE ---
      case OP.NOTE: {
        // Builder NOTE: [opcode, tick, pitch, vel, dur]
        const event: ExtractedEvent = {
          opcode: OP.NOTE,
          tick: buf[i + 1],
          args: [buf[i + 2], buf[i + 3], buf[i + 4]], // pitch, vel, dur
          originalIndex: eventIndex++,
          // Start with block context
          humanizeContext: humanizeStack.length > 0
            ? { ...humanizeStack[humanizeStack.length - 1] }
            : undefined,
          quantizeContext: quantizeStack.length > 0
            ? { ...quantizeStack[quantizeStack.length - 1] }
            : undefined,
          grooveContext: grooveStack.length > 0
            ? { offsets: [...grooveStack[grooveStack.length - 1].offsets] }
            : undefined
        }
        i += 5

        // Check for NOTE_MOD_* following NOTE — ATOMIC OVERRIDES BLOCK
        while (i < buf.length) {
          const nextOp = buf[i]
          if (nextOp === BUILDER_OP.NOTE_MOD_HUMANIZE) {
            event.humanizeContext = {
              timingPpt: buf[i + 1],
              velocityPpt: buf[i + 2]
            }
            i += 3
          } else if (nextOp === BUILDER_OP.NOTE_MOD_QUANTIZE) {
            event.quantizeContext = {
              gridTicks: buf[i + 1],
              strengthPct: buf[i + 2]
            }
            i += 3
          } else if (nextOp === BUILDER_OP.NOTE_MOD_GROOVE) {
            const grooveIdx = buf[i + 1]
            if (grooveIdx < grooveTemplates.length) {
              event.grooveContext = {
                offsets: [...grooveTemplates[grooveIdx]]
              }
            }
            i += 2
          } else {
            break // Not a NOTE_MOD_*, stop scanning
          }
        }

        events.push(event)
        break
      }

      // --- Event: REST ---
      case OP.REST: {
        // Builder REST: [opcode, tick, dur]
        events.push({
          opcode: OP.REST,
          tick: buf[i + 1],
          args: [buf[i + 2]], // dur
          originalIndex: eventIndex++
        })
        i += 3
        break
      }

      // --- Event: TEMPO ---
      case OP.TEMPO: {
        // Builder TEMPO: [opcode, tick, bpm]
        events.push({
          opcode: OP.TEMPO,
          tick: buf[i + 1],
          args: [buf[i + 2]], // bpm
          originalIndex: eventIndex++
        })
        i += 3
        break
      }

      // --- Event: CC ---
      case OP.CC: {
        // Builder CC: [opcode, tick, ctrl, val]
        events.push({
          opcode: OP.CC,
          tick: buf[i + 1],
          args: [buf[i + 2], buf[i + 3]], // ctrl, val
          originalIndex: eventIndex++
        })
        i += 4
        break
      }

      // --- Event: BEND ---
      case OP.BEND: {
        // Builder BEND: [opcode, tick, val]
        events.push({
          opcode: OP.BEND,
          tick: buf[i + 1],
          args: [buf[i + 2]], // val
          originalIndex: eventIndex++
        })
        i += 3
        break
      }

      // --- Structural: LOOP_START ---
      case OP.LOOP_START: {
        // Builder LOOP_START: [opcode, tick, count]
        structural.push({
          opcode: OP.LOOP_START,
          position: i,
          args: [buf[i + 2]] // count (tick not needed in VM)
        })
        i += 3
        break
      }

      // --- Structural: LOOP_END ---
      case OP.LOOP_END:
        structural.push({
          opcode: OP.LOOP_END,
          position: i,
          args: []
        })
        i += 1
        break

      // --- Structural: STACK_START ---
      case OP.STACK_START: {
        // Builder STACK_START: [opcode, tick, count]
        structural.push({
          opcode: OP.STACK_START,
          position: i,
          args: [buf[i + 2]] // count (tick not needed in VM)
        })
        i += 3
        break
      }

      // --- Structural: STACK_END ---
      case OP.STACK_END:
        structural.push({
          opcode: OP.STACK_END,
          position: i,
          args: []
        })
        i += 1
        break

      // --- Structural: BRANCH_START ---
      case OP.BRANCH_START:
        structural.push({
          opcode: OP.BRANCH_START,
          position: i,
          args: []
        })
        i += 1
        break

      // --- Structural: BRANCH_END ---
      case OP.BRANCH_END:
        structural.push({
          opcode: OP.BRANCH_END,
          position: i,
          args: []
        })
        i += 1
        break

      default:
        // Unknown opcode, skip
        i += 1
        break
    }
  }

  return { events, structural }
}

// =============================================================================
// Phase 2: Apply Transforms
// =============================================================================

/**
 * Simple seeded random number generator (Mulberry32).
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Apply transforms to an event in pipeline order: Quantize → Groove → Humanize.
 * 
 * @returns Final tick position after all transforms
 */
function applyTransforms(
  event: ExtractedEvent,
  ppq: number,
  seed: number
): number {
  let tick = event.tick
  const random = seededRandom(seed + event.originalIndex)

  // 1. QUANTIZE (snap to grid)
  if (event.quantizeContext) {
    const { gridTicks, strengthPct } = event.quantizeContext
    if (gridTicks > 0) {
      const quantized = Math.round(tick / gridTicks) * gridTicks
      tick = tick + Math.round((quantized - tick) * strengthPct / 100)
    }
  }

  // 2. GROOVE (systematic offset based on beat position)
  if (event.grooveContext && event.grooveContext.offsets.length > 0) {
    const { offsets } = event.grooveContext
    const beatIndex = Math.floor(tick / ppq) % offsets.length
    tick += offsets[beatIndex]
  }

  // 3. HUMANIZE (random variation)
  if (event.humanizeContext) {
    const { timingPpt, velocityPpt } = event.humanizeContext

    // Timing humanization
    if (timingPpt > 0) {
      const maxTimingOffset = (timingPpt / 1000) * ppq
      tick += Math.round((random() - 0.5) * 2 * maxTimingOffset)
    }

    // Velocity humanization (modifies event.args in place)
    if (velocityPpt > 0 && event.opcode === OP.NOTE) {
      const maxVelOffset = (velocityPpt / 1000) * 127
      event.args[1] = Math.max(1, Math.min(127,
        Math.round(event.args[1] + (random() - 0.5) * 2 * maxVelOffset)
      ))
    }
  }

  return Math.max(0, tick)
}

// =============================================================================
// Phase 4: Emit VM Bytecode
// =============================================================================

/**
 * Emit VM bytecode with REST gaps for timing.
 * 
 * For now, structural opcodes (LOOP, STACK, BRANCH) are NOT included
 * because they require more complex handling to interleave with events.
 * This simplified version just emits events with REST gaps.
 * 
 * TODO: Full structural opcode support requires tracking buffer positions
 * and inserting structural markers at the right places in the sorted output.
 */
function emitVMBytecode(
  events: ExtractedEvent[],
  _structural: StructuralOp[]
): number[] {
  const vmBuf: number[] = []
  let currentTick = 0

  for (const event of events) {
    const targetTick = event.finalTick ?? event.tick

    // Insert REST to reach target tick (if needed)
    if (targetTick > currentTick) {
      vmBuf.push(OP.REST, targetTick - currentTick)
      currentTick = targetTick
    }

    // Emit event in VM format (without tick field)
    switch (event.opcode) {
      case OP.NOTE:
        // VM NOTE: [opcode, pitch, vel, dur]
        vmBuf.push(OP.NOTE, event.args[0], event.args[1], event.args[2])
        currentTick += event.args[2] // Advance by duration
        break

      case OP.REST:
        // REST already handled by gap calculation, but if explicit REST...
        // VM REST: [opcode, dur]
        vmBuf.push(OP.REST, event.args[0])
        currentTick += event.args[0]
        break

      case OP.TEMPO:
        // VM TEMPO: [opcode, bpm]
        vmBuf.push(OP.TEMPO, event.args[0])
        break

      case OP.CC:
        // VM CC: [opcode, ctrl, val]
        vmBuf.push(OP.CC, event.args[0], event.args[1])
        break

      case OP.BEND:
        // VM BEND: [opcode, val]
        vmBuf.push(OP.BEND, event.args[0])
        break
    }
  }

  // Add EOF
  vmBuf.push(OP.EOF)

  return vmBuf
}
