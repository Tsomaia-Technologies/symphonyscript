// =============================================================================
// SymphonyScript - LiveDrumBuilder (RFC-043 Phase 4)
// =============================================================================
// Drum builder that mirrors DSL calls directly to SiliconBridge.
// Extends LiveClipBuilder with drum-specific operations.

import { LiveClipBuilder } from './LiveClipBuilder'
import type { SiliconBridge } from './silicon-bridge'
import type { NoteDuration, NoteName } from '../types/primitives'
import { LiveDrumHitCursor, LiveDrumHitData } from './cursors/LiveDrumHitCursor'
import { euclidean, rotatePattern } from '../generators/euclidean'

// =============================================================================
// Types
// =============================================================================

export interface EuclideanOptions {
  hits: number
  steps: number
  note: string
  stepDuration?: NoteDuration
  velocity?: number
  rotation?: number
  repeat?: number
}

/** Default drum mapping (GM Standard) */
const DEFAULT_DRUM_MAP: Record<string, NoteName> = {
  'kick': 'C1' as NoteName,
  'snare': 'D1' as NoteName,
  'hat': 'F#1' as NoteName,
  'openhat': 'A#1' as NoteName,
  'crash': 'C#2' as NoteName,
  'ride': 'D#2' as NoteName,
  'tom1': 'C2' as NoteName,
  'tom2': 'A1' as NoteName,
  'tom3': 'G1' as NoteName,
  'clap': 'D#1' as NoteName,
  'rim': 'C#1' as NoteName,
}

// MIDI note numbers for GM drums
const DRUM_MIDI_MAP: Record<string, number> = {
  'kick': 36,     // C1
  'snare': 38,    // D1
  'hat': 42,      // F#1
  'openhat': 46,  // A#1
  'crash': 49,    // C#2
  'ride': 51,     // D#2
  'tom1': 48,     // C2
  'tom2': 45,     // A1
  'tom3': 43,     // G1
  'clap': 39,     // D#1
  'rim': 37,      // C#1
}

// =============================================================================
// LiveDrumBuilder
// =============================================================================

/**
 * LiveDrumBuilder provides drum-specific operations with custom mapping support.
 * Mirrors DrumBuilder API for live coding with direct SAB synchronization.
 */
export class LiveDrumBuilder extends LiveClipBuilder {
  protected _drumMap: Record<string, number>

  constructor(bridge: SiliconBridge, name: string = 'Untitled Drums') {
    super(bridge, name)
    this._drumMap = { ...DRUM_MIDI_MAP }
  }

  // ===========================================================================
  // Drum Mapping
  // ===========================================================================

  /**
   * Create a new DrumBuilder with a custom drum mapping.
   */
  withMapping<T extends { readonly [k: string]: NoteName }>(mapping: T): this {
    // Convert NoteName to MIDI numbers
    const { noteToMidi } = require('../util/midi')
    for (const key in mapping) {
      if (Object.prototype.hasOwnProperty.call(mapping, key)) {
        const value = (mapping as Record<string, NoteName>)[key]
        const midi = noteToMidi(value)
        if (midi !== null) {
          this._drumMap[key.toLowerCase()] = midi
        }
      }
    }
    return this
  }

  // ===========================================================================
  // Drum Hit Methods
  // ===========================================================================

  /**
   * Generic drum hit.
   * Returns a cursor for applying modifiers.
   */
  hit(drum: string): LiveDrumHitCursor<this> {
    const pitch = this.resolveDrum(drum)
    const duration = this.resolveDuration(this._defaultDuration ?? '16n')
    const velocity = this.currentVelocity

    const sourceId = this.getSourceIdFromCallSite()
    const noteData = this.synchronizeNote(sourceId, pitch, velocity, duration, this.currentTick)
    this.currentTick += duration

    const drumData: LiveDrumHitData = {
      ...noteData,
      drumName: drum.toLowerCase()
    }

    return new LiveDrumHitCursor(this, drumData)
  }

  /**
   * Kick drum.
   */
  kick(): LiveDrumHitCursor<this> {
    return this.hit('kick')
  }

  /**
   * Snare drum.
   */
  snare(): LiveDrumHitCursor<this> {
    return this.hit('snare')
  }

  /**
   * Hi-hat (closed).
   */
  hat(): LiveDrumHitCursor<this> {
    return this.hit('hat')
  }

  /**
   * Hi-hat (open).
   */
  openHat(): LiveDrumHitCursor<this> {
    return this.hit('openhat')
  }

  /**
   * Crash cymbal.
   */
  crash(): LiveDrumHitCursor<this> {
    return this.hit('crash')
  }

  /**
   * Ride cymbal.
   */
  ride(): LiveDrumHitCursor<this> {
    return this.hit('ride')
  }

  /**
   * Clap.
   */
  clap(): LiveDrumHitCursor<this> {
    return this.hit('clap')
  }

  /**
   * Tom drum (1, 2, or 3).
   */
  tom(which: 1 | 2 | 3 = 1): LiveDrumHitCursor<this> {
    return this.hit(`tom${which}`)
  }

  // ===========================================================================
  // Euclidean Patterns
  // ===========================================================================

  /**
   * Generate Euclidean rhythm pattern.
   */
  euclidean(options: EuclideanOptions): this {
    const {
      hits,
      steps,
      note,
      stepDuration = '16n',
      velocity = 1,
      rotation = 0,
      repeat = 1
    } = options

    if (hits < 0 || steps < 1) {
      throw new Error('euclidean: hits must be >= 0, steps must be >= 1')
    }

    let pattern = euclidean(hits, steps)
    if (rotation !== 0) {
      pattern = rotatePattern(pattern, rotation)
    }

    const pitch = this.resolveDrum(note)
    const dur = this.resolveDuration(stepDuration)
    const vel = velocity <= 1 ? Math.round(velocity * 127) : Math.round(velocity)

    let r = 0
    while (r < repeat) {
      let p = 0
      while (p < pattern.length) {
        const isHit = pattern[p]
        if (isHit) {
          const sourceId = this.getSourceIdFromCallSite(this.currentTick) // Use tick as offset for unique ID
          this.synchronizeNote(sourceId, pitch, vel, dur, this.currentTick)
        }
        this.currentTick += dur
        p = p + 1
      }
      r = r + 1
    }

    return this
  }

  // ===========================================================================
  // Drum Resolution
  // ===========================================================================

  /**
   * Resolve drum name to MIDI pitch.
   */
  protected resolveDrum(drum: string): number {
    const normalized = drum.toLowerCase()
    const midi = this._drumMap[normalized]
    if (midi !== undefined) {
      return midi
    }

    // Try to parse as a note name
    const { noteToMidi } = require('../util/midi')
    const parsed = noteToMidi(drum)
    if (parsed !== null) {
      return parsed
    }

    // Default to kick
    return this._drumMap['kick'] ?? 36
  }
}
