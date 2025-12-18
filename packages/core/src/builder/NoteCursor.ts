// =============================================================================
// SymphonyScript - NoteCursor (RFC-040 Smart Overloading)
// =============================================================================

import { BUILDER_OP } from './constants'
import { parseDuration } from '../util/duration'
import type { ClipBuilder } from './ClipBuilder'
import type {
  BuildOptions,
  HumanizeSettings,
  QuantizeOptions,
  BuilderGrooveTemplate,
  NoteDuration
} from './types'

/**
 * Recycled cursor for modifying notes in-place.
 * 
 * Implements SMART OVERLOADING for transform methods:
 * - No callback → Modifier mode → Returns NoteCursor → Emits NOTE_MOD_*
 * - With callback → Block mode → Returns ClipBuilder → Delegates to builder
 * 
 * The cursor is recycled (same instance returned from every note()) to achieve
 * zero allocations during fluent chain construction.
 * 
 * @template B - Builder type (ClipBuilder or MelodyBuilder)
 */
export class NoteCursor<B extends ClipBuilder> {
  /**
   * Index into builder.buf where the current NOTE opcode starts.
   * Builder NOTE format: [opcode, tick, pitch, vel, dur]
   */
  opIndex: number = -1

  constructor(public readonly builder: B) {}

  // ==========================================================================
  // SMART OVERLOADED TRANSFORMS
  // ==========================================================================

  // --- Humanize ---

  /**
   * Modifier mode: Apply humanization to the current note.
   * Emits NOTE_MOD_HUMANIZE after the note.
   * @returns NoteCursor to continue chaining on the same note
   */
  humanize(settings: HumanizeSettings): this

  /**
   * Block mode: Apply humanization to notes within the callback.
   * Delegates to builder.humanize().
   * @returns ClipBuilder to continue chaining on the builder
   */
  humanize(settings: HumanizeSettings, body: (b: B) => void): B

  /**
   * Smart overload implementation for humanize.
   */
  humanize(
    settings: HumanizeSettings,
    body?: (b: B) => void
  ): this | B {
    if (body) {
      // Block mode: delegate to builder
      return this.builder.humanize(settings, body as (b: ClipBuilder) => void) as B
    }

    // Modifier mode: emit NOTE_MOD_HUMANIZE
    const timingPpt = Math.round((settings.timing ?? 0) * 1000)
    const velocityPpt = Math.round((settings.velocity ?? 0) * 1000)
    this.builder.buf.push(BUILDER_OP.NOTE_MOD_HUMANIZE, timingPpt, velocityPpt)
    return this
  }

  // --- Quantize ---

  /**
   * Modifier mode: Apply quantization to the current note.
   * Emits NOTE_MOD_QUANTIZE after the note.
   * @returns NoteCursor to continue chaining on the same note
   */
  quantize(grid: NoteDuration, options?: QuantizeOptions): this

  /**
   * Block mode: Apply quantization to notes within the callback.
   * Delegates to builder.quantize().
   * @returns ClipBuilder to continue chaining on the builder
   */
  quantize(
    grid: NoteDuration,
    options: QuantizeOptions | undefined,
    body: (b: B) => void
  ): B

  /**
   * Smart overload implementation for quantize.
   */
  quantize(
    grid: NoteDuration,
    optionsOrBody?: QuantizeOptions | ((b: B) => void),
    body?: (b: B) => void
  ): this | B {
    // Detect if second arg is callback or options
    const hasCallback = typeof optionsOrBody === 'function' || typeof body === 'function'

    if (hasCallback) {
      // Block mode
      const options = typeof optionsOrBody === 'function' ? undefined : optionsOrBody
      const callback = typeof optionsOrBody === 'function' ? optionsOrBody : body!
      return this.builder.quantize(
        grid,
        options,
        callback as (b: ClipBuilder) => void
      ) as B
    }

    // Modifier mode: emit NOTE_MOD_QUANTIZE
    const gridTicks = this.durationToTicks(grid)
    const options = optionsOrBody as QuantizeOptions | undefined
    const strengthPct = Math.round((options?.strength ?? 1.0) * 100)
    this.builder.buf.push(BUILDER_OP.NOTE_MOD_QUANTIZE, gridTicks, strengthPct)
    return this
  }

  // --- Groove ---

  /**
   * Modifier mode: Apply groove template to the current note.
   * Registers template and emits NOTE_MOD_GROOVE with index.
   * @returns NoteCursor to continue chaining on the same note
   */
  groove(template: BuilderGrooveTemplate): this

