/**
 * RFC-031: Live Coding Runtime - Beat-Grid Quantization
 * 
 * Utilities for calculating beat and bar boundaries for synchronized updates.
 */

import type { QuantizeMode } from './types'

// =============================================================================
// Time Signature Parsing
// =============================================================================

/**
 * Parse a time signature string into beats per measure.
 * 
 * @param timeSignature - Time signature string (e.g., '4/4', '3/4', '6/8')
 * @returns Beats per measure (top number)
 */
export function parseTimeSignature(timeSignature: `${number}/${number}`): {
  beatsPerMeasure: number
  beatUnit: number
} {
  const [numerator, denominator] = timeSignature.split('/').map(Number)
  return {
    beatsPerMeasure: numerator,
    beatUnit: denominator
  }
}

// =============================================================================
// Beat Calculations
// =============================================================================

/**
 * Get the next beat boundary from the current position.
 * 
 * @param currentBeat - Current beat position (can be fractional)
 * @returns Next whole beat number
 */
export function getNextBeat(currentBeat: number): number {
  return Math.ceil(currentBeat)
}

/**
 * Get the next bar boundary from the current position.
 * 
 * @param currentBeat - Current beat position (can be fractional)
 * @param beatsPerMeasure - Number of beats per measure (from time signature)
 * @returns Beat number at the start of the next bar
 */
export function getNextBarBeat(currentBeat: number, beatsPerMeasure: number): number {
  // If we're exactly on a bar boundary, return the next bar
  const currentBar = Math.floor(currentBeat / beatsPerMeasure)
  const nextBar = currentBeat % beatsPerMeasure === 0 
    ? currentBar + 1 
    : currentBar + 1
  return nextBar * beatsPerMeasure
}

/**
 * Get the current bar number (0-indexed).
 * 
 * @param currentBeat - Current beat position
 * @param beatsPerMeasure - Number of beats per measure
 * @returns Current bar number (0-indexed)
 */
export function getCurrentBar(currentBeat: number, beatsPerMeasure: number): number {
  return Math.floor(currentBeat / beatsPerMeasure)
}

/**
 * Get the beat position within the current bar (0-indexed).
 * 
 * @param currentBeat - Current beat position
 * @param beatsPerMeasure - Number of beats per measure
 * @returns Beat within current bar (0 to beatsPerMeasure-1)
 */
export function getBeatInBar(currentBeat: number, beatsPerMeasure: number): number {
  return currentBeat % beatsPerMeasure
}

// =============================================================================
// Quantize Target Calculation
// =============================================================================

/**
 * Calculate the target beat for a quantized update.
 * 
 * @param currentBeat - Current beat position
 * @param mode - Quantize mode ('bar', 'beat', or 'off')
 * @param beatsPerMeasure - Number of beats per measure
 * @returns Target beat for the update
 */
export function getQuantizeTargetBeat(
  currentBeat: number,
  mode: QuantizeMode,
  beatsPerMeasure: number
): number {
  switch (mode) {
    case 'bar':
      return getNextBarBeat(currentBeat, beatsPerMeasure)
    case 'beat':
      return getNextBeat(currentBeat)
    case 'off':
      return currentBeat
  }
}

// =============================================================================
// Time Conversions
// =============================================================================

/**
 * Convert beats to seconds.
 * 
 * @param beats - Number of beats
 * @param bpm - Tempo in beats per minute
 * @returns Duration in seconds
 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats / bpm) * 60
}

/**
 * Convert seconds to beats.
 * 
 * @param seconds - Duration in seconds
 * @param bpm - Tempo in beats per minute
 * @returns Number of beats
 */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm
}

/**
 * Get the duration of one beat in seconds.
 * 
 * @param bpm - Tempo in beats per minute
 * @returns Beat duration in seconds
 */
export function getBeatDuration(bpm: number): number {
  return 60 / bpm
}

/**
 * Get the duration of one bar in seconds.
 * 
 * @param bpm - Tempo in beats per minute
 * @param beatsPerMeasure - Number of beats per measure
 * @returns Bar duration in seconds
 */
export function getBarDuration(bpm: number, beatsPerMeasure: number): number {
  return beatsToSeconds(beatsPerMeasure, bpm)
}

// =============================================================================
// Lookahead Calculations
// =============================================================================

/**
 * Check if a beat position is within the lookahead window.
 * Events within the lookahead window are already scheduled and should not be cancelled.
 * 
 * @param beat - Beat position to check
 * @param currentBeat - Current playback beat
 * @param lookaheadBeats - Lookahead window in beats
 * @returns True if beat is within lookahead window
 */
export function isWithinLookahead(
  beat: number,
  currentBeat: number,
  lookaheadBeats: number
): boolean {
  return beat >= currentBeat && beat < currentBeat + lookaheadBeats
}

/**
 * Get the effective start beat for cancellation, respecting the lookahead window.
 * 
 * @param requestedBeat - Beat at which user requested changes
 * @param currentBeat - Current playback beat
 * @param lookaheadBeats - Lookahead window in beats
 * @returns Effective beat from which to start cancellation
 */
export function getEffectiveCancelBeat(
  requestedBeat: number,
  currentBeat: number,
  lookaheadBeats: number
): number {
  // If requested beat is within lookahead, defer to end of lookahead window
  const lookaheadEnd = currentBeat + lookaheadBeats
  return Math.max(requestedBeat, lookaheadEnd)
}

// =============================================================================
// Beat Position from Audio Time
// =============================================================================

