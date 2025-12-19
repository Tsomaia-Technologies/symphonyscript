// =============================================================================
// SymphonyScript - Mock AudioWorklet Consumer (RFC-043)
// =============================================================================
// Simulates AudioWorklet behavior for integration testing.

import {
  HDR,
  REG,
  NODE,
  COMMIT,
  NULL_PTR,
  PACKED,
  SEQ,
  FLAG,
  HEAP_START_OFFSET
} from './constants'

/**
 * Event emitted when consumer reads a node.
 */
export interface ConsumerNoteEvent {
  tick: number
  pitch: number
  velocity: number
  duration: number
  ptr: number
}

/**
 * Mock AudioWorklet consumer for integration testing.
 *
 * Simulates the behavior of an AudioWorklet that:
 * - Advances playhead tick over time
 * - Reads nodes from the linked list
 * - Acknowledges structural changes via COMMIT_FLAG
 * - Applies groove and humanization transforms
 *
 * This is NOT for production use - it's for testing the Silicon Linker
 * in isolation before integrating with the real AudioWorklet.
 */
export class MockConsumer {
  private sab: Int32Array
  private heapStartI32: number
  private currentPtr: number = NULL_PTR
  private events: ConsumerNoteEvent[] = []
  private isRunning: boolean = false
  private tickRate: number // ticks per process() call

  constructor(buffer: SharedArrayBuffer, tickRate = 24) {
    this.sab = new Int32Array(buffer)
    this.heapStartI32 = HEAP_START_OFFSET / 4
    this.tickRate = tickRate
  }

  /**
   * Reset consumer state.
   */
  reset(): void {
    this.currentPtr = NULL_PTR
    this.events = []
    this.isRunning = false
    Atomics.store(this.sab, HDR.PLAYHEAD_TICK, 0)
  }

  /**
   * Get collected events.
   */
  getEvents(): ConsumerNoteEvent[] {
    return [...this.events]
  }

  /**
   * Get current playhead tick.
   */
  getPlayheadTick(): number {
    return Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
  }

  /**
   * Set playhead tick directly (for testing).
   */
  setPlayheadTick(tick: number): void {
    Atomics.store(this.sab, HDR.PLAYHEAD_TICK, tick)
  }

  /**
   * Simulate one audio quantum (~128 frames = ~2.9ms at 44.1kHz).
   *
   * This method:
   * 1. Checks for COMMIT_FLAG and acknowledges
   * 2. Advances playhead by tickRate
   * 3. Reads any nodes that fall within the current tick window
   *
   * @returns Array of events triggered in this quantum
   */
  process(): ConsumerNoteEvent[] {
    const quantumEvents: ConsumerNoteEvent[] = []

    // 1. Check for structural changes
    this.handleCommitFlag()

    // 2. Get current playhead position
    const playhead = Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
    const nextPlayhead = playhead + this.tickRate

    // 3. Initialize pointer if needed
    if (this.currentPtr === NULL_PTR) {
      this.currentPtr = Atomics.load(this.sab, HDR.HEAD_PTR)
    }

    // 4. Read nodes up to nextPlayhead
    while (this.currentPtr !== NULL_PTR) {
      const offset = this.currentPtr / 4

      // Read node data
      const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
      const baseTick = this.sab[offset + NODE.BASE_TICK]
      const duration = this.sab[offset + NODE.DURATION]
      const nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)

      // Extract fields from packed
      const flags = packed & PACKED.FLAGS_MASK
      const pitch = (packed & PACKED.PITCH_MASK) >>> PACKED.PITCH_SHIFT
      const velocity = (packed & PACKED.VELOCITY_MASK) >>> PACKED.VELOCITY_SHIFT

      // Check if node is active and not muted
      if ((flags & FLAG.ACTIVE) && !(flags & FLAG.MUTED)) {
        // Apply transforms to get trigger tick
        const triggerTick = this.getTriggerTick(baseTick)

        // If trigger tick is within this quantum, emit event
        if (triggerTick >= playhead && triggerTick < nextPlayhead) {
          const event: ConsumerNoteEvent = {
            tick: triggerTick,
            pitch: this.applyTranspose(pitch),
            velocity: this.applyVelocityMult(velocity),
            duration,
            ptr: this.currentPtr
          }
          quantumEvents.push(event)
          this.events.push(event)
        }

        // If we've passed this node, move to next
        if (triggerTick < nextPlayhead) {
          this.currentPtr = nextPtr
          continue
        }
      }

      // Stop if we've reached nodes beyond this quantum
      if (baseTick >= nextPlayhead) {
        break
      }

      this.currentPtr = nextPtr
    }

