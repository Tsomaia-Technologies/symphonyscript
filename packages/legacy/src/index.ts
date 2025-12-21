// =============================================================================
// @symphonyscript/core - Public API
// Universal core: DSL, Types, Import/Export, RuntimeBackend interface
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
} from '../../../../symphonyscript-legacy/src/legacy/clip/index'

export { ClipFactory as Clip } from '../../../../symphonyscript-legacy/src/legacy/clip/index'

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
export { compile, serializeTimeline } from '../../../../symphonyscript-legacy/src/legacy/compiler/index'
export type { CompileOptions, CompileResult } from '../../../../symphonyscript-legacy/src/legacy/compiler/index'
export type { SerializeOptions } from '../../../../symphonyscript-legacy/src/legacy/compiler/serialize'

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

// --- MIDI Types ---
export type { MidiValue, MidiChannel, MidiControlID } from './types/midi'
export { midiValue, midiChannel, midiControl, CC } from './types/midi'

// --- Utilities ---
export { SeededRandom, createRandom, hashString } from './util/random'
export { customTarget, isBuiltinTarget } from '../../../../symphonyscript-legacy/src/legacy/automation/types'
export type { AutomationTarget, BuiltinAutomationTarget, CustomAutomationTarget } from '../../../../symphonyscript-legacy/src/legacy/automation/types'

export type { ClipNode, ClipOperation, ClipParams, MelodyParams, DrumParams, NoteOp, RestOp, StackOp, LoopOp, ControlOp, TempoOp, DynamicsOp, VelocityPoint, TempoTransition } from '../../../../symphonyscript-legacy/src/legacy/clip/types'
export type { GrooveTemplate, GrooveStep } from './groove/types'
export type { SessionNode, TrackNode } from './session/types'

// --- Effects Domain ---
export type { EffectType, BaseEffectParams, DelayParams, ReverbParams, DistortionParams, FilterParams, CompressorParams, EqParams, ChorusParams, EffectParamsFor, InsertEffect, SendConfig, EffectBusConfig } from './effects/types'
// Instrument types (InstrumentConfig, SynthConfig, SamplerConfig, AudioRouting, SidechainConfig) are already exported from './instrument/index' above

// --- Compiler types ---
export type { CompiledOutput, AudioEvent, NoteOnEvent, ControlEvent, TempoEvent, TempoChange } from '../../../../symphonyscript-legacy/src/legacy/compiler/types'
export type { CompiledClip, CompiledEvent, TempoMap } from '../../../../symphonyscript-legacy/src/legacy/compiler/pipeline/types'
export { compileClip, computeTiming, computeTimingFromState, type TimingInitialState } from '../../../../symphonyscript-legacy/src/legacy/compiler/pipeline/index'
export { expandClip } from '../../../../symphonyscript-legacy/src/legacy/compiler/pipeline/expand'
export { coalesceStream, createWarningCollector, streamingCoalesceWithWarnings, streamingCoalesceToResult } from '../../../../symphonyscript-legacy/src/legacy/compiler/pipeline/coalesce'
export { incrementalCompile } from '../../../../symphonyscript-legacy/src/legacy/compiler/incremental/compile'
export type { IncrementalCompileResult, CompilationCache } from '../../../../symphonyscript-legacy/src/legacy/compiler/incremental/types'

// --- RuntimeBackend Interface ---
export type { RuntimeBackend } from './runtime/types'

// --- Import Module (buffer-only) ---
export { importMidi, importMidiAsClip, importMusicXML, importMusicXMLAsClip, parseMidiBuffer } from '../../../../symphonyscript-legacy/src/legacy/import/index'
export type { MidiImportOptions, MusicXMLImportOptions, ClipImportResult, MultiClipImportResult, MidiFile, MidiTrack, MidiEvent } from '../../../../symphonyscript-legacy/src/legacy/import/index'

// --- Code Generator ---
export { clipToCode, clipsToCode } from '../../../../symphonyscript-legacy/src/legacy/codegen/index'
export type { CodeGenOptions } from '../../../../symphonyscript-legacy/src/legacy/codegen/index'

// --- Export Module ---
export { exportMidi, exportMusicXML, writeVLQ, secondsToTicks, bpmToMicrosPerBeat, noteNameToMidi } from '../../../../symphonyscript-legacy/src/legacy/export/index'
export type { MidiExportOptions, MidiExportResult, MusicXMLExportOptions, MusicXMLExportResult } from '../../../../symphonyscript-legacy/src/legacy/export/index'

// --- VM Module (RFC-038: Symphony Bytecode) ---
export { assembleToBytecode, BytecodeVM, SBCConsumer } from './vm/index'
export { SBC_MAGIC, SBC_VERSION, REG, REGION, OP, STATE, EVENT_TYPE, EVENT_SIZE, DEFAULT_PPQ, DEFAULT_BPM } from './vm/index'
export type { VMEvent, VMNoteEvent, VMControlEvent, VMBendEvent, AssemblerOptions } from './vm/index'
