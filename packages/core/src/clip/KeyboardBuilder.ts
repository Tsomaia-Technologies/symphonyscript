// =============================================================================
// SymphonyScript - KeyboardBuilder (Sustain Pedal)
// =============================================================================

import {MelodyBuilder} from './MelodyBuilder'
import * as Actions from './actions'

/**
 * KeyboardBuilder extends MelodyBuilder with sustain pedal capabilities.
 */
export class KeyboardBuilder extends MelodyBuilder {
  /** Press sustain pedal (CC64 on) */
  sustain(): this {
    return this.play(Actions.sustain())
  }

  /** Release sustain pedal (CC64 off) */
  release(): this {
    return this.play(Actions.release())
  }
}






