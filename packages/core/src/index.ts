// =============================================================================
// @symphonyscript/core - Public API
// Universal core: DSL, Compiler, Types, Import/Export, RuntimeBackend interface
// =============================================================================

// --- Clip Domain ---
export {
  ClipBuilder,
  clip,
  MelodyBuilder,
  KeyboardBuilder,
  StringBuilder,
  WindBuilder,
  DrumBuilder,
  ClipFactory,
  OpChain,
  Actions
} from './clip/index'

export { ClipFactory as Clip } from './clip/index'

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
export { Session, session, Track } from './session/index'

// --- Groove Domain ---
export { Grooves, createSwing } from './groove/index'

// --- Compiler ---
export { compile, serializeTimeline } from './compiler/index'
export type { CompileOptions, CompileResult } from './compiler/index'
export type { SerializeOptions } from './compiler/serialize'

// --- Serialization ---
export { serializeClip, deserializeClip, serializeSession } from './session/serialize'
export { SCHEMA_VERSION } from './schema/version'
export { SchemaVersionError } from './schema/validate'

// --- Chord Domain ---
export { CHORD_DEFINITIONS, parseChordCode, chordToNotes } from './chords/index'
export type { ChordQuality, ChordRoot, ChordCode, ChordDefinition, ChordOptions, ParsedChord } from './chords/index'

// --- Types ---
export type { NoteDuration, NoteName, TimeSignatureString, TimeSignature, Articulation, ArpPattern, TempoCurve, InstrumentId } from './types/primitives'
export { instrumentId, midiVelocityToNormalized, normalizedToMidiVelocity } from './types/primitives'
export { customTarget, isBuiltinTarget } from './automation/types'
export type { AutomationTarget, BuiltinAutomationTarget, CustomAutomationTarget } from './automation/types'

export type { ClipNode, ClipOperation, ClipParams, MelodyParams, DrumParams, NoteOp, RestOp, StackOp, LoopOp, ControlOp, TempoOp, DynamicsOp, VelocityPoint, TempoTransition } from './clip/types'
export type { GrooveTemplate, GrooveStep } from './groove/types'
export type { SessionNode, TrackNode } from './session/types'

// --- Effects Domain ---
export type { EffectType, BaseEffectParams, DelayParams, ReverbParams, DistortionParams, FilterParams, CompressorParams, EqParams, ChorusParams, EffectParamsFor, InsertEffect, SendConfig, EffectBusConfig } from './effects/types'
export type { InstrumentConfig, SynthConfig, SamplerConfig, AudioRouting, SidechainConfig } from './instrument/Instrument'

// --- Compiler types ---
export type { CompiledOutput, AudioEvent, NoteOnEvent, ControlEvent, TempoEvent, TempoChange } from './compiler/types'
export type { CompiledClip, CompiledEvent, TempoMap } from './compiler/pipeline/types'
export { compileClip, computeTiming, computeTimingFromState, type TimingInitialState } from './compiler/pipeline/index'
export { expandClip } from './compiler/pipeline/expand'
export { coalesceStream, createWarningCollector, streamingCoalesceWithWarnings, streamingCoalesceToResult } from './compiler/pipeline/coalesce'
export { incrementalCompile } from './compiler/incremental/compile'
export type { IncrementalCompileResult, CompilationCache } from './compiler/incremental/types'

// --- RuntimeBackend Interface ---
export type { RuntimeBackend } from './runtime/types'

// --- Import Module (buffer-only) ---
export { importMidi, importMidiAsClip, importMusicXML, importMusicXMLAsClip, parseMidiBuffer } from './import/index'
export type { MidiImportOptions, MusicXMLImportOptions, ClipImportResult, MultiClipImportResult, MidiFile, MidiTrack, MidiEvent } from './import/index'

// --- Code Generator ---
export { clipToCode, clipsToCode } from './codegen/index'
export type { CodeGenOptions } from './codegen/index'

// --- Export Module ---
export { exportMidi, exportMusicXML, writeVLQ, secondsToTicks, bpmToMicrosPerBeat, noteNameToMidi } from './export/index'
export type { MidiExportOptions, MidiExportResult, MusicXMLExportOptions, MusicXMLExportResult } from './export/index'
