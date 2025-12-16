// =============================================================================
// SymphonyScript - Public API
// =============================================================================

// --- Clip Domain ---
export {
  // Builders
  ClipBuilder,
  clip,              // Factory function
  MelodyBuilder,
  KeyboardBuilder,
  StringBuilder,
  WindBuilder,
  DrumBuilder,
  // Factory
  ClipFactory,
  // Core
  OpChain,
  // Actions namespace
  Actions
} from './clip/index'

// Backward compatibility: `Clip` is the factory (Clip.melody(), Clip.drums(), etc.)
export {ClipFactory as Clip} from './clip/index'

// --- Instrument Domain ---
export {
  Instrument,
  Synth,
  Sampler,
  synth,
  sampler,
  InstrumentFactory
} from './instrument/index'

// --- Session Domain ---
export {
  Session,
  session,
  Track
} from './session/index'

// --- Groove Domain ---
export {
  Grooves,
  createSwing
} from './groove/index'

// --- Compiler ---
export {
  compile,
  serializeTimeline
} from './compiler/index'
export type {CompileOptions, CompileResult} from './compiler/index'
export type {SerializeOptions} from './compiler/serialize'

// --- Serialization ---
export {
  serializeClip,
  deserializeClip,
  serializeSession
} from './session/serialize'
export { SCHEMA_VERSION } from './schema/version'
export { SchemaVersionError } from './schema/validate'

// --- Chord Domain ---
export {
  CHORD_DEFINITIONS,
  parseChordCode,
  chordToNotes
} from './chords/index'
export type {
  ChordQuality,
  ChordRoot,
  ChordCode,
  ChordDefinition,
  ChordOptions,
  ParsedChord
} from './chords/index'

// --- Types (commonly used) ---
export type {
  // Primitives
  NoteDuration,
  NoteName,
  TimeSignatureString,
  TimeSignature,
  Articulation,
  ArpPattern,
  TempoCurve,
  InstrumentId
} from './types/primitives'

// --- Type Safety Utilities (RFC-03) ---
export {
  instrumentId,
  midiVelocityToNormalized,
  normalizedToMidiVelocity
} from './types/primitives'

export {
  customTarget,
  isBuiltinTarget
} from './automation/types'
export type { AutomationTarget, BuiltinAutomationTarget, CustomAutomationTarget } from './automation/types'

export type {
  // Clip types
  ClipNode,
  ClipOperation,
  ClipParams,
  MelodyParams,
  DrumParams,
  NoteOp,
  RestOp,
  StackOp,
  LoopOp,
  ControlOp,
  TempoOp,
  DynamicsOp,
  VelocityPoint,
  TempoTransition
} from './clip/types'

export type {
  // Groove types
  GrooveTemplate,
  GrooveStep
} from './groove/types'

export type {
  // Session types
  SessionNode,
  TrackNode
} from './session/types'

// --- Effects Domain (RFC-018) ---
export type {
  EffectType,
  BaseEffectParams,
  DelayParams,
  ReverbParams,
  DistortionParams,
  FilterParams,
  CompressorParams,
  EqParams,
  ChorusParams,
  EffectParamsFor,
  InsertEffect,
  SendConfig,
  EffectBusConfig
} from './effects/types'

export type {
  // Instrument types
  InstrumentConfig,
  SynthConfig,
  SamplerConfig,
  AudioRouting,
  SidechainConfig
} from './instrument/Instrument'

// --- Compiler types (for advanced usage) ---
export type {
  CompiledOutput,
  AudioEvent,
  NoteOnEvent,
  ControlEvent,
  TempoEvent,
  TempoChange
} from './compiler/types'

// --- Pipeline Types (New Compiler) ---
export type {
  CompiledClip,
  CompiledEvent
} from './compiler/pipeline/types'

// --- Runtime (Web Audio) ---
export {createPlaybackEngine} from './runtime/engine'
export type {PlaybackEngine, TransportState} from './runtime/types'

// --- Import Module (RFC-029) ---
export {
  // MIDI Import
  importMidi,
  importMidiAsClip,
  importMidiFile,
  importMidiFileAsClip,
  // MusicXML Import
  importMusicXML,
  importMusicXMLAsClip,
  importMusicXMLFile,
  importMusicXMLFileAsClip,
  // Low-level parser
  parseMidiBuffer
} from './import/index'

export type {
  MidiImportOptions,
  MusicXMLImportOptions,
  ClipImportResult,
  MultiClipImportResult,
  MidiFile,
  MidiTrack,
  MidiEvent
} from './import/index'

// --- Code Generator (RFC-029) ---
export {
  clipToCode,
  clipsToCode
} from './codegen/index'

export type { CodeGenOptions } from './codegen/index'

// --- Export Module (RFC-030/031) ---
export {
  // MIDI Export
  exportMidi,
  // MusicXML Export
  exportMusicXML,
  // Utilities
  writeVLQ,
  secondsToTicks,
  bpmToMicrosPerBeat,
  noteNameToMidi
} from './export/index'

export type {
  MidiExportOptions,
  MidiExportResult,
  MusicXMLExportOptions,
  MusicXMLExportResult
} from './export/index'

// --- Live Coding Runtime (RFC-031) ---
export * from './live/index'
