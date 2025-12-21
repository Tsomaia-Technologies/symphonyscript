// =============================================================================
// SymphonyScript - Silicon AudioWorklet Processor (RFC-043 Phase 3)
// =============================================================================
// AudioWorklet processor that consumes the Silicon Linker SAB.
// Runs in the audio rendering thread for sample-accurate timing.

// NOTE: This file is designed to be loaded as a worklet module.
// It must be self-contained and not import from external modules.

// =============================================================================
// AudioWorklet Type Declarations (for TypeScript compilation)
// =============================================================================

declare const sampleRate: number

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor
): void

// =============================================================================
// Constants (duplicated from @symphonyscript/core/linker/constants.ts)
// =============================================================================
//
// IMPORTANT: AudioWorklet processors run in an isolated context and cannot
// import from external modules. These constants MUST be kept in sync with
// packages/core/src/linker/constants.ts.
//
// Sync Strategy:
// 1. Any changes to constants.ts must be manually reflected here
// 2. Run `npm test -- silicon-processor` to verify sync via shared tests
// 3. The integration tests use the same SiliconSynapse + MockConsumer,
//    ensuring the constants produce identical behavior
//
// Future: Consider a build-time code generation step to auto-sync constants.
// =============================================================================

const HDR = {
  MAGIC: 0,
  VERSION: 1,
  PPQ: 2,
  BPM: 3,
  HEAD_PTR: 4,
  FREE_LIST_PTR: 5,
  COMMIT_FLAG: 6,
  PLAYHEAD_TICK: 7,
  SAFE_ZONE_TICKS: 8,
  ERROR_FLAG: 9,
  NODE_COUNT: 10,
  FREE_COUNT: 11,
  NODE_CAPACITY: 12,
  HEAP_START: 13,
  GROOVE_START: 14
} as const

const REG = {
  GROOVE_PTR: 16,
  GROOVE_LEN: 17,
  HUMAN_TIMING_PPT: 18,
  HUMAN_VEL_PPT: 19,
  TRANSPOSE: 20,
  VELOCITY_MULT: 21,
  PRNG_SEED: 22
} as const

const NODE = {
  PACKED_A: 0,
  BASE_TICK: 1,
  DURATION: 2,
  NEXT_PTR: 3,
  PREV_PTR: 4,
  SOURCE_ID: 5,
  SEQ_FLAGS: 6,
  RESERVED: 7
} as const

const PACKED = {
  OPCODE_SHIFT: 24,
  OPCODE_MASK: 0xff000000,
  PITCH_SHIFT: 16,
  PITCH_MASK: 0x00ff0000,
  VELOCITY_SHIFT: 8,
  VELOCITY_MASK: 0x0000ff00,
  FLAGS_MASK: 0x000000ff
} as const

const FLAG = {
  ACTIVE: 0x01,
  MUTED: 0x02,
  DIRTY: 0x04
} as const

const OPCODE = {
  NOTE: 0x01,
  REST: 0x02,
  CC: 0x03,
  BEND: 0x04
} as const

const COMMIT = {
  IDLE: 0,
  PENDING: 1,
  ACK: 2
} as const

const NULL_PTR = 0

// =============================================================================
// MIDI Event Types
// =============================================================================

interface MidiNoteEvent {
  type: 'note'
  tick: number
  pitch: number
  velocity: number
  duration: number
  channel: number
  sourceId: number
}

interface MidiCCEvent {
  type: 'cc'
  tick: number
  controller: number
  value: number
  channel: number
}

interface MidiBendEvent {
  type: 'bend'
  tick: number
  value: number
  channel: number
}

type MidiEvent = MidiNoteEvent | MidiCCEvent | MidiBendEvent

// =============================================================================
// Silicon Processor
// =============================================================================

/**
 * AudioWorklet processor that consumes the Silicon Linker SAB.
 *
 * This processor:
 * - Advances playhead tick based on sample rate and BPM
 * - Traverses the doubly-linked list to find events
 * - Applies VM-resident Groove/Humanize transforms
 * - Emits MIDI events to the main thread via MessagePort
 * - Handles COMMIT_FLAG protocol for structural changes
 */
