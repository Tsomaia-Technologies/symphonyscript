// =============================================================================
// SymphonyScript - Primitive Types (Shared across domains)
// =============================================================================

/**
 /**
 * Branded type for validated note names.
 * Use `noteName()` helper to create.
 */
declare const NoteNameBrand: unique symbol

export type Pitch =
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'A'
  | 'B'
  | 'C#'
  | 'D#'
  | 'F#'
  | 'G#'
  | 'A#'
  | 'Db'
  | 'Eb'
  | 'Gb'
  | 'Ab'
  | 'Bb'

export type BrandedNoteName = string & { readonly [NoteNameBrand]: never }

export type LiteralNoteName = `${Pitch}${number}`

export type NoteName = LiteralNoteName | BrandedNoteName

/**
 * Common note names as constants.
 */
export const Notes = {
  C: (octave: number) => `C${octave}` as NoteName,
  D: (octave: number) => `D${octave}` as NoteName,
  E: (octave: number) => `E${octave}` as NoteName,
  F: (octave: number) => `F${octave}` as NoteName,
  G: (octave: number) => `G${octave}` as NoteName,
  A: (octave: number) => `A${octave}` as NoteName,
  B: (octave: number) => `B${octave}` as NoteName,
  // Sharps
  Cs: (octave: number) => `C#${octave}` as NoteName,
  Ds: (octave: number) => `D#${octave}` as NoteName,
  Fs: (octave: number) => `F#${octave}` as NoteName,
  Gs: (octave: number) => `G#${octave}` as NoteName,
  As: (octave: number) => `A#${octave}` as NoteName,
  // Flats
  Db: (octave: number) => `Db${octave}` as NoteName,
  Eb: (octave: number) => `Eb${octave}` as NoteName,
  Gb: (octave: number) => `Gb${octave}` as NoteName,
  Ab: (octave: number) => `Ab${octave}` as NoteName,
  Bb: (octave: number) => `Bb${octave}` as NoteName,
} as const

/**
 * Type guard for valid note names.
 */
export function isNoteName(value: string): value is NoteName {
  return /^[A-G][#b]?[0-9]$/.test(value)
}

/**
 * Create a validated NoteName.
 * Throws if invalid.
 */
export function noteName(value: string): NoteName {
  if (!isNoteName(value)) {
    throw new Error(
      `Invalid note name: "${value}". ` +
      `Expected format: [A-G][#b]?[0-9] (e.g., "C4", "F#3", "Bb5")`
    )
  }
  return value
}

/**
 * Unsafe cast to NoteName (for internal use only).
 * Use when you've already validated the string.
 */
export function unsafeNoteName(value: string): NoteName {
  return value as NoteName
}

/**
 * Standard note duration strings.
 */
export type StandardDuration =
  | '1n' | '2n' | '4n' | '8n' | '16n' | '32n'

/**
 * Dotted duration strings.
 */
export type DottedDuration =
  | '1n.' | '2n.' | '4n.' | '8n.' | '16n.'

/**
 * Triplet duration strings.
 */
export type TripletDuration =
  | '2t' | '4t' | '8t' | '16t'

/**
 * Note duration using musical notation.
 */
export type NoteDuration =
  | StandardDuration
  | DottedDuration
  | TripletDuration
  | number  // Raw beats (escape hatch)

/**
 * Duration constants for autocomplete.
 */
export const Duration = {
  // Standard
  Whole: '1n' as const,
  Half: '2n' as const,
  Quarter: '4n' as const,
  Eighth: '8n' as const,
  Sixteenth: '16n' as const,
  ThirtySecond: '32n' as const,
  // Dotted
  DottedWhole: '1n.' as const,
  DottedHalf: '2n.' as const,
  DottedQuarter: '4n.' as const,
  DottedEighth: '8n.' as const,
  DottedSixteenth: '16n.' as const,
  // Triplet
  HalfTriplet: '2t' as const,
  QuarterTriplet: '4t' as const,
  EighthTriplet: '8t' as const,
  SixteenthTriplet: '16t' as const,
} as const

/**
 * Branded instrument identifier.
 * Use `instrumentId()` to create validated IDs.
 */
declare const InstrumentIdBrand: unique symbol
export type InstrumentId = string & { readonly [InstrumentIdBrand]: never }

const INSTRUMENT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/**
 * Create a validated InstrumentId.
 * Throws if invalid.
 */
export function instrumentId(id: string): InstrumentId {
  if (!INSTRUMENT_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid instrument ID: "${id}". ` +
      `Must start with letter, contain only alphanumeric/underscore/hyphen, max 64 chars.`
    )
  }
  return id as InstrumentId
}

/** Unsafe cast (internal use only) */
export function unsafeInstrumentId(id: string): InstrumentId {
  return id as InstrumentId
}

/** Type guard for instrument IDs */
export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === 'string' && INSTRUMENT_ID_PATTERN.test(value)
}

/**
 * Normalized velocity (0-1).
 * - 0 = silent (note off)
 * - 1 = maximum velocity (127 in MIDI)
 * - Values > 1 are clamped/rejected by validation
 */
export type Velocity = number

/**
 * Convert MIDI velocity (0-127) to normalized (0-1).
 */
export function midiVelocityToNormalized(midi: number): Velocity {
  return Math.max(0, Math.min(1, midi / 127))
}

/**
 * Convert normalized velocity (0-1) to MIDI (0-127).
 */
export function normalizedToMidiVelocity(normalized: Velocity): number {
  return Math.round(Math.max(0, Math.min(1, normalized)) * 127)
}

/** Time signature as string (e.g., "4/4", "3/4", "6/8") */
export type TimeSignatureString = `${number}/${number}`

/** Parsed time signature */
export interface TimeSignature {
  numerator: number
  denominator: number
}

/** Note articulation styles */
export type Articulation = 'staccato' | 'legato' | 'accent' | 'tenuto' | 'marcato'

/** Easing curve for dynamics and tempo transitions */
export type EasingCurve = 'linear' | 'exponential' | 'logarithmic' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'smooth'

/** Arpeggiator pattern types */
export type ArpPattern = 'up' | 'down' | 'upDown' | 'downUp' | 'random' | 'converge' | 'diverge'

/** Tempo transition curve type */
export type TempoCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

/**
 * Keyframe in multi-point tempo curve.
 */
export interface TempoKeyframe {
  beat: number    // offset from start
  bpm: number
  curve: TempoCurve
}

/**
 * Complex tempo envelope.
 */
export interface TempoEnvelope {
  keyframes: TempoKeyframe[]
}


