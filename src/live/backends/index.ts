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

// MIDIBackend moved to @symphonyscript/midi-backend-web
// For Web MIDI: import { WebMIDIBackend } from '@symphonyscript/midi-backend-web'
// For Node.js MIDI: import { NodeMIDIBackend } from '@symphonyscript/midi-backend-node'
