/**
 * @symphonyscript/runtime-webaudio
 *
 * Web Audio API runtime and backend for SymphonyScript.
 */

export * from './types'
export * from './backend'
export * from './context'
export * from './engine'
export * from './scheduler'
export * from './synth'
export * from './transport'

// Silicon Linker integration (RFC-043 Phase 3)
export * from './silicon-node'
export * from './silicon-backend'

// Re-export specific items for clarity
export { WebAudioBackend } from './backend'
export { createPlaybackEngine } from './engine'
export { getAudioContext, ensureAudioContextRunning } from './context'

// Silicon Linker exports
export { SiliconNode, createSiliconNode } from './silicon-node'
export { SiliconBackend, createSiliconBackend } from './silicon-backend'
