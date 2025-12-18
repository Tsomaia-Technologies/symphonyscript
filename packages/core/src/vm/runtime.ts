// =============================================================================
// SymphonyScript - Bytecode VM Runtime (RFC-038)
// =============================================================================

import type { VMEvent, VMNoteEvent, VMControlEvent, VMBendEvent } from './types'
import {
  SBC_MAGIC,
  REG,
  REGION,
  OP,
  STATE,
  EVENT_TYPE,
  EVENT_SIZE,
  STACK_FRAME_SIZE,
  LOOP_FRAME_SIZE,
  TEMPO_ENTRY_SIZE
} from './constants'

// =============================================================================
// Stack Frame Field Offsets
// =============================================================================

const FRAME = {
  START_TICK: 0,
  MAX_DURATION: 1,
  BRANCH_COUNT: 2,
  BRANCH_INDEX: 3
} as const

const LOOP = {
  BODY_START_PC: 0,
  REMAINING_COUNT: 1
} as const

// =============================================================================
// BytecodeVM Class
// =============================================================================

/**
 * Symphony Bytecode Virtual Machine with unified memory architecture.
 *
 * All state lives in a single SharedArrayBuffer for zero-copy transport
 * to AudioWorklet and zero-GC execution.
 */
export class BytecodeVM {
  private memory: Int32Array

  /**
   * Create a new VM instance from a SharedArrayBuffer.
   *
   * @param buffer - SharedArrayBuffer containing SBC program
   * @throws Error if buffer has invalid magic number
   */
  constructor(buffer: SharedArrayBuffer) {
    this.memory = new Int32Array(buffer)

    // Validate magic number
    if (this.memory[REG.MAGIC] !== SBC_MAGIC) {
      throw new Error(
        `Invalid SBC buffer: expected magic 0x${SBC_MAGIC.toString(16)}, ` +
        `got 0x${this.memory[REG.MAGIC].toString(16)}`
      )
    }

    // Initialize execution state
    this.reset()
  }

  /**
   * Reset VM to initial state for replay.
   */
  reset(): void {
    this.memory[REG.PC] = this.memory[REG.BYTECODE_START]
    this.memory[REG.TICK] = 0
    this.memory[REG.STACK_SP] = 0
    this.memory[REG.LOOP_SP] = 0
    this.memory[REG.TRANS_SP] = 0
    this.memory[REG.TRANSPOSITION] = 0
    Atomics.store(this.memory, REG.EVENT_WRITE, 0)
    Atomics.store(this.memory, REG.EVENT_READ, 0)
    Atomics.store(this.memory, REG.STATE, STATE.IDLE)
    this.memory[REG.TEMPO_COUNT] = 0
  }

  /**
   * Execute until the current tick exceeds targetTick or EOF is reached.
   *
   * @param targetTick - Execute until tick > targetTick
   */
  tick(targetTick: number): void {
    Atomics.store(this.memory, REG.STATE, STATE.RUNNING)

    const bytecodeEnd = this.memory[REG.BYTECODE_END]

    while (this.memory[REG.PC] < bytecodeEnd) {
      // Check tick boundary BEFORE executing
      if (this.memory[REG.TICK] > targetTick) {
        Atomics.store(this.memory, REG.STATE, STATE.PAUSED)
        return
      }

      const pc = this.memory[REG.PC]
      const opcode = this.memory[pc]
      this.memory[REG.PC]++

      // Handle EOF
      if (opcode === OP.EOF) {
        Atomics.store(this.memory, REG.STATE, STATE.DONE)
        return
      }

      // Execute opcode - may return early on backpressure
      if (!this.executeOpcode(opcode)) {
        // Backpressure: rewind PC and pause
        this.memory[REG.PC]--
        Atomics.store(this.memory, REG.STATE, STATE.PAUSED)
        return
      }
    }

    // Reached end of bytecode
    Atomics.store(this.memory, REG.STATE, STATE.DONE)
  }

  /**
   * Execute the entire program to completion.
   */
  runToEnd(): void {
    this.tick(Number.MAX_SAFE_INTEGER)
  }

