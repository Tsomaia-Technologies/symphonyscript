/**
 * RFC-031: Live Coding Runtime - Safe Code Evaluation
 * 
 * Provides sandboxed code evaluation using new Function() instead of eval().
 * This approach limits scope access and runs in strict mode for safety.
 */

import type { SessionNode, TrackNode } from '@symphonyscript/core'
import type { ClipNode } from '@symphonyscript/core'
import type { LiveSession } from './LiveSession'

// Import DSL components for eval context
import { ClipFactory } from '@symphonyscript/core'
import { Session, session, Track } from '@symphonyscript/core'
import { Synth, Sampler, synth, sampler, InstrumentFactory } from '@symphonyscript/core'

// =============================================================================
// Types
// =============================================================================

/**
 * Result of evaluating code.
 */
export interface SafeEvalResult {
  /** Whether evaluation succeeded */
  success: boolean
  
  /** The result value (if any) */
  value?: unknown
  
  /** Error if evaluation failed */
  error?: Error
  
  /** Extracted session from evaluation */
  session?: SessionNode
  
  /** Individual tracks defined (if no full session) */
  tracks?: Map<string, TrackDefinition>
}

/**
 * Track definition captured from eval.
 */
export interface TrackDefinition {
  /** Track name */
  name: string
  
  /** Track clip */
  clip: ClipNode
  
  /** Track instrument (optional - uses default if not provided) */
  instrument?: any
}

/**
 * Context exposed to evaluated code.
 */
export interface EvalContext {
  // Clip building
  Clip: typeof ClipFactory
  
  // Session building
  Session: typeof Session
  session: typeof session
  Track: typeof Track
  
  // Instruments
  Synth: typeof Synth
  Sampler: typeof Sampler
  synth: typeof synth
  sampler: typeof sampler
  Instrument: typeof InstrumentFactory
  
  // Track helper (for simplified syntax)
  track: (name: string, builder: (t: TrackBuilder) => TrackBuilder) => void
  
  // Captured values
  __tracks__: Map<string, TrackDefinition>
  __session__: SessionNode | null
}

/**
 * Simplified track builder for live coding.
 */
export interface TrackBuilder {
  clip(clip: ClipNode | { build(): ClipNode }): TrackBuilder
  instrument(inst: any): TrackBuilder
}

// =============================================================================
// Context Creation
// =============================================================================

/**
 * Create the evaluation context with DSL objects.
 * 
 * @param live - LiveSession instance for context (optional)
 * @returns Evaluation context
 */
export function createEvalContext(live?: LiveSession): EvalContext {
  // Storage for captured tracks and session
  const capturedTracks = new Map<string, TrackDefinition>()
  let capturedSession: SessionNode | null = null
  
  // Track helper function
  const trackHelper = (name: string, builder: (t: TrackBuilder) => TrackBuilder) => {
    // Create a simple track builder
    let trackClip: ClipNode | null = null
    let trackInstrument: any = null
    
    const tb: TrackBuilder = {
      clip(c) {
        trackClip = 'build' in c && typeof c.build === 'function' 
          ? c.build() 
          : c as ClipNode
        return tb
      },
      instrument(inst) {
        trackInstrument = inst
        return tb
      }
    }
    
    // Execute builder
    builder(tb)
    
    // Store the track definition
    if (trackClip) {
      capturedTracks.set(name, {
        name,
        clip: trackClip,
        instrument: trackInstrument
      })
    }
  }
  
  // Wrap Session to capture when built
  const WrappedSession = class extends Session {
    build(): SessionNode {
      const node = super.build()
      capturedSession = node
      return node
    }
  }
  
  // Wrap session factory to use WrappedSession
  const wrappedSessionFactory = (options?: Parameters<typeof session>[0]) => {
    if (options?.tempo || options?.timeSignature || options?.defaultDuration) {
      return new WrappedSession([], [], options?.tempo, options?.timeSignature, options?.defaultDuration)
    }
    return new WrappedSession([], [])
  }
  
  return {
    // Clip building
    Clip: ClipFactory,
    
    // Session building (with capture)
    Session: WrappedSession as unknown as typeof Session,
    session: wrappedSessionFactory,
    Track,
    
    // Instruments
    Synth,
    Sampler,
    synth,
    sampler,
    Instrument: InstrumentFactory,
    
    // Track helper
    track: trackHelper,
    
    // Internal storage (accessed after eval)
    __tracks__: capturedTracks,
    __session__: capturedSession
  }
}

// =============================================================================
// Safe Evaluation
// =============================================================================

/**
 * Safely evaluate code using new Function() with explicit scope.
 * 
 * @param code - Code string to evaluate
 * @param context - Evaluation context
 * @returns Evaluation result
 */
