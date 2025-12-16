/**
 * RFC-031: Live Coding Runtime - Audio Backends
 * 
 * Public exports for audio backend implementations.
 */

// Types
export type {
  AudioBackend,
  WebAudioBackendOptions,
  MIDIBackendOptions,
  TrackInstrumentMap,
  BackendInstrumentConfig,
  ScheduledNodeInfo,
  BackendState
} from './types'

// WebAudio Backend
export { WebAudioBackend } from './WebAudioBackend'

// MIDI Backend
export { MIDIBackend } from './MIDIBackend'