  /**
   * Block mode: Apply groove template to notes within the callback.
   * Delegates to builder.groove().
   * @returns ClipBuilder to continue chaining on the builder
   */
  groove(template: BuilderGrooveTemplate, body: (b: B) => void): B

  /**
   * Smart overload implementation for groove.
   */
  groove(
    template: BuilderGrooveTemplate,
    body?: (b: B) => void
  ): this | B {
    if (body) {
      // Block mode: delegate to builder
      return this.builder.groove(template, body as (b: ClipBuilder) => void) as B
    }

    // Modifier mode: register template and emit NOTE_MOD_GROOVE
    const idx = this.builder.registerGroove(template)
    this.builder.buf.push(BUILDER_OP.NOTE_MOD_GROOVE, idx)
    return this
  }

  // ==========================================================================
  // STANDARD CURSOR METHODS (Buffer Modification)
  // ==========================================================================

  /**
   * Set velocity for the current note.
   * Modifies buf[opIndex + 3] (Builder NOTE: [op, tick, pitch, VEL, dur])
   */
  velocity(v: number): this {
    this.builder.buf[this.opIndex + 3] = Math.round(Math.max(0, Math.min(1, v)) * 127)
    return this
  }

  /**
   * Apply staccato articulation (50% duration).
   * Modifies buf[opIndex + 4] (Builder NOTE: [op, tick, pitch, vel, DUR])
   */
  staccato(): this {
    this.builder.buf[this.opIndex + 4] = Math.round(
      this.builder.buf[this.opIndex + 4] * 0.5
    )
    return this
  }

  /**
   * Apply legato articulation (105% duration).
   * Modifies buf[opIndex + 4]
   */
  legato(): this {
    this.builder.buf[this.opIndex + 4] = Math.round(
      this.builder.buf[this.opIndex + 4] * 1.05
    )
    return this
  }

  /**
   * Apply accent (boost velocity by 20).
   * Modifies buf[opIndex + 3]
   */
  accent(): this {
    this.builder.buf[this.opIndex + 3] = Math.min(
      127,
      this.builder.buf[this.opIndex + 3] + 20
    )
    return this
  }

  /**
   * Apply tenuto articulation (full duration, sustained).
   * No modification needed as full duration is default.
   */
  tenuto(): this {
    // No-op: full duration is default
    return this
  }

  /**
   * Apply marcato articulation (accent + staccato).
   */
  marcato(): this {
    return this.accent().staccato()
  }

  // ==========================================================================
  // ESCAPE METHODS (Delegate to Builder)
  // ==========================================================================

  /**
   * Add a rest and return to builder.
   */
  rest(duration?: NoteDuration): B {
    return this.builder.rest(duration) as B
  }

  /**
   * Set tempo and return to builder.
   */
  tempo(bpm: number): B {
    return this.builder.tempo(bpm) as B
  }

  /**
   * Send MIDI CC and return to builder.
   */
  control(controller: number, value: number): B {
    return this.builder.control(controller, value) as B
  }

  /**
   * Send pitch bend and return to builder.
   */
  bend(value: number): B {
    return this.builder.bend(value) as B
  }

  /**
   * Loop and return to builder.
   */
  loop(count: number, body: (b: B) => void): B {
    return this.builder.loop(count, body as (b: ClipBuilder) => void) as B
  }

  /**
   * Stack branches and return to builder.
   */
  stack(...branches: Array<(b: B) => void>): B {
    return this.builder.stack(
      ...branches.map(b => b as (b: ClipBuilder) => void)
    ) as B
  }

  /**
   * Set default duration and return to builder.
   */
  defaultDuration(duration: NoteDuration): B {
    return this.builder.defaultDuration(duration) as B
  }

  /**
   * Set velocity state and return to builder.
   */
  setVelocity(v: number): B {
    return this.builder.setVelocity(v) as B
  }

  /**
   * Build the clip and return SharedArrayBuffer.
   */
  build(options?: BuildOptions): SharedArrayBuffer {
    return this.builder.build(options)
  }

  /**
   * Clone the builder (not the cursor).
   */
  clone(): B {
    return this.builder.clone() as B
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Convert duration to ticks.
   */
  protected durationToTicks(duration: NoteDuration): number {
    if (typeof duration === 'number') {
      return Math.round(duration * this.builder.ppq)
    }
    const beats = parseDuration(duration)
    return Math.round(beats * this.builder.ppq)
  }
}
