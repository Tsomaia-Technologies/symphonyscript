import { parseChordCode } from './parser'
import { noteToMidi, midiToNote } from '../util/midi'
import type { NoteName } from '../types/primitives'
import type { ChordOptions } from './types'

/**
 * Resolve a chord code to specific notes.
 *
 * @param code - Chord code (e.g. 'Cmaj7')
 * @param octave - Base octave number
 * @param options - Options (inversions, etc.)
 * @returns Array of NoteNames
 */
export function chordToNotes(
  code: string,
  octave: number
): NoteName[] {
  // 1. Parse Code
  const { root, intervals } = parseChordCode(code)

  // 2. Get Root MIDI
  const rootNote = `${root}${octave}`
  const rootMidi = noteToMidi(rootNote)

  if (rootMidi === null) {
    // Should not happen if parser validated Root, but octave might be crazy?
    throw new Error(`Failed to resolve root note: ${rootNote}`)
  }

  // 3. Calculate Intervals
  const notesMidi = intervals.map(interval => rootMidi + interval)

  // 4. Convert back to Note Names
  return notesMidi.map(midi => midiToNote(midi) as NoteName)
}
