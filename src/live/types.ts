/**
 * RFC-031: Live Coding Runtime - Core Type Definitions
 * 
 * Types for the live coding session, scheduling, and playback.
 */

import type { CompiledEvent, TempoMap } from '@symphonyscript/core'
import type { SessionNode } from '@symphonyscript/core'
import type { CompilationCache } from '@symphonyscript/core'

// =============================================================================
// Quantize Modes
// =============================================================================

/**
 * When changes take effect during live coding.
 * - 'bar': Changes apply at the next bar boundary
 * - 'beat': Changes apply at the next beat boundary
 * - 'off': Changes apply immediately (may cause audio glitches)
 */
export type QuantizeMode = 'bar' | 'beat' | 'off'

// =============================================================================
// Live Session Options
// =============================================================================

/**
 * Configuration options for a LiveSession.
 */
export interface LiveSessionOptions {
  /** Initial tempo in BPM */
  bpm: number
  
  /** Audio backend to use (default: 'webaudio') */
  backend?: 'webaudio' | 'midi' | 'both'
  
  /** Lookahead buffer in seconds (default: 0.1) */
  lookahead?: number
  
  /** When changes take effect (default: 'bar') */
  quantize?: QuantizeMode
  
  /** Time signature for bar calculations (default: '4/4') */
  timeSignature?: `${number}/${number}`
}

// =============================================================================
// Eval Result
// =============================================================================

/**
 * Result of evaluating code in a live session.
 */
export interface EvalResult {
  /** Whether evaluation succeeded */
  success: boolean
  
  /** Error if evaluation failed */
  error?: Error
  
  /** Tracks that were modified (if successful) */
  changedTracks?: string[]
  
  /** Compilation warnings (if any) */
  warnings?: string[]
}

// =============================================================================
// Event Callbacks
// =============================================================================

/** Callback for beat events */
export type BeatCallback = (beat: number) => void

/** Callback for bar events */
export type BarCallback = (bar: number) => void

/** Callback for error events */
export type ErrorCallback = (error: Error) => void

/** Live session event types */
export type LiveSessionEvent = 'beat' | 'bar' | 'error'

/** Event handler map */
export type LiveSessionEventHandler<E extends LiveSessionEvent> = 
  E extends 'beat' ? BeatCallback :
  E extends 'bar' ? BarCallback :
  E extends 'error' ? ErrorCallback :
  never

// =============================================================================
// Unsubscribe Function
// =============================================================================

/** Function to unsubscribe from events or stop watching */
export type Unsubscribe = () => void

// =============================================================================
// Scheduler Types
// =============================================================================

/**
 * A scheduled event with its target audio time.
 */
export interface ScheduledEvent {
  /** The compiled event to play */
  event: CompiledEvent
  
  /** Target audio context time in seconds */
  audioTime: number
  
  /** Beat position of this event */
  beat: number
  
  /** Track ID this event belongs to (if known) */
  trackId?: string
}

/**
 * A pending update to be applied at a quantize boundary.
 */
export interface PendingUpdate {
  /** The beat at which to apply this update */
  targetBeat: number
  
  /** New events to splice in */
  events: CompiledEvent[]
  
  /** Track ID to update (undefined = all tracks) */
  trackId?: string
  
  /** Callback to invoke when update is applied */
  onApplied?: () => void
}

/**
 * Configuration for the StreamingScheduler.
 */
export interface StreamingSchedulerConfig {
  /** BPM for beat calculations */
  bpm: number
  
  /** Lookahead buffer in seconds */
  lookahead: number
  
  /** Scheduling interval in milliseconds */
  scheduleInterval?: number
  
  /** Beats per measure for bar calculations */
  beatsPerMeasure?: number
}

// =============================================================================
// Track State
// =============================================================================

/**
 * State for an individual track in the live session.
 */
export interface TrackState {
  /** Track identifier */
  id: string
  
  /** Current events for this track */
  events: CompiledEvent[]
  
  /** Whether this track is muted */
  muted: boolean
  
  /** Compilation cache for incremental updates */
  cache?: CompilationCache
}

// =============================================================================
// Session State
// =============================================================================

/**
 * Internal state of the live session.
 */
export interface LiveSessionState {
  /** Current session node (if any) */
  session: SessionNode | null
  
  /** Per-track state */
  tracks: Map<string, TrackState>
  
  /** Global compilation cache */
  cache: CompilationCache | null
  
  /** Current tempo map */
  tempoMap: TempoMap | null
  
  /** Whether playback is active */
  isPlaying: boolean
  
  /** Current tempo */
  bpm: number
  
  /** Current quantize mode */
  quantize: QuantizeMode
  
  /** Time signature */
  timeSignature: `${number}/${number}`
}

// =============================================================================
// Scheduled Callback
// =============================================================================

/**
 * A callback scheduled to run at a specific beat.
 */
export interface ScheduledCallback {
  /** Target beat */
  beat: number
  
  /** Callback to invoke */
  callback: () => void
  
  /** Whether this callback has been executed */
  executed: boolean
}
