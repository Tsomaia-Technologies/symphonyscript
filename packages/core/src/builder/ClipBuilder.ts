// =============================================================================
// SymphonyScript - ClipBuilder (RFC-040 Zero-Allocation)
// =============================================================================

import { OP, REG, REGION, STATE, SBC_MAGIC, SBC_VERSION, EVENT_SIZE, TEMPO_ENTRY_SIZE } from '../vm/constants'
import { BUILDER_OP } from './constants'
import { compileBuilderToVM } from './compiler'
import { parseDuration } from '../util/duration'
import type { NoteCursor } from './NoteCursor'
import type {
  BuildOptions,
  HumanizeSettings,
  QuantizeOptions,
  BuilderGrooveTemplate,
  NoteDuration
} from './types'

/**
 * Zero-allocation ClipBuilder that emits bytecode directly to a number[] buffer.
 * 
 * Uses Builder Bytecode format with absolute ticks during chain construction,
 * then compiles to VM Bytecode (RFC-038) on build().
 * 
 * The builder is MUTABLE. Use .clone() for branching.
 */
export class ClipBuilder {
  // Raw bytecode buffer - Builder format (absolute ticks)
  buf: number[] = []

  // Current state
  protected _vel: number = 100        // 0-127 MIDI velocity
  protected _trans: number = 0        // Semitones offset
  protected _tick: number = 0         // Current position in ticks
  protected _ppq: number = 96         // Pulses per quarter note
  protected _defaultDur: number = 96  // Default duration (1 beat = quarter note)

  // Registered groove templates (for atomic groove modifier)
  protected _grooveTemplates: number[][] = []

  // Recycled cursor instance (set by subclass)
  protected _cursor!: NoteCursor<this>

  constructor() {
    // Cursor is created by subclass to avoid circular dependency
  }

  // --- Accessors ---

  get tick(): number {
    return this._tick
  }

  get velocity(): number {
    return this._vel
  }

  get transposition(): number {
    return this._trans
  }

  get ppq(): number {
    return this._ppq
  }

  // --- State Modifiers (No Bytecode) ---

  /**
   * Set velocity for subsequent notes.
   * @param v - Velocity as 0-1 fraction
   */
  setVelocity(v: number): this {
    this._vel = Math.round(Math.max(0, Math.min(1, v)) * 127)
    return this
  }

  /**
   * Set default duration for subsequent notes.
   */
  defaultDuration(duration: NoteDuration): this {
    this._defaultDur = this.durationToTicks(duration)
    return this
  }

  // --- Basic Operations ---

  /**
   * Add a rest (silence) that advances time.
   * Builder format: [REST, tick, dur]
   */
  rest(duration?: NoteDuration): this {
    const dur = this.durationToTicks(duration ?? this._defaultDur)
    this.buf.push(OP.REST, this._tick, dur)
    this._tick += dur
    return this
  }

  /**
   * Set tempo (BPM).
   * Builder format: [TEMPO, tick, bpm]
   */
  tempo(bpm: number): this {
    this.buf.push(OP.TEMPO, this._tick, bpm)
    return this
  }

  /**
   * Send MIDI Control Change.
   * Builder format: [CC, tick, ctrl, val]
   */
  control(controller: number, value: number): this {
    this.buf.push(OP.CC, this._tick, controller, value)
    return this
  }

  /**
   * Send pitch bend.
   * Builder format: [BEND, tick, val]
   */
  bend(value: number): this {
    // Convert from -1..1 to MIDI pitch bend (0-16383, center 8192)
    const bendValue = Math.round(8192 + value * 8191)
    this.buf.push(OP.BEND, this._tick, Math.max(0, Math.min(16383, bendValue)))
    return this
  }

  // --- Block-Scoped Transforms (Callback Required) ---

  /**
   * Apply humanization to notes within the callback.
   * Emits HUMANIZE_PUSH...body...HUMANIZE_POP
   */
  humanize(settings: HumanizeSettings, body: (b: this) => void): this {
    const timingPpt = Math.round((settings.timing ?? 0) * 1000)
    const velocityPpt = Math.round((settings.velocity ?? 0) * 1000)

    this.buf.push(BUILDER_OP.HUMANIZE_PUSH, timingPpt, velocityPpt)
    body(this)
    this.buf.push(BUILDER_OP.HUMANIZE_POP)

    return this
  }

  /**
   * Apply quantization to notes within the callback.
   * Emits QUANTIZE_PUSH...body...QUANTIZE_POP
   */
  quantize(
    grid: NoteDuration,
    options: QuantizeOptions | undefined,
    body: (b: this) => void
  ): this {
    const gridTicks = this.durationToTicks(grid)
    const strengthPct = Math.round((options?.strength ?? 1.0) * 100)

    this.buf.push(BUILDER_OP.QUANTIZE_PUSH, gridTicks, strengthPct)
    body(this)
    this.buf.push(BUILDER_OP.QUANTIZE_POP)

    return this
  }

  /**
   * Apply groove template to notes within the callback.
   * Emits GROOVE_PUSH...body...GROOVE_POP
   */
  groove(template: BuilderGrooveTemplate, body: (b: this) => void): this {
    const offsets = template.getOffsets()

    this.buf.push(BUILDER_OP.GROOVE_PUSH, offsets.length, ...offsets)
    body(this)
    this.buf.push(BUILDER_OP.GROOVE_POP)

    return this
  }

  // --- Groove Registration (For Atomic Modifier) ---

