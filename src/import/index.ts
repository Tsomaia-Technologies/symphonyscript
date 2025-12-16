// =============================================================================
// SymphonyScript - Import Module
// Import MIDI and MusicXML files as ClipNode (sheet music)
// =============================================================================

// MIDI Import
export {
  importMidi,
  importMidiAsClip,
  importMidiFile,
  importMidiFileAsClip
} from './midi'

// MusicXML Import
export {
  importMusicXML,
  importMusicXMLAsClip,
  importMusicXMLFile,
  importMusicXMLFileAsClip
} from './musicxml'

// Types
export type {
  MidiImportOptions,
  MusicXMLImportOptions,
  ClipImportResult,
  MultiClipImportResult
} from './types'

// Low-level parsers (for advanced use)
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
