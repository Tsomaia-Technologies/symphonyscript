// =============================================================================
// SymphonyScript - LiveWindBuilder (RFC-043 Phase 4)
// =============================================================================
// Wind instrument builder with breath control capabilities.
// Extends LiveMelodyBuilder with wind-specific operations.

import { LiveMelodyBuilder } from './LiveMelodyBuilder'
import type { SiliconBridge } from './silicon-bridge'

// =============================================================================
// LiveWindBuilder
// =============================================================================

/**
 * LiveWindBuilder extends LiveMelodyBuilder with wind instrument capabilities.
 * Mirrors WindBuilder API for live coding with direct SAB synchronization.
 */
export class LiveWindBuilder extends LiveMelodyBuilder {
  constructor(bridge: SiliconBridge, name: string = 'Untitled Wind') {
    super(bridge, name)
  }

  /**
   * Set breath control amount (0-1).
   * Uses MIDI CC2 (Breath Controller).
   */
  breath(amount: number): this {
    const clamped = Math.max(0, Math.min(1, amount))
    const midiValue = Math.round(clamped * 127)
    return this.control(2, midiValue)
  }

  /**
   * Expression control (MIDI CC 11, usually volume/intensity).
   * Range: 0-1 (mapped to 0-127 MIDI).
   */
  expressionCC(amount: number): this {
    const clamped = Math.max(0, Math.min(1, amount))
    const midiValue = Math.round(clamped * 127)
    return this.control(11, midiValue)
  }
}
