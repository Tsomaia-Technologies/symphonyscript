// =============================================================================
// SymphonyScript - Duration Utilities
// =============================================================================

import type {NoteDuration, TimeSignature, TimeSignatureString} from '../types/primitives'

/**
 * Convert beats to seconds at given BPM
 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * (60 / bpm)
}

/**
 * Parse time signature string to object
 */
export function parseTimeSignature(sig: TimeSignatureString): TimeSignature {
  const [num, denom] = sig.split('/').map(Number)
  return {numerator: num, denominator: denom}
}

/**
 * Parse duration notation to beats.
 * Supports: standard (4n), dotted (4n.), triplet (4t), numbers
 *
 * Note: In 4/4 time, one beat = quarter note
 * The duration values are based on standard 4/4 interpretation
 * Time signature affects how they're rendered, not parsed
 */
export function parseDuration(duration: NoteDuration): number {
  if (typeof duration === 'number') return duration

  // Base values (in beats, where 1 beat = quarter note in 4/4)
  const baseValues: Record<string, number> = {
    '1n': 4.0,    // Whole note = 4 beats
    '2n': 2.0,    // Half note = 2 beats
    '4n': 1.0,    // Quarter note = 1 beat
    '8n': 0.5,    // Eighth note = 0.5 beats
    '16n': 0.25,  // Sixteenth = 0.25 beats
    '32n': 0.125, // 32nd = 0.125 beats
  }

  // Check for dotted notation (1.5× duration)
  if (duration.endsWith('.')) {
    const base = duration.slice(0, -1) // Remove the dot
    const baseValue = baseValues[base]
    if (baseValue !== undefined) {
      return baseValue * 1.5
    }
  }

  // Check for triplet notation (⅔× duration)
  if (duration.endsWith('t')) {
    const base = duration.slice(0, -1) + 'n' // Convert 4t -> 4n
    const baseValue = baseValues[base]
    if (baseValue !== undefined) {
      return baseValue * (2 / 3)
    }
  }

  // Standard notation
  const baseValue = baseValues[duration]
  if (baseValue !== undefined) {
    return baseValue
  }

  // Error Handling with Context
  let hint = ''
  if (duration.endsWith('x')) {
    hint = ` Did you mean '${duration.slice(0, -1)}n'?`
  } else if (/^\d+$/.test(duration)) {
    hint = ` Did you mean '${duration}n'?`
  }

  throw new Error(`Invalid duration: '${duration}'.${hint} Supported formats: '4n' (quarter), '8t' (triplet), '4n.' (dotted), or number (beats).`)
}






