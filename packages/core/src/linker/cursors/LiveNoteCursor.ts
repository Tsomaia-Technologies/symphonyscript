// =============================================================================
// SymphonyScript - LiveNoteCursor (RFC-043 Phase 4)
// =============================================================================
// Base cursor for modifying notes in the Live system.
// Mirrors modifiers directly to SAB via SiliconBridge.

import type { SiliconBridge } from '../silicon-bridge'
import type { NoteDuration, TimeSignatureString } from '../../types/primitives'
import type { GrooveTemplate } from '../../groove/types'
import type { HumanizeSettings, QuantizeSettings } from '../../../../../../symphonyscript-legacy/src/legacy/clip/types'
import { parseDuration } from '../../util/duration'

// =============================================================================
// Types
// =============================================================================

/**
 * Pending note data held by the cursor before/after insertion.
 */
export interface LiveNoteData {
  sourceId: number
  pitch: number
  velocity: number
  duration: number  // in ticks
  baseTick: number
  muted: boolean
  // Extended attributes (metadata, not directly in SAB)
  articulation?: string
  humanize?: HumanizeSettings | null
  quantize?: QuantizeSettings | null
}

// =============================================================================
// LiveNoteCursor
// =============================================================================

/**
 * Base builder interface for cursor type constraints.
 */
export interface LiveBuilderBase {
  getBridge(): SiliconBridge
  rest(duration: NoteDuration): this
  tempo(bpm: number): this
  timeSignature(signature: TimeSignatureString): this
  swing(amount: number): this
  groove(template: GrooveTemplate): this
  defaultHumanize(settings: HumanizeSettings): this
  quantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this
  control(controller: number, value: number): this
  finalize(): void
}

/**
 * Base cursor for modifying notes in the Live system.
 *
 * Unlike AST cursors that build a data structure, Live cursors:
 * - Hold a reference to a note already inserted in SAB
 * - Apply modifiers immediately via patchDirect()
 * - Return the cursor for chaining
 * - commit() returns the builder for fluent API continuation
 */
export class LiveNoteCursor<B extends LiveBuilderBase> {
  protected readonly builder: B
  protected readonly bridge: SiliconBridge
  protected readonly noteData: LiveNoteData
  protected readonly ppq: number = 480

  constructor(builder: B, noteData: LiveNoteData) {
    this.builder = builder
    this.bridge = builder.getBridge()
    this.noteData = noteData
  }

  // ===========================================================================
  // Modifiers (Chainable)
  // ===========================================================================

  /**
   * Set velocity (0-1 or 0-127) for the note.
   * Values 0-1 are normalized to 0-127.
   */
  velocity(v: number): this {
    const normalizedVelocity = v <= 1 ? Math.round(v * 127) : Math.round(v)
    const clamped = Math.max(0, Math.min(127, normalizedVelocity))

    this.noteData.velocity = clamped
    this.bridge.patchDirect(this.noteData.sourceId, 'velocity', clamped)

    return this
  }

  /**
   * Apply staccato articulation (50% duration).
   */
  staccato(): this {
    this.noteData.articulation = 'staccato'
    const newDuration = Math.round(this.noteData.duration * 0.5)
    this.noteData.duration = newDuration
    this.bridge.patchDirect(this.noteData.sourceId, 'duration', newDuration)
    return this
  }

  /**
   * Apply legato articulation (105% duration).
   */
  legato(): this {
    this.noteData.articulation = 'legato'
    const newDuration = Math.round(this.noteData.duration * 1.05)
    this.noteData.duration = newDuration
    this.bridge.patchDirect(this.noteData.sourceId, 'duration', newDuration)
    return this
  }

  /**
   * Apply accent (velocity boost to ~1.2x, capped at 127).
   */
  accent(): this {
    this.noteData.articulation = 'accent'
    const boosted = Math.min(127, Math.round(this.noteData.velocity * 1.2))
    this.noteData.velocity = boosted
    this.bridge.patchDirect(this.noteData.sourceId, 'velocity', boosted)
    return this
  }

  /**
   * Apply tenuto articulation (100% duration, sustained).
   */
  tenuto(): this {
    this.noteData.articulation = 'tenuto'
    // Tenuto = hold for full value, no modification needed if already full
    return this
  }

  /**
   * Apply marcato articulation (strong accent, 1.3x velocity).
   */
  marcato(): this {
    this.noteData.articulation = 'marcato'
    const boosted = Math.min(127, Math.round(this.noteData.velocity * 1.3))
    this.noteData.velocity = boosted
    this.bridge.patchDirect(this.noteData.sourceId, 'velocity', boosted)
    return this
  }

  /**
   * Apply humanization to timing and velocity.
   * Note: Stored as metadata; actual humanization applied during playback.
   */
  humanize(options?: HumanizeSettings): this {
    this.noteData.humanize = options ?? { timing: 15, velocity: 0.05 }
    // Humanization is applied during playback, not at edit time
    // Future: Could add timing offset to baseTick
    return this
  }

  /**
   * Disable humanization and quantization for this note.
   */
  precise(): this {
    this.noteData.humanize = null
    this.noteData.quantize = null
    return this
  }

  // ===========================================================================
  // Escape Methods (Commit & Delegate to Builder)
  // ===========================================================================

  /**
   * Commit the note and return the builder.
   */
  commit(): B {
    // Note is already in SAB; just return builder
    return this.builder
  }

  /**
   * Commit and add a rest.
   */
  rest(duration: NoteDuration): B {
    return this.commit().rest(duration) as B
  }

  /**
   * Commit and set tempo.
   */
  tempo(bpm: number): B {
    return this.commit().tempo(bpm) as B
  }

  /**
   * Commit and set time signature.
   */
  timeSignature(signature: TimeSignatureString): B {
    return this.commit().timeSignature(signature) as B
  }

  /**
   * Commit and set swing.
   */
  swing(amount: number): B {
    return this.commit().swing(amount) as B
  }

  /**
   * Commit and set groove.
   */
  groove(template: GrooveTemplate): B {
    return this.commit().groove(template) as B
  }

  /**
   * Commit and set default humanize.
   */
  defaultHumanize(settings: HumanizeSettings): B {
    return this.commit().defaultHumanize(settings) as B
  }

  /**
   * Commit and set quantize.
   */
  quantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): B {
    return this.commit().quantize(grid, options) as B
  }

  /**
   * Commit and send MIDI control change.
   */
  control(controller: number, value: number): B {
    return this.commit().control(controller, value) as B
  }

  /**
   * Commit and finalize.
   */
  finalize(): void {
    this.commit().finalize()
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get the source ID of this note.
   */
  getSourceId(): number {
    return this.noteData.sourceId
  }

  /**
   * Get the note data.
   */
  getNoteData(): LiveNoteData {
    return { ...this.noteData }
  }
}
