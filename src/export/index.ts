// =============================================================================
// SymphonyScript - Export Module Public API
// =============================================================================

// --- MIDI Export ---
export { exportMidi } from './midi'

// --- MusicXML Export ---
export { exportMusicXML } from './musicxml'

// --- Types ---
export type {
  // MIDI types
  MidiExportOptions,
  MidiExportResult,
  MidiExportInput,
  
  // MusicXML types
  MusicXMLExportOptions,
  MusicXMLExportResult,
  MusicXMLExportInput
} from './types'

// --- Type Guards ---
export {
  isCompiledClip,
  isCompiledOutput,
  isClipNode,
  isSessionNode
} from './types'

// --- Utilities (for advanced use) ---
export {
  // VLQ encoding
  writeVLQ,
  vlqLength,
  
  // Time conversion
  secondsToTicks,
  secondsToBeats,
  beatsToTicks,
  bpmToMicrosPerBeat,
  microsPerBeatToBpm,
  
  // Note conversion
  noteNameToMidi,
  
  // Pitch bend conversion
  normalizedPitchBendToMidi,
  midiPitchBendToNormalized
} from './midi-utils'
