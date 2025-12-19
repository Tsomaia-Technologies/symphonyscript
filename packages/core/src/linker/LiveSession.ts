// =============================================================================
// SymphonyScript - Live Session (RFC-043 Phase 4)
// =============================================================================
// Session management for Live Mirror pattern. Holds active SiliconBridge.

import type { SiliconBridge } from './silicon-bridge'

// =============================================================================
// Module-level State
// =============================================================================

let activeBridge: SiliconBridge | null = null

// =============================================================================
// LiveSession
// =============================================================================

/**
 * LiveSession manages the active SiliconBridge for live coding.
 *
 * Usage:
 * 1. Call LiveSession.init(bridge) before executing user scripts
 * 2. Clip.melody() etc. will silently inject the bridge
 * 3. Call LiveSession.finalize() after script execution to prune tombstones
 */
export class LiveSession {
  /**
   * Initialize the session with a SiliconBridge.
   * Must be called before any DSL calls.
   */
  static init(bridge: SiliconBridge): void {
    activeBridge = bridge
  }

  /**
   * Get the active bridge.
   * Throws if session not initialized.
   */
  static getActiveBridge(): SiliconBridge {
    if (!activeBridge) {
      throw new Error('LiveSession not initialized. Call LiveSession.init(bridge) first.')
    }
    return activeBridge
  }

  /**
   * Check if session is initialized.
   */
  static isInitialized(): boolean {
    return activeBridge !== null
  }

  /**
   * Clear the active session.
   */
  static clear(): void {
    activeBridge = null
  }
}

// =============================================================================
// Script Execution Helper
// =============================================================================

/**
 * Execute a user script with automatic tombstone pruning.
 *
 * @param script - User script function that uses Clip.melody() etc.
 * @param bridge - SiliconBridge to use
 * @returns The LiveClipBuilder returned by the script (if any)
 */
export function executeUserScript<T>(
  script: () => T,
  bridge: SiliconBridge
): T {
  LiveSession.init(bridge)
  try {
    return script()
  } finally {
    // Note: finalize() should be called on the returned builder
    // This is handled by the LiveClipBuilder
  }
}
