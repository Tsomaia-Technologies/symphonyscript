import type { ChordRoot } from '../chords/types'

/**
 * Common scale modes.
 */
export type ScaleMode =
  | 'major'
  | 'minor'           // Natural minor
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'blues'
  | 'chromatic'

/**
 * Scale context for degree-based notation.
 */
export interface ScaleContext {
  /** Root note (e.g., 'C', 'F#') */
  root: ChordRoot
  /** Scale mode */
  mode: ScaleMode
  /** Default octave for degree 1 */
  octave: number
}

/**
 * Scale degree with optional modifiers.
 */
export interface ScaleDegree {
  /** Scale degree (1-7 for diatonic, can exceed for extended) */
  degree: number
  /** Chromatic alteration in semitones (e.g., -1 for flat, +1 for sharp) */
  alteration?: number
  /** Octave offset from default */
  octaveOffset?: number
}
