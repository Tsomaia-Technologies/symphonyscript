// =============================================================================
// SymphonyScript - DrumBuilder (with Custom Mapping Support)
// =============================================================================

import { ClipBuilder } from './ClipBuilder'
import * as Actions from './actions'
import { euclidean, rotatePattern } from '@symphonyscript/core/generators/euclidean'
import type { NoteDuration, NoteName } from '@symphonyscript/core/types/primitives'
import type { DrumParams } from './types'
import { DrumHitCursor } from './cursors/DrumHitCursor'

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

export interface EuclideanOptions {
  /** Number of hits (pulses) */
  hits: number
  /** Total steps in pattern */
  steps: number
  /** Note/drum to trigger on hits */
  note: string
  /** Duration of each step (default: '16n') */
  stepDuration?: NoteDuration
  /** Velocity for hits (default: 1) */
  velocity?: number
  /** Rotation offset (default: 0) */
  rotation?: number
  /** Number of times to repeat pattern (default: 1) */
  repeat?: number
}

/**
 * DrumBuilder provides drum-specific operations with custom mapping support.
 */
export class DrumBuilder extends ClipBuilder<DrumParams> {
  constructor(params: DrumParams) {
    super({
      ...params,
      drumMap: params.drumMap ?? DEFAULT_DRUM_MAP
    })
  }

  protected get _drumMap(): Record<string, NoteName> {
    return this._params.drumMap ?? DEFAULT_DRUM_MAP
  }

  /**
   * Create a new DrumBuilder with a custom drum mapping.
   */
  withMapping<T extends { readonly [k: string]: NoteName }>(mapping: T): DrumBuilder {
    return this._withParams({ drumMap: { ...this._drumMap, ...mapping } })
  }

  /** Generic drum hit */
  hit(drum: string): DrumHitCursor {
    const pitch = this.resolveNote(drum)
    // Default 16n, velocity 1 (unless defaultDuration set)
    const duration = this._params.defaultDuration ?? '16n'
    const op = Actions.note(pitch, duration, 1)
    return new DrumHitCursor(this, op)
  }

  /** Kick drum */
  kick(): DrumHitCursor {
    return this.hit('kick')
  }

  /** Snare drum */
  snare(): DrumHitCursor {
    return this.hit('snare')
  }

  /** Hi-hat (closed) */
  hat(): DrumHitCursor {
    return this.hit('hat')
  }

  /** Hi-hat (open) */
  openHat(): DrumHitCursor {
    return this.hit('openhat')
  }

  /** Crash cymbal */
  crash(): DrumHitCursor {
    return this.hit('crash')
  }

  /** Ride cymbal */
  ride(): DrumHitCursor {
    return this.hit('ride')
  }

  /** Clap */
  clap(): DrumHitCursor {
    return this.hit('clap')
  }

  /** Tom drum (1, 2, or 3) */
  tom(which: 1 | 2 | 3 = 1): DrumHitCursor {
    return this.hit(`tom${which}`)
  }

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

    let builder: this = this
    const pitch = this.resolveNote(note)

    for (let r = 0; r < repeat; r++) {
      for (const isHit of pattern) {
        if (isHit) {
          // Direct play logic is fine here for bulk generation
          builder = builder.play(Actions.note(pitch, stepDuration, velocity))
        } else {
          builder = builder.rest(stepDuration)
        }
      }
    }

    return builder
  }

  /** Resolve drum name to note using current mapping */
  private resolveNote(drum: string): NoteName {
    return this._drumMap[drum.toLowerCase()] ?? drum
  }
}






