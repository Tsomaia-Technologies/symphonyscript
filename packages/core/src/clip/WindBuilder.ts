// =============================================================================
// SymphonyScript - WindBuilder (Breath Control)
// =============================================================================

import {MelodyBuilder} from './MelodyBuilder'
import * as Actions from './actions'
import type {HasWindTechniques} from './capabilities'
import {validate} from '../validation/runtime'

/**
 * WindBuilder extends MelodyBuilder with wind instrument capabilities.
 */
export class WindBuilder extends MelodyBuilder implements HasWindTechniques<WindBuilder> {
  /** Set breath control amount (0-1) */
  breath(amount: number): this {
    validate.inRange('breath', 'amount', amount, 0, 1)
    return this.play(Actions.breath(amount))
  }

  /** Expression control (MIDI CC 11, usually volume/intensity) 0-1 */
  expressionCC(amount: number): this {
    validate.inRange('expressionCC', 'amount', amount, 0, 1)
    return this.play(Actions.expression(amount))
  }
}






