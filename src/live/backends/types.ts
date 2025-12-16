/**
 * RFC-031: Live Coding Runtime - Audio Backend Interface
 * 
 * Defines the contract for audio playback backends (WebAudio, MIDI, etc.).
 */

import type { CompiledEvent } from '../../compiler/pipeline/types'

// =============================================================================
// Audio Backend Interface
// =============================================================================

/**
 * Backend interface for audio/MIDI playback.
 * 
 * Implementations handle the actual rendering of events to sound or MIDI.
 */
export interface AudioBackend {
  /**
   * Schedule an event for playback at a specific audio time.
   * 
   * @param event - The compiled event to schedule
   * @param audioTime - Target time in AudioContext.currentTime units
   */
  schedule(event: CompiledEvent, audioTime: number): void
  
  /**
   * Cancel all events scheduled after a specific beat.
   * Used when splicing in new events for a track.
   * 
   * @param beat - Beat position after which to cancel
   * @param trackId - Optional track to filter by (undefined = all tracks)
   */
  cancelAfter(beat: number, trackId?: string): void
  
  /**
   * Cancel all scheduled events immediately.
   * Used when stopping playback entirely.
   */
  cancelAll(): void
  
  /**
   * Get the current audio context time.
   * 
   * @returns Current time in seconds
   */
  getCurrentTime(): number
  
  /**
   * Update the tempo (BPM).
   * May affect scheduling calculations.
   * 
   * @param bpm - New tempo in beats per minute
   */
  setTempo(bpm: number): void
  
  /**
   * Clean up all resources.
   * Should be called when the session is disposed.
   */
  dispose(): void
}

// =============================================================================
// Backend Factory
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
 * Options for creating a MIDI backend.
 */
export interface MIDIBackendOptions {
  /** MIDI output port to use */
  output?: MIDIOutput
  
  /** Default MIDI channel (1-16, default: 1) */
  defaultChannel?: number
}

// =============================================================================
// Track Instrument Mapping
// =============================================================================

/**
 * Mapping of track IDs to instrument configurations.
 */
export interface TrackInstrumentMap {
  /** Track ID -> instrument configuration */
  [trackId: string]: InstrumentConfig
}

/**
 * Instrument configuration for a track.
 */
export interface InstrumentConfig {
  /** Instrument type */
  type: 'synth' | 'sampler' | 'drums'
  
  /** Additional parameters */
  params?: Record<string, unknown>
}

// =============================================================================
// Scheduled Node Tracking
// =============================================================================

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

// =============================================================================
// Backend State
// =============================================================================

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
