// =============================================================================
// SymphonyScript - Chord Progressions
// =============================================================================

import type { KeyContext, ProgressionOptions } from './types'
import type { ChordRoot, ChordQuality } from '../chords/types'

/**
 * Roman numeral quality patterns.
 * Uppercase = major, lowercase = minor
 * Suffixes: 7, dim, +, etc.
 */
interface ParsedRomanNumeral {
  degree: number      // 1-7
  quality: ChordQuality
  bass?: number       // For inversions like I/5 (bass degree)
  accidental?: 'b' | '#'  // For modal interchange (bVII, #IV)
  secondaryTarget?: number  // For secondary dominants (V/V = target 5)
}

/**
 * Note names in order of semitones from C.
 */
const SEMITONE_TO_NOTE: Record<number, string> = {
  0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F',
  6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B'
}

const SEMITONE_TO_NOTE_FLAT: Record<number, string> = {
  0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
  6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B'
}

/**
 * Root note to semitone offset from C.
 */
const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11
}

/**
 * Scale degree intervals for major scale (semitones from root).
 */
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11]

/**
 * Scale degree intervals for minor scale (natural minor).
 */
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

/**
 * Default chord qualities for each scale degree in major key.
 * I=maj, ii=m, iii=m, IV=maj, V=maj, vi=m, vii°=dim
 */
const MAJOR_DEGREE_QUALITIES: Record<number, ChordQuality> = {
  1: 'maj', 2: 'm', 3: 'm', 4: 'maj', 5: 'maj', 6: 'm', 7: 'dim'
}

/**
 * Default chord qualities for each scale degree in minor key.
 * i=m, ii°=dim, III=maj, iv=m, v=m (natural), VI=maj, VII=maj
 */
const MINOR_DEGREE_QUALITIES: Record<number, ChordQuality> = {
  1: 'm', 2: 'dim', 3: 'maj', 4: 'm', 5: 'm', 6: 'maj', 7: 'maj'
}

/**
 * Parse a roman numeral string into degree and quality.
 * 
 * Examples:
 * - 'I' → degree: 1, quality: 'maj'
 * - 'ii7' → degree: 2, quality: 'm7'
 * - 'V7' → degree: 5, quality: '7'
 * - 'viidim' or 'vii°' → degree: 7, quality: 'dim'
 */