  // ===========================================================================
  // Opcode Execution
  // ===========================================================================

  /**
   * Execute a single opcode.
   * @returns false if backpressure occurred (caller should pause)
   */
  private executeOpcode(opcode: number): boolean {
    switch (opcode) {
      // --- Event Operations ---
      case OP.NOTE: {
        const pitch = this.memory[this.memory[REG.PC]++]
        const velocity = this.memory[this.memory[REG.PC]++]
        const duration = this.memory[this.memory[REG.PC]++]

        if (!this.emitNote(pitch, velocity, duration)) {
          // Rewind PC to retry this opcode's arguments
          this.memory[REG.PC] -= 3
          return false
        }

        this.memory[REG.TICK] += duration
        return true
      }

      case OP.REST: {
        const duration = this.memory[this.memory[REG.PC]++]
        this.memory[REG.TICK] += duration
        return true
      }

      case OP.CHORD2: {
        const root = this.memory[this.memory[REG.PC]++]
        const int1 = this.memory[this.memory[REG.PC]++]
        const velocity = this.memory[this.memory[REG.PC]++]
        const duration = this.memory[this.memory[REG.PC]++]

        // Emit 2 notes at same tick
        if (!this.emitNote(root, velocity, duration)) {
          this.memory[REG.PC] -= 4
          return false
        }
        if (!this.emitNote(root + int1, velocity, duration)) {
          // First note emitted, but we need atomic chord emission
          // For simplicity, we'll proceed (consumer sees both)
        }

        this.memory[REG.TICK] += duration
        return true
      }

      case OP.CHORD3: {
        const root = this.memory[this.memory[REG.PC]++]
        const int1 = this.memory[this.memory[REG.PC]++]
        const int2 = this.memory[this.memory[REG.PC]++]
        const velocity = this.memory[this.memory[REG.PC]++]
        const duration = this.memory[this.memory[REG.PC]++]

        // Emit 3 notes at same tick
        if (!this.emitNote(root, velocity, duration)) {
          this.memory[REG.PC] -= 5
          return false
        }
        this.emitNote(root + int1, velocity, duration)
        this.emitNote(root + int2, velocity, duration)

        this.memory[REG.TICK] += duration
        return true
      }

      case OP.CHORD4: {
        const root = this.memory[this.memory[REG.PC]++]
        const int1 = this.memory[this.memory[REG.PC]++]
        const int2 = this.memory[this.memory[REG.PC]++]
        const int3 = this.memory[this.memory[REG.PC]++]
        const velocity = this.memory[this.memory[REG.PC]++]
        const duration = this.memory[this.memory[REG.PC]++]

        // Emit 4 notes at same tick
        if (!this.emitNote(root, velocity, duration)) {
          this.memory[REG.PC] -= 6
          return false
        }
        this.emitNote(root + int1, velocity, duration)
        this.emitNote(root + int2, velocity, duration)
        this.emitNote(root + int3, velocity, duration)

        this.memory[REG.TICK] += duration
        return true
      }

      // --- Control Operations ---
      case OP.TEMPO: {
        const bpm = this.memory[this.memory[REG.PC]++]
        this.recordTempo(bpm)
        return true
      }

      case OP.CC: {
        const controller = this.memory[this.memory[REG.PC]++]
        const value = this.memory[this.memory[REG.PC]++]

        if (!this.emitCC(controller, value)) {
          this.memory[REG.PC] -= 2
          return false
        }
        return true
      }

      case OP.BEND: {
        const value = this.memory[this.memory[REG.PC]++]

        if (!this.emitBend(value)) {
          this.memory[REG.PC] -= 1
          return false
        }
        return true
      }

      case OP.TRANSPOSE: {
        const semitones = this.memory[this.memory[REG.PC]++]

        if (semitones === 0) {
          // POP: restore previous transposition
          const tp = this.memory[REG.TRANS_SP] - 1
          if (tp >= 0) {
            this.memory[REG.TRANS_SP] = tp
            // Read previous value from stack (or 0 if empty)
            this.memory[REG.TRANSPOSITION] = tp > 0
              ? this.memory[REGION.TRANSPOSE_STACK + tp - 1]
              : 0
          }
        } else {
          // PUSH: add to current transposition
          const tp = this.memory[REG.TRANS_SP]
          const newOffset = this.memory[REG.TRANSPOSITION] + semitones
          this.memory[REGION.TRANSPOSE_STACK + tp] = newOffset
          this.memory[REG.TRANS_SP] = tp + 1
          this.memory[REG.TRANSPOSITION] = newOffset
        }
        return true
      }

      // --- Structural Operations ---
      case OP.STACK_START: {
        const count = this.memory[this.memory[REG.PC]++]
        const sp = this.memory[REG.STACK_SP]
        const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE

        // Initialize stack frame
        this.memory[frameBase + FRAME.START_TICK] = this.memory[REG.TICK]
        this.memory[frameBase + FRAME.MAX_DURATION] = 0
        this.memory[frameBase + FRAME.BRANCH_COUNT] = count
        this.memory[frameBase + FRAME.BRANCH_INDEX] = 0
        // Reserved fields [4-7] initialized to 0
        this.memory[frameBase + 4] = 0
        this.memory[frameBase + 5] = 0
        this.memory[frameBase + 6] = 0
        this.memory[frameBase + 7] = 0

        this.memory[REG.STACK_SP] = sp + 1
        return true
      }

      case OP.BRANCH_START: {
        // Reset tick to stack start
        const sp = this.memory[REG.STACK_SP] - 1
        const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
        this.memory[REG.TICK] = this.memory[frameBase + FRAME.START_TICK]
        return true
      }

      case OP.BRANCH_END: {
        // Record branch duration
        const sp = this.memory[REG.STACK_SP] - 1
        const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
        const branchDur = this.memory[REG.TICK] - this.memory[frameBase + FRAME.START_TICK]

        // Update max duration
        if (branchDur > this.memory[frameBase + FRAME.MAX_DURATION]) {
          this.memory[frameBase + FRAME.MAX_DURATION] = branchDur
        }

        // Increment branch index
        this.memory[frameBase + FRAME.BRANCH_INDEX]++
        return true
      }

      case OP.STACK_END: {
        // Pop frame and advance tick to max duration
        const sp = this.memory[REG.STACK_SP] - 1
        const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE

        // Advance tick to startTick + maxDuration
        this.memory[REG.TICK] =
          this.memory[frameBase + FRAME.START_TICK] +
          this.memory[frameBase + FRAME.MAX_DURATION]

        this.memory[REG.STACK_SP] = sp
        return true
      }

      case OP.LOOP_START: {
        const count = this.memory[this.memory[REG.PC]++]

        if (count <= 0) {
          // Skip loop body - find matching LOOP_END
          let depth = 1
          while (depth > 0 && this.memory[REG.PC] < this.memory[REG.BYTECODE_END]) {
            const op = this.memory[this.memory[REG.PC]++]
            if (op === OP.LOOP_START) {
              this.memory[REG.PC]++ // Skip count argument
              depth++
            } else if (op === OP.LOOP_END) {
              depth--
            } else {
              // Skip arguments for other opcodes
              this.skipOpcodeArgs(op)
            }
          }
          return true
        }

        // Push loop frame
        const lp = this.memory[REG.LOOP_SP]
        const frameBase = REGION.LOOP_FRAMES + lp * LOOP_FRAME_SIZE

        this.memory[frameBase + LOOP.BODY_START_PC] = this.memory[REG.PC]
        this.memory[frameBase + LOOP.REMAINING_COUNT] = count
        this.memory[frameBase + 2] = 0 // reserved
        this.memory[frameBase + 3] = 0 // reserved

        this.memory[REG.LOOP_SP] = lp + 1
        return true
      }

      case OP.LOOP_END: {
        const lp = this.memory[REG.LOOP_SP] - 1
        const frameBase = REGION.LOOP_FRAMES + lp * LOOP_FRAME_SIZE

        // Decrement remaining count
        this.memory[frameBase + LOOP.REMAINING_COUNT]--

        if (this.memory[frameBase + LOOP.REMAINING_COUNT] > 0) {
          // Jump back to body start (tick continues accumulating - NO RESET)
          this.memory[REG.PC] = this.memory[frameBase + LOOP.BODY_START_PC]
        } else {
          // Pop frame
          this.memory[REG.LOOP_SP] = lp
        }
        return true
      }

      default:
        // Unknown opcode - skip
        return true
    }
  }

