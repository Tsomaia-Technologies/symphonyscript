// =============================================================================
// SymphonyScript - Key Signatures
// =============================================================================

import type { KeyContext, Accidental } from './types'

/**
 * Natural note letters (no accidentals).
 */
const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
type NoteLetter = typeof NOTE_LETTERS[number]

/**
 * Key signature accidentals.
 * Maps 'root:mode' → { noteLetter: accidental }
 * 
 * Circle of fifths:
 * - Sharps: G, D, A, E, B, F#, C# (add F#, C#, G#, D#, A#, E#, B#)
 * - Flats: F, Bb, Eb, Ab, Db, Gb, Cb (add Bb, Eb, Ab, Db, Gb, Cb, Fb)
 */
const KEY_SIGNATURES: Record<string, Partial<Record<NoteLetter, 'sharp' | 'flat'>>> = {
  // Major keys - sharps
  'C:major': {},
  'G:major': { F: 'sharp' },
  'D:major': { F: 'sharp', C: 'sharp' },
  'A:major': { F: 'sharp', C: 'sharp', G: 'sharp' },
  'E:major': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp' },
  'B:major': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp' },
  'F#:major': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp', E: 'sharp' },
  'C#:major': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp', E: 'sharp', B: 'sharp' },
  
  // Major keys - flats
  'F:major': { B: 'flat' },
  'Bb:major': { B: 'flat', E: 'flat' },
  'Eb:major': { B: 'flat', E: 'flat', A: 'flat' },
  'Ab:major': { B: 'flat', E: 'flat', A: 'flat', D: 'flat' },
  'Db:major': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat' },
  'Gb:major': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat', C: 'flat' },
  'Cb:major': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat', C: 'flat', F: 'flat' },
  
  // Minor keys - sharps (relative to major: A=C, E=G, B=D, etc.)
  'A:minor': {},
  'E:minor': { F: 'sharp' },
  'B:minor': { F: 'sharp', C: 'sharp' },
  'F#:minor': { F: 'sharp', C: 'sharp', G: 'sharp' },
  'C#:minor': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp' },
  'G#:minor': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp' },
  'D#:minor': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp', E: 'sharp' },
  'A#:minor': { F: 'sharp', C: 'sharp', G: 'sharp', D: 'sharp', A: 'sharp', E: 'sharp', B: 'sharp' },
  
  // Minor keys - flats
  'D:minor': { B: 'flat' },
  'G:minor': { B: 'flat', E: 'flat' },
  'C:minor': { B: 'flat', E: 'flat', A: 'flat' },
  'F:minor': { B: 'flat', E: 'flat', A: 'flat', D: 'flat' },
  'Bb:minor': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat' },
  'Eb:minor': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat', C: 'flat' },
  'Ab:minor': { B: 'flat', E: 'flat', A: 'flat', D: 'flat', G: 'flat', C: 'flat', F: 'flat' },
}

/**
 * Parse a note name into letter, accidental, and octave.
 * @example parseNoteName('F#4') → { letter: 'F', accidental: '#', octave: '4' }
 */
function parseNoteName(note: string): { letter: NoteLetter; accidental: string; octave: string } | null {
  const match = note.match(/^([A-Ga-g])([#b]?)(\d+)$/)
  if (!match) return null
  
  return {
    letter: match[1].toUpperCase() as NoteLetter,
    accidental: match[2],
    octave: match[3]
  }
}

/**
 * Apply key signature to a note name.
 * 
 * @param noteName - Original note (e.g., 'F4')
 * @param keyContext - Key signature context
 * @param overrideAccidental - Explicit accidental override
 * @returns Modified note name (e.g., 'F#4' in G major)
 */
export function applyKeySignature(
  noteName: string,
  keyContext: KeyContext | undefined,
  overrideAccidental?: Accidental
): string {
  // If override is 'natural', return as-is (strip any existing accidental)
  if (overrideAccidental === 'natural') {
    const parsed = parseNoteName(noteName)
    if (parsed) {
      return `${parsed.letter}${parsed.octave}`
    }
    return noteName
  }
  
  // If override is 'sharp' or 'flat', apply it directly
  if (overrideAccidental === 'sharp') {
    const parsed = parseNoteName(noteName)
    if (parsed) {
      return `${parsed.letter}#${parsed.octave}`
    }
    return noteName
  }
  
  if (overrideAccidental === 'flat') {
    const parsed = parseNoteName(noteName)
    if (parsed) {
      return `${parsed.letter}b${parsed.octave}`
    }
    return noteName
  }
  
  // No key context → return as-is
  if (!keyContext) {
    return noteName
  }
  
  const parsed = parseNoteName(noteName)
  if (!parsed) {
    return noteName
  }
  
  // If note already has an accidental, respect it (don't override)
  if (parsed.accidental) {
    return noteName
  }
  
  // Look up key signature accidentals
  const keyStr = `${keyContext.root}:${keyContext.mode}`
  const keyAccidentals = KEY_SIGNATURES[keyStr]
  
  if (!keyAccidentals) {
    // Unknown key, return as-is
    return noteName
  }
  
  // Check if this note letter has an accidental in the key
  const keyAccidental = keyAccidentals[parsed.letter]
  if (keyAccidental) {
    const accidentalSymbol = keyAccidental === 'sharp' ? '#' : 'b'
    return `${parsed.letter}${accidentalSymbol}${parsed.octave}`
  }
  
  return noteName
}

/**
 * Get the accidentals for a key.
 */
export function getKeyAccidentals(keyContext: KeyContext): Record<string, 'sharp' | 'flat'> {
  const keyStr = `${keyContext.root}:${keyContext.mode}`
  return KEY_SIGNATURES[keyStr] || {}
}

/**
 * Check if a key signature is valid.
 */
export function isValidKey(root: string, mode: string): boolean {
  return `${root}:${mode}` in KEY_SIGNATURES
}
