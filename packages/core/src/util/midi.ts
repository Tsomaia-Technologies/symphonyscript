// =============================================================================
// SymphonyScript - MIDI Utilities
// =============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_TO_SHARP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B'
}

/**
 * Parse a note name into its components
 */
function parseNote(note: string): { name: string; octave: number } | null {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/)
  if (!match) return null

  let name = match[1].toUpperCase()
  const octave = parseInt(match[2], 10)

  // Convert flats to sharps for consistency
  if (FLAT_TO_SHARP[name]) {
    name = FLAT_TO_SHARP[name]
  }

  return {name, octave}
}

/**
 * Convert a note name to MIDI number (C4 = 60)
 */
export function noteToMidi(note: string): number | null {
  const parsed = parseNote(note)
  if (!parsed) return null

  const noteIndex = NOTE_NAMES.indexOf(parsed.name)
  if (noteIndex === -1) return null

  // MIDI: C4 = 60, C0 = 12
  return (parsed.octave + 1) * 12 + noteIndex
}

/**
 * Convert a MIDI number to note name
 */
export function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  const noteIndex = midi % 12
  return `${NOTE_NAMES[noteIndex]}${octave}`
}

/**
 * Apply transposition to a note name.
 * Properly converts C4 + 12 = C5, C4 + 2 = D4, etc.
 */
export function transposeNote(note: string, semitones: number): string {
  if (semitones === 0) return note

  const midi = noteToMidi(note)
  if (midi === null) {
    // If we can't parse it, return original with annotation
    console.warn(`Could not parse note: ${note}`)
    return note
  }

  const transposedMidi = midi + semitones

  // Clamp to valid MIDI range (0-127)
  if (transposedMidi < 0 || transposedMidi > 127) {
    console.warn(`Transposed note out of MIDI range: ${note} + ${semitones}`)
    return midiToNote(Math.max(0, Math.min(127, transposedMidi)))
  }

  return midiToNote(transposedMidi)
}






