import type {ScaleContext, ScaleMode} from './types'

/**
 * Scale intervals (semitones from root).
 * Index 0 = degree 1 (root), Index 1 = degree 2, etc.
 */
export const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],  // W-W-H-W-W-W-H
  minor: [0, 2, 3, 5, 7, 8, 10],  // W-H-W-W-H-W-W
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],  // W-H-W-W-H-WH-H
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],  // W-H-W-W-W-W-H (ascending)
  dorian: [0, 2, 3, 5, 7, 9, 10],  // W-H-W-W-W-H-W
  phrygian: [0, 1, 3, 5, 7, 8, 10],  // H-W-W-W-H-W-W
  lydian: [0, 2, 4, 6, 7, 9, 11],  // W-W-W-H-W-W-H
  mixolydian: [0, 2, 4, 5, 7, 9, 10],  // W-W-H-W-W-H-W
  locrian: [0, 1, 3, 5, 6, 8, 10],  // H-W-W-H-W-W-W
  pentatonicMajor: [0, 2, 4, 7, 9],         // Major pentatonic
  pentatonicMinor: [0, 3, 5, 7, 10],        // Minor pentatonic
  blues: [0, 3, 5, 6, 7, 10],     // Blues scale
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
}

/**
 * Note names for conversion.
 */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/**
 * Parse root note to semitone offset (0-11).
 */
export function parseRoot(root: string): number {
  const match = root.match(/^([A-Ga-g])([#b]?)$/)
  if (!match) throw new Error(`Invalid root note: ${root}`)

  const letter = match[1].toUpperCase()
  const accidental = match[2]

  let semitone = NOTE_NAMES.indexOf(letter)
  if (semitone === -1) semitone = NOTE_NAMES_FLAT.indexOf(letter)

  if (accidental === '#') semitone++
  if (accidental === 'b') semitone--

  return ((semitone % 12) + 12) % 12
}

/**
 * Convert scale degree to concrete note.
 *
 * @param degree - Scale degree (1-indexed)
 * @param context - Scale context
 * @param alteration - Chromatic alteration in semitones
 * @param octaveOffset - Octave adjustment
 * @returns Note name with octave (e.g., 'E4')
 */
export function degreeToNote(
  degree: number,
  context: ScaleContext,
  alteration: number = 0,
  octaveOffset: number = 0
): string {
  const intervals = SCALE_INTERVALS[context.mode]
  if (!intervals) throw new Error(`Unknown scale mode: ${context.mode}`)

  // Convert 1-indexed degree to 0-indexed
  const idx = degree - 1

  // Handle octave wrapping for degrees outside base scale
  const scaleLen = intervals.length
  // Ensure positive modulo for negative degrees if they were allowed (though typings suggest positive)
  // idx can technically be negative if user passes 0 or negative degree (unlikely but safe logic)
  const baseIdx = ((idx % scaleLen) + scaleLen) % scaleLen

  const octaveFromDegree = Math.floor(idx / scaleLen)

  // Calculate semitone from root
  const rootSemitone = parseRoot(context.root)
  const intervalSemitone = intervals[baseIdx]
  const totalSemitone = rootSemitone + intervalSemitone + alteration

  // Calculate final octave and note
  // Note: Standard octave change is at C.
  // If root is C, semitone 0 is C. 12 is C(oct+1).
  // If root is F, semitone 5 is F.
  // If we have degree such that totalSemitone > 11, we add to octave.
  // Note that parseRoot returns 0-11 relative to C.

  const finalOctave = context.octave + octaveOffset + octaveFromDegree + Math.floor(totalSemitone / 12)
  const noteIdx = ((totalSemitone % 12) + 12) % 12

  // Use sharps or flats based on root
  // Heuristic: Flat keys use flats.
  // Determine accidentals based on root and mode
  // Heuristic: Use flats if the root itself is flat, OR if it's a known flat key (F, d, g, c, f, etc.)
  // Simplification: Check relative major key.
  const flatRoots = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
  // Additional flat keys for minor modes (relative majors are in the list)
  // C minor (Eb major), G minor (Bb major), D minor (F major), F minor (Ab major), Bb minor (Db major)
  const flatMinorRoots = ['D', 'G', 'C', 'F', 'Bb', 'Eb']

  let useFlats = false
  if (context.root.includes('b')) {
    useFlats = true
  } else if (context.mode === 'major' && flatRoots.includes(context.root)) {
    useFlats = true
  } else if ((context.mode === 'minor' || context.mode === 'dorian' || context.mode === 'phrygian') && flatMinorRoots.includes(context.root)) {
    useFlats = true
  }

  const noteName = useFlats ? NOTE_NAMES_FLAT[noteIdx] : NOTE_NAMES[noteIdx]

  return `${noteName}${finalOctave}`
}

/**
 * Get all notes in a scale for a given octave.
 */
export function getScaleNotes(context: ScaleContext): string[] {
  const intervals = SCALE_INTERVALS[context.mode]
  return intervals.map((_, i) => degreeToNote(i + 1, context))
}

export * from './types'
