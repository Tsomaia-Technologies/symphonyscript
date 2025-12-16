// =============================================================================
// SymphonyScript - Music Theory Types
// =============================================================================

import type { ChordRoot } from '../chords/types'

/**
 * Key signature context for automatic accidental application.
 * 
 * Unlike ScaleContext (used for degree-based notation), KeyContext
 * modifies literal note names: note('F4') becomes F#4 in G major.
 */
export interface KeyContext {
  /** Key root (e.g., 'G', 'Bb') */
  root: ChordRoot
  /** Key mode (major or minor) */
  mode: 'major' | 'minor'
}

/**
 * Accidental override for the next note.
 * - 'sharp': Raise by semitone
 * - 'flat': Lower by semitone
 * - 'natural': Use natural (override key signature)
 */
export type Accidental = 'sharp' | 'flat' | 'natural'

/**
 * Voice leading style options.
 */
export type VoiceLeadingStyle = 'close' | 'open' | 'drop2'

/**
 * Options for voice leading.
 */
export interface VoiceLeadOptions {
  /** Number of voices (default: 4) */
  voices?: number
  /** Voicing style (default: 'close') */
  style?: VoiceLeadingStyle
}

/**
 * Options for chord progressions.
 */
export interface ProgressionOptions {
  /** Duration per chord (default: '1n') */
  duration?: import('../types/primitives').NoteDuration
  /** Base octave (default: 4) */
  octave?: number
}