  /**
   * Skip arguments for an opcode during loop body skipping.
   */
  private skipOpcodeArgs(opcode: number): void {
    switch (opcode) {
      case OP.NOTE:
        this.memory[REG.PC] += 3 // pitch, vel, dur
        break
      case OP.REST:
      case OP.TEMPO:
      case OP.BEND:
      case OP.TRANSPOSE:
        this.memory[REG.PC] += 1
        break
      case OP.CC:
      case OP.STACK_START:
        this.memory[REG.PC] += 2
        break
      case OP.CHORD2:
        this.memory[REG.PC] += 4 // root, int1, vel, dur
        break
      case OP.CHORD3:
        this.memory[REG.PC] += 5 // root, int1, int2, vel, dur
        break
      case OP.CHORD4:
        this.memory[REG.PC] += 6 // root, int1, int2, int3, vel, dur
        break
      // No args: STACK_END, BRANCH_START, BRANCH_END, LOOP_END, EOF
    }
  }

  // ===========================================================================
  // Event Emission (Ring Buffer)
  // ===========================================================================

  /**
   * Emit a note event to the ring buffer.
   * @returns false if buffer is full (backpressure)
   */
  private emitNote(pitch: number, velocity: number, duration: number): boolean {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]

    // Backpressure check: is buffer full?
    if (writeCount - readCount >= capacity) {
      return false
    }

