// =============================================================================
// SymphonyScript - Clip Factory (RFC-043 Phase 4)
// =============================================================================
// Factory that silently injects SiliconBridge into Live builders.
// User API remains unchanged: Clip.melody('Lead').note('C4', '4n')...

import { LiveClipBuilder } from './LiveClipBuilder'
import { LiveMelodyBuilder } from './LiveMelodyBuilder'
import { LiveDrumBuilder } from './LiveDrumBuilder'
import { LiveKeyboardBuilder } from './LiveKeyboardBuilder'
import { LiveStringsBuilder } from './LiveStringsBuilder'
import { LiveWindBuilder } from './LiveWindBuilder'
import { LiveSession } from './LiveSession'

// =============================================================================
// Clip Factory
// =============================================================================

/**
 * Clip factory for live coding.
 *
 * Usage:
 * ```typescript
 * // Initialize session once
 * LiveSession.init(bridge)
 *
 * // User code (unchanged from existing API)
 * Clip.melody('Lead')
 *   .note('C4', '4n').velocity(0.8).commit()
 *   .note('E4', '4n')
 *   .finalize()
 *
 * Clip.drums('Kit')
 *   .kick().accent().hat().snare().hat()
 *   .finalize()
 *
 * Clip.keyboard('Piano')
 *   .sustain()
 *   .chord('Cmaj7', 4, '2n')
 *   .release()
 *   .finalize()
 * ```
 *
 * The bridge is silently injected - user never sees it.
 */
export const Clip = {
  /**
   * Create a melody clip builder.
   * Returns LiveMelodyBuilder with note, chord, transpose, scale, etc.
   * @param name - Clip name (for identification)
   */
  melody(name: string): LiveMelodyBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveMelodyBuilder(bridge, name)
  },

  /**
   * Create a drums clip builder.
   * Returns LiveDrumBuilder with kick, snare, hat, euclidean, etc.
   * @param name - Clip name (for identification)
   */
  drums(name: string): LiveDrumBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveDrumBuilder(bridge, name)
  },

  /**
   * Create a bass clip builder.
   * Returns LiveMelodyBuilder (bass uses melody operations).
   * @param name - Clip name (for identification)
   */
  bass(name: string): LiveMelodyBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveMelodyBuilder(bridge, name)
  },

  /**
   * Create a keyboard clip builder.
   * Returns LiveKeyboardBuilder with sustain, release + melody operations.
   * @param name - Clip name (for identification)
   */
  keyboard(name: string): LiveKeyboardBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveKeyboardBuilder(bridge, name)
  },

  /**
   * Create a piano clip builder (alias for keyboard).
   * @param name - Clip name (for identification)
   */
  piano(name: string): LiveKeyboardBuilder {
    return Clip.keyboard(name)
  },

  /**
   * Create a strings clip builder.
   * Returns LiveStringsBuilder with bend, slide, bendReset + melody operations.
   * @param name - Clip name (for identification)
   */
  strings(name: string): LiveStringsBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveStringsBuilder(bridge, name)
  },

  /**
   * Create a wind clip builder.
   * Returns LiveWindBuilder with breath, expressionCC + melody operations.
   * @param name - Clip name (for identification)
   */
  wind(name: string): LiveWindBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveWindBuilder(bridge, name)
  },

  /**
   * Create a generic clip builder.
   * Returns base LiveClipBuilder.
   * @param name - Clip name (for identification)
   */
  create(name: string): LiveClipBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveClipBuilder(bridge, name)
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { LiveClipBuilder } from './LiveClipBuilder'
export { LiveMelodyBuilder } from './LiveMelodyBuilder'
export { LiveDrumBuilder } from './LiveDrumBuilder'
export { LiveKeyboardBuilder } from './LiveKeyboardBuilder'
export { LiveStringsBuilder } from './LiveStringsBuilder'
export { LiveWindBuilder } from './LiveWindBuilder'
export { LiveSession, executeUserScript } from './LiveSession'