    // 5. Advance playhead
    Atomics.store(this.sab, HDR.PLAYHEAD_TICK, nextPlayhead)

    return quantumEvents
  }

  /**
   * Handle COMMIT_FLAG protocol.
   * If PENDING, acknowledge and invalidate cached pointer.
   */
  private handleCommitFlag(): void {
    const flag = Atomics.load(this.sab, HDR.COMMIT_FLAG)

    if (flag === COMMIT.PENDING) {
      // Invalidate cached pointer - need to re-find position
      this.currentPtr = this.findNodeAtPlayhead()

      // Acknowledge
      Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.ACK)
    }
  }

  /**
   * Find the node at or after current playhead.
   * Called after structural change to re-sync position.
   */
  private findNodeAtPlayhead(): number {
    const playhead = Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
    let ptr = Atomics.load(this.sab, HDR.HEAD_PTR)

    while (ptr !== NULL_PTR) {
      const offset = ptr / 4
      const baseTick = this.sab[offset + NODE.BASE_TICK]

      if (baseTick >= playhead) {
        return ptr
      }

      ptr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
    }

    return NULL_PTR
  }

  /**
   * Apply groove and humanization to get trigger tick.
   */
  private getTriggerTick(baseTick: number): number {
    let triggerTick = baseTick

    // Apply groove offset
    const groovePtr = this.sab[REG.GROOVE_PTR]
    const grooveLen = this.sab[REG.GROOVE_LEN]

    if (groovePtr !== NULL_PTR && grooveLen > 0) {
      const grooveOffset = groovePtr / 4
      const stepIndex = baseTick % grooveLen
      triggerTick += this.sab[grooveOffset + 1 + stepIndex] // +1 for length field
    }

    // Apply humanization
    const humanTiming = this.sab[REG.HUMAN_TIMING_PPT]
    if (humanTiming > 0) {
      const seed = this.sab[REG.PRNG_SEED]
      const ppq = this.sab[HDR.PPQ]

      // Deterministic hash for reproducible humanization
      const hash = ((baseTick * 2654435761) ^ seed) >>> 0
      const normalized = (hash % 2001 - 1000) / 1000 // [-1, 1]
      triggerTick += Math.round(normalized * humanTiming * ppq / 1000)
    }

    return triggerTick
  }

  /**
   * Apply global transpose.
   */
  private applyTranspose(pitch: number): number {
    const transpose = this.sab[REG.TRANSPOSE]
    return Math.max(0, Math.min(127, pitch + transpose))
  }

  /**
   * Apply global velocity multiplier.
   */
  private applyVelocityMult(velocity: number): number {
    const mult = this.sab[REG.VELOCITY_MULT]
    return Math.max(0, Math.min(127, Math.round(velocity * mult / 1000)))
  }

  /**
   * Run consumer for N quanta, collecting all events.
   *
   * @param quanta - Number of process() calls to run
   * @returns All events collected
   */
  runQuanta(quanta: number): ConsumerNoteEvent[] {
    const allEvents: ConsumerNoteEvent[] = []

    for (let i = 0; i < quanta; i++) {
      const events = this.process()
      allEvents.push(...events)
    }

    return allEvents
  }

  /**
   * Run consumer until playhead reaches target tick.
   *
   * @param targetTick - Tick to run until
   * @returns All events collected
   */
  runUntilTick(targetTick: number): ConsumerNoteEvent[] {
    const allEvents: ConsumerNoteEvent[] = []

    while (this.getPlayheadTick() < targetTick) {
      const events = this.process()
      allEvents.push(...events)
    }

    return allEvents
  }

  /**
   * Iterate all nodes in the chain (for debugging).
   */
  *iterateChain(): Generator<{
    ptr: number
    baseTick: number
    pitch: number
    velocity: number
    duration: number
    nextPtr: number
    flags: number
  }> {
    let ptr = Atomics.load(this.sab, HDR.HEAD_PTR)

    while (ptr !== NULL_PTR) {
      const offset = ptr / 4
      const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)

      yield {
        ptr,
        baseTick: this.sab[offset + NODE.BASE_TICK],
        pitch: (packed & PACKED.PITCH_MASK) >>> PACKED.PITCH_SHIFT,
        velocity: (packed & PACKED.VELOCITY_MASK) >>> PACKED.VELOCITY_SHIFT,
        duration: this.sab[offset + NODE.DURATION],
        nextPtr: Atomics.load(this.sab, offset + NODE.NEXT_PTR),
        flags: packed & PACKED.FLAGS_MASK
      }

      ptr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
    }
  }
}
