// =============================================================================
// SymphonyScript - Clip Factory (RFC-043 Phase 4)
// =============================================================================
// Factory that silently injects SiliconBridge into LiveClipBuilder.
// User API remains unchanged: Clip.melody('Lead').note(60)...

import { LiveClipBuilder } from './LiveClipBuilder'
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
 *   .note(60, 100, '4n')
 *   .note(64, 100, '4n')
 *   .note(67, 100, '4n')
 *   .finalize()
 * ```
 *
 * The bridge is silently injected - user never sees it.
 */
export const Clip = {
  /**
   * Create a melody clip builder.
   * @param name - Clip name (for identification)
   */
  melody(name: string): LiveClipBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveClipBuilder(bridge, name)
  },

  /**
   * Create a drums clip builder.
   * @param name - Clip name (for identification)
   */
  drums(name: string): LiveClipBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveClipBuilder(bridge, name)
  },

  /**
   * Create a bass clip builder.
   * @param name - Clip name (for identification)
   */
  bass(name: string): LiveClipBuilder {
    const bridge = LiveSession.getActiveBridge()
    return new LiveClipBuilder(bridge, name)
  },

  /**
   * Create a generic clip builder.
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
export { LiveSession, executeUserScript } from './LiveSession'
