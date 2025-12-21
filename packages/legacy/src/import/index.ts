// =============================================================================
// SymphonyScript - Import Module (Core - Buffer Only)
// File-based imports are in @symphonyscript/node
// =============================================================================

// MIDI Import (buffer-based only)
export {
  importMidi,
  importMidiAsClip
} from './midi'

// MusicXML Import (string-based only)
export {
  importMusicXML,
  importMusicXMLAsClip
} from './musicxml'

// Types
export type {
  MidiImportOptions,
  MusicXMLImportOptions,
  ClipImportResult,
  MultiClipImportResult
} from './types'

// Low-level parsers
export { parseMidiBuffer } from './midi-parser'
export type {
  MidiFile,
  MidiTrack,
  MidiEvent,
  MidiNoteOnEvent,
  MidiNoteOffEvent,
  MidiControlChangeEvent,
  MidiProgramChangeEvent,
  MidiPitchBendEvent,
  MidiChannelPressureEvent,
  MidiMetaEvent
} from './midi-parser'
