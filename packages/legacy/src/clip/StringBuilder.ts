// =============================================================================
// SymphonyScript - StringBuilder (Bend, Slide, Vibrato)
// =============================================================================

import { MelodyBuilder } from './MelodyBuilder'
import * as Actions from './actions'
import type { NoteDuration, NoteName } from '@symphonyscript/core/types/primitives'
import { validate } from '../validation/runtime'

/**
 * StringBuilder extends MelodyBuilder with string instrument capabilities.
 */
export class StringBuilder extends MelodyBuilder {
  /** Pitch bend in semitones */
  bend(semitones: number): this {
    validate.inRange('bend', 'semitones', semitones, -12, 12)
    return this.play(Actions.bend(semitones))
  }

  /** Slide to another pitch over time */
  slide(targetPitch: NoteName, duration: NoteDuration): this {
    validate.pitch('slide', targetPitch)
    // .note returns cursor, .legato returns cursor, .commit returns builder (MelodyBuilder).
    // Cast to this (StringBuilder)
    return this.note(targetPitch, duration).legato().commit() as this
  }

  /** Reset pitch bend to center */
  bendReset(): this {
    return this.play(Actions.bend(0))
  }
}






