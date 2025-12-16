// =============================================================================
// SymphonyScript - Bridge Module
// Re-exports from @symphonyscript/core and platform-specific modules
// =============================================================================

// --- Core (re-exported from @symphonyscript/core) ---
export * from '@symphonyscript/core'

// --- Runtime (Web Audio) - stays here until Phase 3 ---
export { createPlaybackEngine } from './runtime/engine'
export type { PlaybackEngine, TransportState } from './runtime/types'

// --- Live Coding - stays here until Phase 4 ---
export * from './live/index'
