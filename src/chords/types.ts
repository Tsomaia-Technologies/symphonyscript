// Basic Identifiers
export type ChordQuality =
  | 'maj' | 'maj7' | '6' | '6/9' | 'maj9' | 'maj11' | 'maj13' | 'add9'
  | 'm' | 'm7' | 'm6' | 'm9' | 'm11' | 'm13' | 'm(maj7)'
  | '7' | '9' | '11' | '13' | '7sus4' | '9sus4'
  | 'sus4' | 'sus2' | '5'
  | 'dim' | 'dim7' | 'm7b5'
  | 'aug' | 'aug7' | 'maj7#5'
  | '7b9' | '7#9' | '7b5' | '7alt'

export type ChordRoot =
  | 'C' | 'C#' | 'Db'
  | 'D' | 'D#' | 'Eb'
  | 'E'
  | 'F' | 'F#' | 'Gb'
  | 'G' | 'G#' | 'Ab'
  | 'A' | 'A#' | 'Bb'
  | 'B'

// Suffixes for ChordCode construction (Primary + Alt codes)
export type ChordSuffix =
  // Major
  | '' | 'maj' | 'M'
  | 'maj7' | 'M7' | 'Δ' | 'Δ7'
  | '6' | 'M6'
  | '6/9' | '69' | '6add9'
  | 'maj9' | 'M9' | 'Δ9'
  | 'maj11' | 'M11' | 'Δ11'
  | 'maj13' | 'M13' | 'Δ13'
  | 'add9' | 'add2'
  // Minor
  | 'm' | '-' | 'min'
  | 'm7' | '-7' | 'min7'
  | 'm6' | '-6' | 'min6'
  | 'm9' | '-9' | 'min9'
  | 'm11' | '-11' | 'min11'
  | 'm13' | '-13' | 'min13'
  | 'm(maj7)' | '-Δ7' | 'min(maj7)'
  // Dominant
  | '7' | 'dom7'
  | '9' | 'dom9'
  | '11' | 'dom11'
  | '13' | 'dom13'
  | '7sus4' | '7sus'
  | '9sus4' | '9sus'
  // Suspended
  | 'sus4' | 'sus'
  | 'sus2' | '2'
  // Power
  | '5' | '(no3)'
  // Diminished
  | 'dim' | '°'
  | 'dim7' | '°7'
  | 'm7b5' | 'ø' | 'ø7'
  // Augmented
  | 'aug' | '+'
  | 'aug7' | '+7' | '7#5'
  | 'maj7#5' | 'Δ+' | 'Δ#5'
  // Altered
  | '7b9' | '7-9'
  | '7#9' | '7+9'
  | '7b5' | '7-5'
  | '7alt'

// Strict type for validation
export type ChordCode = `${ChordRoot}${ChordSuffix}`

export interface ChordDefinition {
  quality: ChordQuality
  name: string
  primaryCode: string
  altCodes: string[]
  intervals: number[]
}

/**
 * Options for chord resolution.
 */
export interface ChordOptions {
  // Deprecated: Inversions now handled via Cursor
}