export function parseRomanNumeral(numeral: string, mode: 'major' | 'minor'): ParsedRomanNumeral {
  // Handle slash notation (inversions or secondary dominants)
  let bass: number | undefined
  let secondaryTarget: number | undefined
  let baseNumeral = numeral
  const slashIdx = numeral.indexOf('/')
  if (slashIdx !== -1) {
    const slashPart = numeral.slice(slashIdx + 1)
    baseNumeral = numeral.slice(0, slashIdx)
    
    // Check if slash part is a number (inversion) or roman numeral (secondary)
    if (/^\d+$/.test(slashPart)) {
      // Inversion: I/3 → bass degree 3
      bass = parseInt(slashPart, 10)
    } else {
      // Secondary dominant: V/V → target is degree of V
      const targetParsed = parseRomanNumeral(slashPart, mode)
      secondaryTarget = targetParsed.degree
    }
  }

  // Match roman numeral with optional b/# prefix for modal interchange
  // ^(b|#)?([IViv]+)(.*)$
  const romanMatch = baseNumeral.match(/^(b|#)?([IViv]+)(.*)$/)
  if (!romanMatch) {
    throw new Error(`Invalid roman numeral: ${numeral}`)
  }

  const accidental = romanMatch[1] as 'b' | '#' | undefined
  const romanPart = romanMatch[2]
  const suffix = romanMatch[3].toLowerCase()

  // Convert roman to degree
  const romanMap: Record<string, number> = {
    'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7
  }
  const degree = romanMap[romanPart.toLowerCase()]
  if (!degree) {
    throw new Error(`Invalid roman numeral: ${numeral}`)
  }

  // Determine if uppercase (major) or lowercase (minor)
  const isUppercase = romanPart === romanPart.toUpperCase()
  
  // Start with default quality based on case
  // Uppercase = major, lowercase = minor (simple default)
  let quality: ChordQuality = isUppercase ? 'maj' : 'm'
  
  // Apply mode-based default (e.g., vii in major is dim by default)
  const defaultQualities = mode === 'major' ? MAJOR_DEGREE_QUALITIES : MINOR_DEGREE_QUALITIES
  const defaultQuality = defaultQualities[degree]
  
  // Use default if it matches the case expectation
  // (e.g., vii in major defaults to dim, not m)
  if (defaultQuality) {
    // For lowercase numerals, use the default if it's dim or m
    if (!isUppercase && (defaultQuality === 'dim' || defaultQuality === 'm')) {
      quality = defaultQuality
    }
    // For uppercase, use default if major
    if (isUppercase && defaultQuality === 'maj') {
      quality = defaultQuality
    }
  }

  // Explicit suffix ALWAYS overrides the case-based quality
  if (suffix) {
    if (suffix === '7') {
      // Major uppercase + 7 = dominant 7
      // Minor lowercase + 7 = minor 7
      quality = isUppercase ? '7' : 'm7'
    } else if (suffix === 'maj7' || suffix === 'δ' || suffix === 'δ7') {
      quality = 'maj7'
    } else if (suffix === 'dim' || suffix === '°') {
      quality = 'dim'
    } else if (suffix === 'dim7' || suffix === '°7') {
      quality = 'dim7'
    } else if (suffix === 'm7b5' || suffix === 'ø' || suffix === 'ø7') {
      quality = 'm7b5'
    } else if (suffix === 'aug' || suffix === '+') {
      quality = 'aug'
    } else if (suffix === 'sus4' || suffix === 'sus') {
      quality = 'sus4'
    } else if (suffix === 'sus2') {
      quality = 'sus2'
    } else if (suffix === 'm') {
      quality = 'm'
    }
  }

  return { degree, quality, bass, accidental, secondaryTarget }
}

/**
 * Get the root note for a scale degree in a given key.
 * 
 * @param degree - Scale degree (1-7)
 * @param keyContext - Key signature context
 * @param accidentalOffset - Semitone offset for modal interchange (b=-1, #=+1)
 * @returns Chord root note (e.g., 'G' for degree 5 in C major)
 */
export function degreeToRoot(
  degree: number,
  keyContext: KeyContext,
  accidentalOffset: number = 0
): ChordRoot {
  const intervals = keyContext.mode === 'major' ? MAJOR_SCALE_INTERVALS : MINOR_SCALE_INTERVALS
  const rootSemitone = NOTE_TO_SEMITONE[keyContext.root]
  
  if (rootSemitone === undefined) {
    throw new Error(`Invalid key root: ${keyContext.root}`)
  }

  // Get interval for this degree (0-indexed)
  const degreeIdx = ((degree - 1) % 7 + 7) % 7
  const interval = intervals[degreeIdx]
  
  // Calculate chord root semitone with accidental offset
  const chordSemitone = ((rootSemitone + interval + accidentalOffset) % 12 + 12) % 12
  
  // Determine if key uses flats (or if accidental is flat)
  const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'D', 'G', 'C']
  const useFlats = accidentalOffset < 0 || keyContext.root.includes('b') || 
    (keyContext.mode === 'minor' && flatKeys.includes(keyContext.root))
  
  return (useFlats ? SEMITONE_TO_NOTE_FLAT : SEMITONE_TO_NOTE)[chordSemitone] as ChordRoot
}

/**
 * Convert a roman numeral to a chord code in a given key.
 * 
 * Supports:
 * - Basic numerals: I, ii, V7, viidim
 * - Modal interchange: bVII, bIII (borrowed from parallel minor)
 * - Secondary dominants: V/V, V7/ii (dominant of target degree)
 * 
 * @param numeral - Roman numeral (e.g., 'V7', 'bVII', 'V/V')
 * @param keyContext - Key signature context
 * @returns Chord code (e.g., 'G7' for 'V7' in C major)
 */
export function romanToChord(numeral: string, keyContext: KeyContext): string {
  const parsed = parseRomanNumeral(numeral, keyContext.mode)
  
  // Handle secondary dominants (V/V, V7/ii, etc.)
  if (parsed.secondaryTarget !== undefined) {
    // Get the target chord's root (e.g., V/V in C → target is G)
    const targetRoot = degreeToRoot(parsed.secondaryTarget, keyContext)
    
    // Create a temporary key context for the target
    // Secondary dominants are always treated as major context
    const secondaryKey: KeyContext = { root: targetRoot, mode: 'major' }
    
    // Get the root of the secondary chord (e.g., V of G = D)
    const root = degreeToRoot(parsed.degree, secondaryKey)
    
    // Build chord code with original quality
    let chordCode: string = root
    if (parsed.quality !== 'maj') {
      chordCode += parsed.quality
    }
    
    return chordCode
  }
  
  // Handle modal interchange (bVII, bIII, #IV, etc.)
  const accidentalOffset = parsed.accidental === 'b' ? -1 : parsed.accidental === '#' ? 1 : 0
  const root = degreeToRoot(parsed.degree, keyContext, accidentalOffset)
  
  // Build chord code
  let chordCode: string = root
  
  // Add quality suffix (handle 'maj' special case - empty suffix for major triads)
  if (parsed.quality !== 'maj') {
    chordCode += parsed.quality
  }
  
  return chordCode
}

/**
 * Convert multiple roman numerals to chord codes.
 */
export function progressionToChords(
  numerals: string[],
  keyContext: KeyContext
): string[] {
  return numerals.map(num => romanToChord(num, keyContext))
}

/**
 * Common progression presets.
 */
export const PROGRESSION_PRESETS: Record<string, string[]> = {
  'pop': ['I', 'V', 'vi', 'IV'],
  'blues': ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'],
  'jazz-ii-V-I': ['ii7', 'V7', 'Imaj7'],
  'jazz-turnaround': ['Imaj7', 'vi7', 'ii7', 'V7'],
  'andalusian': ['i', 'VII', 'VI', 'V'],
  'fifties': ['I', 'vi', 'IV', 'V'],
  'pachelbel': ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V']
}