class SiliconProcessor extends AudioWorkletProcessor {
  private sab: Int32Array | null = null
  private currentPtr: number = NULL_PTR
  private ticksPerSample: number = 0
  private accumulatedTicks: number = 0
  private isPlaying: boolean = false
  private lastSeq: Map<number, number> = new Map()

  constructor() {
    super()

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      this.handleMessage(event.data)
    }
  }

  /**
   * Handle messages from main thread.
   */
  private handleMessage(data: {
    type: string
    buffer?: SharedArrayBuffer
    playing?: boolean
  }): void {
    switch (data.type) {
      case 'init':
        if (data.buffer) {
          this.sab = new Int32Array(data.buffer)
          this.currentPtr = NULL_PTR
          this.updateTicksPerSample()
        }
        break

      case 'play':
        this.isPlaying = true
        // Re-find position from current playhead
        if (this.sab) {
          this.currentPtr = this.findNodeAtPlayhead()
        }
        break

      case 'pause':
        this.isPlaying = false
        break

      case 'stop':
        this.isPlaying = false
        if (this.sab) {
          Atomics.store(this.sab, HDR.PLAYHEAD_TICK, 0)
          this.currentPtr = Atomics.load(this.sab, HDR.HEAD_PTR)
          this.accumulatedTicks = 0
        }
        break

      case 'seek':
        // Seek handled by main thread setting PLAYHEAD_TICK
        // We just need to re-find our position
        if (this.sab) {
          this.currentPtr = this.findNodeAtPlayhead()
          this.accumulatedTicks = 0
        }
        break
    }
  }

  /**
   * Update ticks per sample based on BPM and sample rate.
   */
  private updateTicksPerSample(): void {
    if (!this.sab) return

    const bpm = this.sab[HDR.BPM]
    const ppq = this.sab[HDR.PPQ]

    // ticks/second = (BPM/60) * PPQ
    // ticks/sample = ticks/second / sampleRate
    const ticksPerSecond = (bpm / 60) * ppq
    this.ticksPerSample = ticksPerSecond / sampleRate
  }

  /**
   * Find the first node at or after current playhead.
   */
  private findNodeAtPlayhead(): number {
    if (!this.sab) return NULL_PTR

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
   * Handle COMMIT_FLAG protocol.
   */
  private handleCommitFlag(): void {
    if (!this.sab) return

    const flag = Atomics.load(this.sab, HDR.COMMIT_FLAG)

    if (flag === COMMIT.PENDING) {
      // Structural change occurred - invalidate cached position
      this.currentPtr = this.findNodeAtPlayhead()

      // Acknowledge the change
      Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.ACK)
    }
  }

  /**
   * Apply groove offset to base tick.
   */
  private applyGroove(baseTick: number): number {
    if (!this.sab) return baseTick

    const groovePtr = this.sab[REG.GROOVE_PTR]
    const grooveLen = this.sab[REG.GROOVE_LEN]

    if (groovePtr === NULL_PTR || grooveLen <= 0) {
      return baseTick
    }

    const grooveOffset = groovePtr / 4

    // Groove step index based on tick position (per RFC-043 §7.9)
    const stepIndex = baseTick % grooveLen

    // Read groove offset for this step
    const tickOffset = this.sab[grooveOffset + 1 + stepIndex]

    return baseTick + tickOffset
  }

  /**
   * Apply humanization to tick.
   */
  private applyHumanize(baseTick: number): number {
    if (!this.sab) return baseTick

    const humanTiming = this.sab[REG.HUMAN_TIMING_PPT]

    if (humanTiming <= 0) {
      return baseTick
    }

    const seed = this.sab[REG.PRNG_SEED]
    const ppq = this.sab[HDR.PPQ]

    // Deterministic hash for reproducible humanization
    const hash = ((baseTick * 2654435761) ^ seed) >>> 0
    const normalized = (hash % 2001 - 1000) / 1000 // [-1, 1]
    const offset = Math.round((normalized * humanTiming * ppq) / 1000)

    return baseTick + offset
  }

  /**
   * Apply global transpose.
   */
  private applyTranspose(pitch: number): number {
    if (!this.sab) return pitch

    const transpose = this.sab[REG.TRANSPOSE]
    return Math.max(0, Math.min(127, pitch + transpose))
  }

  /**
   * Apply velocity multiplier.
   */
  private applyVelocityMult(velocity: number): number {
    if (!this.sab) return velocity

    const mult = this.sab[REG.VELOCITY_MULT]
    return Math.max(0, Math.min(127, Math.round((velocity * mult) / 1000)))
  }

  /**
   * Get trigger tick with all transforms applied.
   */
  private getTriggerTick(baseTick: number): number {
    let tick = baseTick
    tick = this.applyGroove(tick)
    tick = this.applyHumanize(tick)
    return tick
  }

  /**
   * Process audio quantum (128 frames).
   */
  process(
    _inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    if (!this.sab || !this.isPlaying) {
      return true // Keep processor alive
    }

    // Check for structural changes
    this.handleCommitFlag()

    // Update timing (BPM may have changed)
    this.updateTicksPerSample()

    // Get current playhead
    const playhead = Atomics.load(this.sab, HDR.PLAYHEAD_TICK)

    // Calculate ticks for this quantum (128 samples)
    const ticksThisQuantum = this.ticksPerSample * 128
    const nextPlayhead = playhead + ticksThisQuantum

    // Collect events to emit
    const events: MidiEvent[] = []

    // Initialize pointer if needed
    if (this.currentPtr === NULL_PTR) {
      this.currentPtr = Atomics.load(this.sab, HDR.HEAD_PTR)
    }

    // Traverse chain and collect events in this quantum
    while (this.currentPtr !== NULL_PTR) {
      const offset = this.currentPtr / 4

      // Read node data
      const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
      const baseTick = this.sab[offset + NODE.BASE_TICK]
      const duration = this.sab[offset + NODE.DURATION]
      const nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
      const sourceId = this.sab[offset + NODE.SOURCE_ID]

      // Extract fields
      const opcode = (packed & PACKED.OPCODE_MASK) >>> PACKED.OPCODE_SHIFT
      const pitch = (packed & PACKED.PITCH_MASK) >>> PACKED.PITCH_SHIFT
      const velocity = (packed & PACKED.VELOCITY_MASK) >>> PACKED.VELOCITY_SHIFT
      const flags = packed & PACKED.FLAGS_MASK

      // Check if node is active and not muted
      if ((flags & FLAG.ACTIVE) !== 0 && (flags & FLAG.MUTED) === 0) {
        // Apply transforms to get trigger tick
        const triggerTick = this.getTriggerTick(baseTick)

        // If trigger tick is within this quantum, emit event
        if (triggerTick >= playhead && triggerTick < nextPlayhead) {
          if (opcode === OPCODE.NOTE) {
            events.push({
              type: 'note',
              tick: triggerTick,
              pitch: this.applyTranspose(pitch),
              velocity: this.applyVelocityMult(velocity),
              duration,
              channel: 0, // Could be derived from node data
              sourceId
            })
          } else if (opcode === OPCODE.CC) {
            events.push({
              type: 'cc',
              tick: triggerTick,
              controller: pitch, // CC number stored in pitch field
              value: velocity, // CC value stored in velocity field
              channel: 0
            })
          } else if (opcode === OPCODE.BEND) {
            events.push({
              type: 'bend',
              tick: triggerTick,
              value: (pitch << 7) | velocity, // 14-bit pitch bend
              channel: 0
            })
          }
        }

        // Move to next if we've passed this node
        if (triggerTick < nextPlayhead) {
          this.currentPtr = nextPtr
          continue
        }
      } else {
        // Skip inactive/muted nodes
        this.currentPtr = nextPtr
        continue
      }

      // Stop if we've reached nodes beyond this quantum
      if (baseTick >= nextPlayhead) {
        break
      }

      this.currentPtr = nextPtr
    }

    // Advance playhead
    Atomics.store(this.sab, HDR.PLAYHEAD_TICK, Math.floor(nextPlayhead))

    // Send events to main thread
    if (events.length > 0) {
      this.port.postMessage({ type: 'events', events })
    }

    // Send playhead update (throttled to every 10 quanta)
    if (Math.floor(nextPlayhead / 128) % 10 === 0) {
      this.port.postMessage({
        type: 'playhead',
        tick: Math.floor(nextPlayhead)
      })
    }

    return true // Keep processor alive
  }
}

// Register the processor
registerProcessor('silicon-processor', SiliconProcessor)
