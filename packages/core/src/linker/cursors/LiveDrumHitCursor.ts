// =============================================================================
// SymphonyScript - LiveDrumHitCursor (RFC-043 Phase 4)
// =============================================================================
// Cursor for drum hits with specialized modifiers.
// Extends LiveNoteCursor with drum-specific methods.

import { LiveNoteCursor, LiveNoteData } from './LiveNoteCursor'
import type { SiliconBridge } from '../silicon-bridge'
import type { NoteDuration } from '../../types/primitives'

// =============================================================================
// Types
// =============================================================================

/**
 * Drum-specific note data.
 */
export interface LiveDrumHitData extends LiveNoteData {
  drumName?: string
  isFlam?: boolean
  isDrag?: boolean
}

// =============================================================================
// LiveDrumHitCursor
// =============================================================================

/**
 * Cursor for drum hits with specialized modifiers.
 */
export class LiveDrumHitCursor<B extends {
  getBridge(): SiliconBridge
  hit(drum: string): LiveDrumHitCursor<B>
  kick(): LiveDrumHitCursor<B>
  snare(): LiveDrumHitCursor<B>
  hat(): LiveDrumHitCursor<B>
  openHat(): LiveDrumHitCursor<B>
  crash(): LiveDrumHitCursor<B>
  ride(): LiveDrumHitCursor<B>
  clap(): LiveDrumHitCursor<B>
  tom(which?: 1 | 2 | 3): LiveDrumHitCursor<B>
  euclidean(options: any): B
  rest(duration: NoteDuration): B
  tempo(bpm: number): B
  timeSignature(signature: any): B
  swing(amount: number): B
  groove(template: any): B
  defaultHumanize(settings: any): B
  quantize(grid: any, options?: any): B
  control(controller: number, value: number): B
  finalize(): void
  withMapping(mapping: any): B
}> extends LiveNoteCursor<B> {
  protected readonly drumData: LiveDrumHitData

  constructor(builder: B, drumData: LiveDrumHitData) {
    super(builder, drumData)
    this.drumData = drumData
  }

  // ===========================================================================
  // Drum-Specific Modifiers
  // ===========================================================================

  /**
   * Set velocity to ghost note level (0.3 = ~38 MIDI velocity).
   */
  ghost(): this {
    const ghostVelocity = Math.round(0.3 * 127)
    this.drumData.velocity = ghostVelocity
    this.bridge.patchDirect(this.drumData.sourceId, 'velocity', ghostVelocity)
    return this
  }

  /**
   * Add flam (grace note before main hit).
   * Note: Currently stored as metadata for future implementation.
   */
  flam(): this {
    this.drumData.isFlam = true
    // TODO: Implement grace notes by inserting a quieter note before this one
    // For now, we could simulate by adding a short note slightly before
    return this
  }

  /**
   * Add drag (double grace note before main hit).
   * Note: Currently stored as metadata for future implementation.
   */
  drag(): this {
    this.drumData.isDrag = true
    // TODO: Implement double grace notes
    return this
  }

  // ===========================================================================
  // Relay Methods (Commit & Start New Hit)
  // ===========================================================================

  /**
   * Commit and start new drum hit.
   */
  hit(drum: string): LiveDrumHitCursor<B> {
    return this.commit().hit(drum)
  }

  /**
   * Commit and add kick.
   */
  kick(): LiveDrumHitCursor<B> {
    return this.commit().kick()
  }

  /**
   * Commit and add snare.
   */
  snare(): LiveDrumHitCursor<B> {
    return this.commit().snare()
  }

  /**
   * Commit and add hat.
   */
  hat(): LiveDrumHitCursor<B> {
    return this.commit().hat()
  }

  /**
   * Commit and add open hat.
   */
  openHat(): LiveDrumHitCursor<B> {
    return this.commit().openHat()
  }

  /**
   * Commit and add crash.
   */
  crash(): LiveDrumHitCursor<B> {
    return this.commit().crash()
  }

  /**
   * Commit and add ride.
   */
  ride(): LiveDrumHitCursor<B> {
    return this.commit().ride()
  }

  /**
   * Commit and add clap.
   */
  clap(): LiveDrumHitCursor<B> {
    return this.commit().clap()
  }

  /**
   * Commit and add tom.
   */
  tom(which: 1 | 2 | 3 = 1): LiveDrumHitCursor<B> {
    return this.commit().tom(which)
  }

  // ===========================================================================
  // Escape Methods
  // ===========================================================================

  /**
   * Commit and generate euclidean pattern.
   */
  euclidean(options: any): B {
    return this.commit().euclidean(options)
  }

  /**
   * Commit and apply custom drum mapping.
   */
  withMapping(mapping: any): B {
    return this.commit().withMapping(mapping)
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get the drum hit data.
   */
  getDrumData(): LiveDrumHitData {
    return { ...this.drumData }
  }
}