  /**
   * Register a groove template and return its index.
   * Used by atomic groove modifier on NoteCursor.
   */
  registerGroove(template: BuilderGrooveTemplate): number {
    const offsets = template.getOffsets()
    const idx = this._grooveTemplates.length
    this._grooveTemplates.push(offsets)
    return idx
  }

  /**
   * Get registered groove templates.
   */
  getGrooveTemplates(): readonly number[][] {
    return this._grooveTemplates
  }

  // --- Structural Operations ---

  /**
   * Repeat operations within the callback.
   * Emits LOOP_START...body...LOOP_END
   */
  loop(count: number, body: (b: this) => void): this {
    if (count <= 0) return this

    this.buf.push(OP.LOOP_START, this._tick, count)
    body(this)
    this.buf.push(OP.LOOP_END)

    return this
  }

  /**
   * Execute branches in parallel (polyphony).
   * All branches start at the same tick; builder advances by max duration.
   * Emits STACK_START...branches...STACK_END
   */
  stack(...branches: Array<(b: this) => void>): this {
    if (branches.length === 0) return this

    const startTick = this._tick
    let maxDuration = 0

    this.buf.push(OP.STACK_START, this._tick, branches.length)

    for (const branch of branches) {
      this.buf.push(OP.BRANCH_START)

      // Reset tick to start for each branch
      const branchStartTick = this._tick
      this._tick = startTick

      // Execute branch
      branch(this)

      // Track max duration
      const branchDuration = this._tick - startTick
      if (branchDuration > maxDuration) {
        maxDuration = branchDuration
      }

      // Restore tick for next branch measurement
      this._tick = branchStartTick

      this.buf.push(OP.BRANCH_END)
    }

    this.buf.push(OP.STACK_END)

    // Advance tick by max branch duration
    this._tick = startTick + maxDuration

    return this
  }

  // --- Clone ---

  /**
   * Create an independent copy of this builder.
   * Required for branching since the builder is mutable.
   */
  clone(): this {
    const Constructor = this.constructor as new () => this
    const copy = new Constructor()
    copy.buf = [...this.buf]
    copy._vel = this._vel
    copy._trans = this._trans
    copy._tick = this._tick
    copy._ppq = this._ppq
    copy._defaultDur = this._defaultDur
    copy._grooveTemplates = this._grooveTemplates.map(t => [...t])
    return copy
  }

  // --- Build ---

  /**
   * Compile Builder Bytecode to VM Bytecode and return SharedArrayBuffer.
   * 
   * Performs 5-phase compilation:
   * 1. Extract events with transform contexts
   * 2. Apply transforms (Quantize → Groove → Humanize)
   * 3. Sort by final tick
   * 4. Emit VM bytecode with REST gaps
   * 5. Copy to SharedArrayBuffer with RFC-038 headers
   */
  build(options?: BuildOptions): SharedArrayBuffer {
    const {
      bpm = 120,
      ppq = this._ppq,
      eventCapacity = 10000,
      tempoCapacity = 100,
      seed = Date.now(),
      unroll = false
    } = options ?? {}

    // Compile Builder Bytecode → VM Bytecode
    const { vmBuf, totalTicks } = compileBuilderToVM(
      this.buf,
      ppq,
      seed,
      this._grooveTemplates,
      unroll
    )

    // Calculate sizes
    const bytecodeSize = vmBuf.length
    const eventRegionSize = eventCapacity * EVENT_SIZE
    const tempoRegionSize = tempoCapacity * TEMPO_ENTRY_SIZE
    const totalSize = REGION.BYTECODE + bytecodeSize + eventRegionSize + tempoRegionSize

    // Allocate SharedArrayBuffer (4 bytes per int32)
    const sab = new SharedArrayBuffer(totalSize * 4)
    const mem = new Int32Array(sab)

    // Write header registers (RFC-038 format)
    mem[REG.MAGIC] = SBC_MAGIC
    mem[REG.VERSION] = SBC_VERSION
    mem[REG.PPQ] = ppq
    mem[REG.BPM] = bpm
    mem[REG.TOTAL_LENGTH] = totalTicks
    mem[REG.PC] = REGION.BYTECODE
    mem[REG.TICK] = 0
    Atomics.store(mem, REG.STATE, STATE.IDLE)
    mem[REG.STACK_SP] = 0
    mem[REG.LOOP_SP] = 0
    mem[REG.TRANS_SP] = 0
    mem[REG.TRANSPOSITION] = 0
    Atomics.store(mem, REG.EVENT_WRITE, 0)
    Atomics.store(mem, REG.EVENT_READ, 0)
    mem[REG.TEMPO_COUNT] = 0
    mem[REG.BYTECODE_START] = REGION.BYTECODE
    mem[REG.BYTECODE_END] = REGION.BYTECODE + bytecodeSize
    mem[REG.EVENT_START] = REGION.BYTECODE + bytecodeSize
    mem[REG.EVENT_CAPACITY] = eventCapacity
    mem[REG.TEMPO_START] = REGION.BYTECODE + bytecodeSize + eventRegionSize
    mem[REG.TEMPO_CAPACITY] = tempoCapacity

    // Copy bytecode
    for (let i = 0; i < vmBuf.length; i++) {
      mem[REGION.BYTECODE + i] = vmBuf[i]
    }

    return sab
  }

  // --- Helpers ---

  /**
   * Convert duration notation to ticks.
   */
  protected durationToTicks(duration: NoteDuration): number {
    if (typeof duration === 'number') {
      return Math.round(duration * this._ppq)
    }
    const beats = parseDuration(duration)
    return Math.round(beats * this._ppq)
  }
}