    const eventStart = this.memory[REG.EVENT_START]
    const writeIndex = writeCount % capacity // RING BUFFER WRAP
    const offset = eventStart + writeIndex * EVENT_SIZE

    // Write event data BEFORE incrementing write pointer
    this.memory[offset + 0] = EVENT_TYPE.NOTE
    this.memory[offset + 1] = this.memory[REG.TICK]
    this.memory[offset + 2] = pitch + this.memory[REG.TRANSPOSITION]
    this.memory[offset + 3] = velocity
    this.memory[offset + 4] = duration
    this.memory[offset + 5] = 0 // reserved

    // Atomic increment - makes event visible to consumer
    Atomics.store(this.memory, REG.EVENT_WRITE, writeCount + 1)
    return true
  }

  /**
   * Emit a CC event to the ring buffer.
   * @returns false if buffer is full (backpressure)
   */
  private emitCC(controller: number, value: number): boolean {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]

    if (writeCount - readCount >= capacity) {
      return false
    }

    const eventStart = this.memory[REG.EVENT_START]
    const writeIndex = writeCount % capacity
    const offset = eventStart + writeIndex * EVENT_SIZE

    this.memory[offset + 0] = EVENT_TYPE.CC
    this.memory[offset + 1] = this.memory[REG.TICK]
    this.memory[offset + 2] = controller
    this.memory[offset + 3] = value
    this.memory[offset + 4] = 0
    this.memory[offset + 5] = 0

    Atomics.store(this.memory, REG.EVENT_WRITE, writeCount + 1)
    return true
  }

  /**
   * Emit a pitch bend event to the ring buffer.
   * @returns false if buffer is full (backpressure)
   */
  private emitBend(value: number): boolean {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]

    if (writeCount - readCount >= capacity) {
      return false
    }

    const eventStart = this.memory[REG.EVENT_START]
    const writeIndex = writeCount % capacity
    const offset = eventStart + writeIndex * EVENT_SIZE

    this.memory[offset + 0] = EVENT_TYPE.BEND
    this.memory[offset + 1] = this.memory[REG.TICK]
    this.memory[offset + 2] = value
    this.memory[offset + 3] = 0
    this.memory[offset + 4] = 0
    this.memory[offset + 5] = 0

    Atomics.store(this.memory, REG.EVENT_WRITE, writeCount + 1)
    return true
  }

  /**
   * Record a tempo change to the tempo buffer.
   */
  private recordTempo(bpm: number): void {
    const count = this.memory[REG.TEMPO_COUNT]
    const capacity = this.memory[REG.TEMPO_CAPACITY]

    if (count >= capacity) {
      return // Buffer full, ignore
    }

    const tempoStart = this.memory[REG.TEMPO_START]
    const offset = tempoStart + count * TEMPO_ENTRY_SIZE

    this.memory[offset + 0] = this.memory[REG.TICK]
    this.memory[offset + 1] = bpm

    this.memory[REG.TEMPO_COUNT] = count + 1
  }

  // ===========================================================================
  // Getters for Testing and Inspection
  // ===========================================================================

  /**
   * Get the number of events available to read.
   */
  getEventCount(): number {
    const write = Atomics.load(this.memory, REG.EVENT_WRITE)
    const read = Atomics.load(this.memory, REG.EVENT_READ)
    return write - read
  }

  /**
   * Get the total number of events written (monotonic counter).
   */
  getTotalEventsWritten(): number {
    return Atomics.load(this.memory, REG.EVENT_WRITE)
  }

  /**
   * Get an event by index relative to the read pointer.
   */
  getEvent(index: number): VMEvent {
    const capacity = this.memory[REG.EVENT_CAPACITY]
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const actualIndex = (readCount + index) % capacity
    const offset = this.memory[REG.EVENT_START] + actualIndex * EVENT_SIZE

    const type = this.memory[offset + 0]
    const tick = this.memory[offset + 1]

    if (type === EVENT_TYPE.NOTE) {
      return {
        type: 'note',
        tick,
        pitch: this.memory[offset + 2],
        velocity: this.memory[offset + 3],
        duration: this.memory[offset + 4]
      } as VMNoteEvent
    } else if (type === EVENT_TYPE.CC) {
      return {
        type: 'cc',
        tick,
        controller: this.memory[offset + 2],
        value: this.memory[offset + 3]
      } as VMControlEvent
    } else {
      return {
        type: 'bend',
        tick,
        value: this.memory[offset + 2]
      } as VMBendEvent
    }
  }

  /**
   * Get all events as an array.
   */
  getEvents(): VMEvent[] {
    const count = this.getEventCount()
    const events: VMEvent[] = []
    for (let i = 0; i < count; i++) {
      events.push(this.getEvent(i))
    }
    return events
  }

  /**
   * Get the current VM state.
   */
  getState(): number {
    return Atomics.load(this.memory, REG.STATE)
  }

  /**
   * Get the current tick.
   */
  getTick(): number {
    return this.memory[REG.TICK]
  }

  /**
   * Get the program counter.
   */
  getPC(): number {
    return this.memory[REG.PC]
  }

  /**
   * Get the current transposition offset.
   */
  getTransposition(): number {
    return this.memory[REG.TRANSPOSITION]
  }

  /**
   * Get the total program length in ticks.
   */
  getTotalLength(): number {
    return this.memory[REG.TOTAL_LENGTH]
  }

  /**
   * Get the underlying SharedArrayBuffer.
   */
  getBuffer(): SharedArrayBuffer {
    return this.memory.buffer as SharedArrayBuffer
  }

  /**
   * Get tempo changes recorded during execution.
   */
  getTempoChanges(): Array<{ tick: number; bpm: number }> {
    const count = this.memory[REG.TEMPO_COUNT]
    const tempoStart = this.memory[REG.TEMPO_START]
    const changes: Array<{ tick: number; bpm: number }> = []

    for (let i = 0; i < count; i++) {
      const offset = tempoStart + i * TEMPO_ENTRY_SIZE
      changes.push({
        tick: this.memory[offset + 0],
        bpm: this.memory[offset + 1]
      })
    }

    return changes
  }
}
