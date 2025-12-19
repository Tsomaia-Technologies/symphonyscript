// =============================================================================
// SymphonyScript - LiveStringsBuilder (RFC-043 Phase 4)
// =============================================================================
// String instrument builder with bend and slide capabilities.
// Extends LiveMelodyBuilder with string-specific operations.

import { LiveMelodyBuilder } from './LiveMelodyBuilder'
import type { SiliconBridge } from './silicon-bridge'
import type { NoteDuration, NoteName } from '../types/primitives'

// =============================================================================
// LiveStringsBuilder
// =============================================================================

/**
 * LiveStringsBuilder extends LiveMelodyBuilder with string instrument capabilities.
 * Mirrors StringBuilder API for live coding with direct SAB synchronization.
 */
export class LiveStringsBuilder extends LiveMelodyBuilder {
  protected _currentBend: number = 0

  constructor(bridge: SiliconBridge, name: string = 'Untitled Strings') {
    super(bridge, name)
  }

  /**
   * Pitch bend in semitones.
   * Range: -12 to +12 semitones (mapped to MIDI pitch bend range).
   */
  bend(semitones: number): this {
    const clamped = Math.max(-12, Math.min(12, semitones))
    this._currentBend = clamped
    // Pitch bend is typically sent as a 14-bit value
    // For metadata/storage purposes, we just track the semitones
    return this
  }

  /**
   * Slide to another pitch over time.
   * Creates a legato note to the target pitch.
   */
  slide(targetPitch: NoteName, duration: NoteDuration): this {
    return this.note(targetPitch, duration).legato().commit() as this
  }

  /**
   * Reset pitch bend to center (0 semitones).
   */
  bendReset(): this {
    this._currentBend = 0
    return this
  }
}