/**
 * Calculate the current beat position from audio context state.
 * 
 * @param audioTime - Current audio context time
 * @param playbackStartTime - Audio time when playback started
 * @param playbackStartBeat - Beat position when playback started
 * @param bpm - Current tempo
 * @returns Current beat position
 */
export function getCurrentBeatFromAudioTime(
  audioTime: number,
  playbackStartTime: number,
  playbackStartBeat: number,
  bpm: number
): number {
  const elapsedSeconds = audioTime - playbackStartTime
  const elapsedBeats = secondsToBeats(elapsedSeconds, bpm)
  return playbackStartBeat + elapsedBeats
}

/**
 * Calculate the audio time for a target beat.
 * 
 * @param targetBeat - Target beat position
 * @param playbackStartTime - Audio time when playback started
 * @param playbackStartBeat - Beat position when playback started
 * @param bpm - Current tempo
 * @returns Audio time at target beat
 */
export function getAudioTimeForBeat(
  targetBeat: number,
  playbackStartTime: number,
  playbackStartBeat: number,
  bpm: number
): number {
  const beatDelta = targetBeat - playbackStartBeat
  const secondsDelta = beatsToSeconds(beatDelta, bpm)
  return playbackStartTime + secondsDelta
}

// =============================================================================
// Phase 5: Beat-Grid Synchronization Utilities
// =============================================================================

/**
 * Check if a beat position is exactly on a quantize boundary.
 * 
 * @param beat - Beat position to check
 * @param mode - Quantize mode ('bar', 'beat', or 'off')
 * @param beatsPerMeasure - Number of beats per measure
 * @param tolerance - Tolerance for floating point comparison (default 0.001)
 * @returns True if on a quantize boundary
 */
export function isAtQuantizeBoundary(
  beat: number,
  mode: QuantizeMode,
  beatsPerMeasure: number,
  tolerance: number = 0.001
): boolean {
  switch (mode) {
    case 'bar':
      // Check if we're at a bar boundary
      return Math.abs(beat % beatsPerMeasure) < tolerance ||
             Math.abs(beat % beatsPerMeasure - beatsPerMeasure) < tolerance
    case 'beat':
      // Check if we're at a beat boundary
      return Math.abs(beat - Math.round(beat)) < tolerance
    case 'off':
      // Always at boundary when quantize is off
      return true
  }
}

/**
 * Get the time (in seconds) until the next quantize boundary.
 * 
 * @param currentBeat - Current beat position
 * @param mode - Quantize mode
 * @param beatsPerMeasure - Number of beats per measure
 * @param bpm - Tempo in beats per minute
 * @returns Time in seconds until next boundary (0 if mode is 'off')
 */
export function getTimeUntilNextQuantize(
  currentBeat: number,
  mode: QuantizeMode,
  beatsPerMeasure: number,
  bpm: number
): number {
  if (mode === 'off') return 0
  
  const targetBeat = getQuantizeTargetBeat(currentBeat, mode, beatsPerMeasure)
  const beatsUntil = targetBeat - currentBeat
  return beatsToSeconds(beatsUntil, bpm)
}

/**
 * Calculate the effective quantize boundary considering lookahead.
 * If the next quantize point is within the lookahead window,
 * skip to the following boundary.
 * 
 * @param currentBeat - Current beat position
 * @param mode - Quantize mode
 * @param beatsPerMeasure - Number of beats per measure
 * @param lookaheadBeats - Lookahead window in beats
 * @returns Target beat for quantized update (after lookahead)
 */
export function getQuantizeTargetWithLookahead(
  currentBeat: number,
  mode: QuantizeMode,
  beatsPerMeasure: number,
  lookaheadBeats: number
): number {
  if (mode === 'off') {
    // Even with 'off' mode, respect lookahead
    return currentBeat + lookaheadBeats
  }
  
  let targetBeat = getQuantizeTargetBeat(currentBeat, mode, beatsPerMeasure)
  
  // If target is within lookahead, skip to next boundary
  while (targetBeat < currentBeat + lookaheadBeats) {
    if (mode === 'bar') {
      targetBeat += beatsPerMeasure
    } else {
      targetBeat += 1
    }
  }
  
  return targetBeat
}

/**
 * Get information about the current position in the beat grid.
 * 
 * @param currentBeat - Current beat position
 * @param beatsPerMeasure - Number of beats per measure
 * @returns Object with beat grid information
 */
export function getBeatGridInfo(
  currentBeat: number,
  beatsPerMeasure: number
): {
  bar: number
  beatInBar: number
  fractionalBeat: number
  isOnBeat: boolean
  isOnBar: boolean
  beatsUntilNextBar: number
} {
  const bar = getCurrentBar(currentBeat, beatsPerMeasure)
  const beatInBar = getBeatInBar(currentBeat, beatsPerMeasure)
  const wholeBeat = Math.floor(currentBeat)
  const fractionalBeat = currentBeat - wholeBeat
  
  const tolerance = 0.001
  const isOnBeat = Math.abs(fractionalBeat) < tolerance
  const isOnBar = Math.abs(beatInBar) < tolerance || 
                  Math.abs(beatInBar - beatsPerMeasure) < tolerance
  
  const nextBarBeat = getNextBarBeat(currentBeat, beatsPerMeasure)
  const beatsUntilNextBar = nextBarBeat - currentBeat
  
  return {
    bar,
    beatInBar: Math.floor(beatInBar),
    fractionalBeat,
    isOnBeat,
    isOnBar,
    beatsUntilNextBar
  }
}
