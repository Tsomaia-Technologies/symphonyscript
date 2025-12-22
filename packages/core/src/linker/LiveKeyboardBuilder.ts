// =============================================================================
// SymphonyScript - LiveKeyboardBuilder (RFC-043 Phase 4)
// =============================================================================
// Keyboard builder with sustain pedal capabilities.
// Extends LiveMelodyBuilder with keyboard-specific operations.

import { LiveMelodyBuilder } from './LiveMelodyBuilder'
import type { SiliconBridge } from '../../../kernel/src/silicon-bridge'

// =============================================================================
// LiveKeyboardBuilder
// =============================================================================

/**
 * LiveKeyboardBuilder extends LiveMelodyBuilder with sustain pedal capabilities.
 * Mirrors KeyboardBuilder API for live coding with direct SAB synchronization.
 */
export class LiveKeyboardBuilder extends LiveMelodyBuilder {
  constructor(bridge: SiliconBridge, name: string = 'Untitled Keyboard') {
    super(bridge, name)
  }

  /**
   * Press sustain pedal (CC64 on).
   */
  sustain(): this {
    // CC64 = Sustain Pedal, value 127 = on
    return this.control(64, 127)
  }

  /**
   * Release sustain pedal (CC64 off).
   */
  release(): this {
    // CC64 = Sustain Pedal, value 0 = off
    return this.control(64, 0)
  }
}
