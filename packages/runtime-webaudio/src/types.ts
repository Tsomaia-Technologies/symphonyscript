/**
 * Runtime type definitions.
 */

export type {PlaybackEngine} from './engine'
export type {TransportState} from './transport'
export type {Scheduler, SchedulerConfig} from './scheduler'
export type {SynthConfig, ADSR} from './synth'

// =============================================================================
// WebAudio Backend Types
// =============================================================================

/**
 * Options for creating a WebAudio backend.
 */
export interface WebAudioBackendOptions {
  /** Existing AudioContext to use (created if not provided) */
  audioContext?: AudioContext
  
  /** Master gain level (0-1, default: 0.8) */
  masterGain?: number
  
  /** Random seed for deterministic synthesis (optional) */
  seed?: number
}

/**
 * Information about a scheduled audio node for cleanup.
 */
export interface ScheduledNodeInfo {
  /** The audio node (oscillator, buffer source, etc.) */
  node: AudioScheduledSourceNode
  
  /** The beat position of this event */
  beat: number
  
  /** Track ID this node belongs to */
  trackId?: string
  
  /** Scheduled stop time */
  stopTime: number
}

/**
 * State tracking for a backend.
 */
export interface BackendState {
  /** Whether the backend is initialized */
  initialized: boolean
  
  /** Whether the backend is disposed */
  disposed: boolean
  
  /** Current tempo */
  bpm: number
  
  /** Scheduled nodes for cleanup */
  scheduledNodes: ScheduledNodeInfo[]
}
