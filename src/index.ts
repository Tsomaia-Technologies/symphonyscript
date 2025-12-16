// =============================================================================
// SymphonyScript - Bridge Module
// Re-exports from @symphonyscript/core and platform-specific modules
// =============================================================================

// --- Core (re-exported from @symphonyscript// Core re-exports
export * from '@symphonyscript/core'

/**
 * Runtime (Web Audio API)
 */
export {
  createPlaybackEngine,
  type PlaybackEngine,
  type TransportState
} from '@symphonyscript/runtime-webaudio'

// --- Live Coding - stays here until Phase 4 ---
export * from './live/index'