export async function safeEval(
  code: string,
  context: EvalContext
): Promise<SafeEvalResult> {
  try {
    // Get context keys and values (excluding internal storage)
    const publicKeys = Object.keys(context).filter(k => !k.startsWith('__'))
    const publicValues = publicKeys.map(k => (context as any)[k])
    
    // Create function with explicit scope and strict mode
    // Wrap in async IIFE to support await
    // Use eval-like return for last expression
    const fn = new Function(
      ...publicKeys,
      `"use strict";
       return (async () => {
         ${code}
       })()`
    )
    
    // Execute with context values
    const result = await fn(...publicValues)
    
    // Extract captured session/tracks from context (they're updated by reference)
    const capturedSession = context.__session__
    const capturedTracks = context.__tracks__
    
    return {
      success: true,
      value: result,
      session: capturedSession ?? undefined,
      tracks: capturedTracks.size > 0 ? capturedTracks : undefined
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    }
  }
}

// =============================================================================
// Session Diffing
// =============================================================================

/**
 * Compare two sessions and find changed tracks.
 * 
 * @param oldSession - Previous session (or null)
 * @param newSession - New session
 * @returns Array of changed track names
 */
export function diffSessions(
  oldSession: SessionNode | null,
  newSession: SessionNode
): string[] {
  const changedTracks: string[] = []
  
  // If no old session, all tracks are new
  if (!oldSession) {
    return newSession.tracks.map(t => t.name ?? `track-${newSession.tracks.indexOf(t)}`)
  }
  
  // Build map of old tracks by name
  const oldTrackMap = new Map<string, TrackNode>()
  oldSession.tracks.forEach((track, i) => {
    const name = track.name ?? `track-${i}`
    oldTrackMap.set(name, track)
  })
  
  // Compare each track in new session
  newSession.tracks.forEach((newTrack, i) => {
    const name = newTrack.name ?? `track-${i}`
    const oldTrack = oldTrackMap.get(name)
    
    if (!oldTrack) {
      // New track
      changedTracks.push(name)
    } else if (!tracksEqual(oldTrack, newTrack)) {
      // Track changed
      changedTracks.push(name)
    }
    
    // Remove from old map to track deletions
    oldTrackMap.delete(name)
  })
  
  // Remaining old tracks were deleted
  for (const name of oldTrackMap.keys()) {
    changedTracks.push(name)
  }
  
  return changedTracks
}

/**
 * Compare two tracks for equality.
 * Uses a simple JSON comparison of clips.
 */
function tracksEqual(a: TrackNode, b: TrackNode): boolean {
  // Compare clips by serializing (simple but effective)
  try {
    const clipA = JSON.stringify(a.clip.operations)
    const clipB = JSON.stringify(b.clip.operations)
    return clipA === clipB
  } catch {
    return false
  }
}

/**
 * Merge track definitions into a session.
 * 
 * @param baseSession - Base session to merge into (or null)
 * @param tracks - Track definitions to merge
 * @param defaultInstrument - Default instrument for tracks without one
 * @returns New session with merged tracks
 */
export function mergeTracksIntoSession(
  baseSession: SessionNode | null,
  tracks: Map<string, TrackDefinition>,
  defaultInstrument: any
): SessionNode {
  // Start with base session or empty
  const existingTracks: TrackNode[] = baseSession?.tracks.slice() ?? []
  const trackMap = new Map<string, TrackNode>()
  
  // Index existing tracks
  existingTracks.forEach(track => {
    const name = track.name ?? `track-${existingTracks.indexOf(track)}`
    trackMap.set(name, track)
  })
  
  // Merge new track definitions
  for (const [name, def] of tracks) {
    const existing = trackMap.get(name)
    
    trackMap.set(name, {
      _version: existing?._version ?? (baseSession?._version as any),
      kind: 'track',
      name,
      clip: def.clip,
      instrument: def.instrument ?? existing?.instrument ?? defaultInstrument,
      midiChannel: existing?.midiChannel
    })
  }
  
  // Build final session
  return {
    _version: baseSession?._version as any,
    kind: 'session',
    tracks: Array.from(trackMap.values()),
    tempo: baseSession?.tempo,
    timeSignature: baseSession?.timeSignature,
    effectBuses: baseSession?.effectBuses
  }
}

// =============================================================================
// Code Preprocessing
// =============================================================================

/**
 * Preprocess code before evaluation.
 * Adds common patterns and fixes.
 */
export function preprocessCode(code: string): string {
  // Trim whitespace
  let processed = code.trim()
  
  // If code doesn't end with semicolon, add one
  if (!processed.endsWith(';') && !processed.endsWith('}')) {
    processed += ';'
  }
  
  return processed
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Basic validation of code before evaluation.
 * Checks for obviously dangerous patterns.
 */
export function validateCode(code: string): { valid: boolean; error?: string } {
  // Check for forbidden patterns
  const forbidden = [
    /\bprocess\b/,        // Node.js process
    /\brequire\b/,        // CommonJS require
    /\bimport\b/,         // ES imports
    /\bexport\b/,         // ES exports
    /\b__dirname\b/,      // Node.js paths
    /\b__filename\b/,
    /\bglobal\b/,         // Node global
    /\bwindow\b/,         // Browser window
    /\bdocument\b/,       // Browser DOM
    /\bfetch\b/,          // Network access
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
  ]
  
  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      return {
        valid: false,
        error: `Forbidden pattern detected: ${pattern.source}`
      }
    }
  }
  
  return { valid: true }
}
