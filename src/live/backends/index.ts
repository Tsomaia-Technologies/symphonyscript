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
export { WebAudioBackend } from '@symphonyscript/runtime-webaudio'

// MIDI Backend
export { MIDIBackend } from './MIDIBackend'
