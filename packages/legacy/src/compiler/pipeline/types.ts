import type { ClipOperation } from '../../clip/types'
import type { Articulation, EasingCurve, InstrumentId, NoteName, TempoCurve } from '@symphonyscript/core/types/primitives'
import type { GrooveTemplate } from '@symphonyscript/core/groove/types'
import type { MidiChannel, MidiControlID, MidiValue } from '@symphonyscript/core/types/midi'
import type { AutomationTarget } from '../../automation/types'
import type { CompiledBlock } from '../block/types'

// NEW: Phase 1 Manifest
export interface InstrumentRequirement {
  id: InstrumentId
  polyphony: number      // Max simultaneous notes detected
  features: ('sustain' | 'aftertouch' | 'mpe' | 'pitch_bend')[]
}

export interface PlaybackManifest {
  /** Required Pitch Bend Range in semitones (default: 2) */
  pitchBendRange: number
  /** Map of standard MIDI CCs used in this clip */
  controllersUsed: MidiControlID[]
  /** Strict instrument requirements */
  instruments: Record<InstrumentId, InstrumentRequirement>
}

// --- Markers for Flattening ---

export interface StackStart {
  kind: 'stack_start';
  depth: number
}

export interface StackEnd {
  kind: 'stack_end';
  depth: number
}

export interface BranchStart {
  kind: 'branch_start';
  depth: number
}

export interface BranchEnd {
  kind: 'branch_end';
  depth: number
}

export interface ScopeStart {
  kind: 'scope_start';
  depth: number;
  delta: { transposition?: number }
  isolate?: import('../../clip/types').ScopeIsolation
}

export interface ScopeEnd {
  kind: 'scope_end';
  depth: number
  isolate?: import('../../clip/types').ScopeIsolation
}

export interface BlockMarker {
  kind: 'block_marker';
  block: CompiledBlock;
  depth: number
}

export type PipelineMarker = StackStart | StackEnd | BranchStart | BranchEnd | ScopeStart | ScopeEnd | BlockMarker

// --- Expanded Op ---

export interface ExpandedOpWrapper {
  kind: 'op'
  original: ClipOperation
  depth: number
  sourceClip: string
  loopIteration?: number
  sequenceId: number
  swing?: number
  groove?: GrooveTemplate
}

export type PipelineOp = ExpandedOpWrapper | PipelineMarker

export interface ExpandedSequence {
  operations: PipelineOp[]
  metadata: {
    totalLoopExpansions: number
    maxDepth: number
    clipCount: number
    operationCount: number
  }
}

// --- Timed Op ---

/**
 * Operation with beat position computed.
 * Markers also get time properties to maintain sequence order and state updates.
 */
export type TimedPipelineOp = PipelineOp & {
  beatStart: number
  beatDuration: number
  measure: number
  beatInMeasure: number
}

export interface TimedSequence {
  operations: TimedPipelineOp[]
  totalBeats: number
  measures: number
}

// --- Tempo Map ---

export interface TempoPoint {
  beatPosition: number
  bpm: number
  targetBpm?: number
  transitionBeats?: number
  curve?: TempoCurve
}

export interface TempoMap {
  points: TempoPoint[]

  getBpmAt(beat: number): number

  beatToSeconds(beat: number): number

  durationToSeconds(startBeat: number, beats: number): number
}

// --- Compiled Output ---

// --- Compiled Output ---

export interface NotePayload {
  pitch: NoteName
  velocity: MidiValue
  articulation?: Articulation
  detune?: number      // cents
  timbre?: MidiValue   // 0-127
  pressure?: MidiValue // 0-127
  tie?: import('../../clip/types').TieType
}

export interface ControlPayload {
  controller: MidiControlID
  value: MidiValue
}

export interface PitchBendPayload {
  value: MidiValue // 0-127, center 64
}

export interface AftertouchPayload {
  type: 'channel' | 'poly'
  value: MidiValue // 0-127
  note?: NoteName   // Only for poly aftertouch
}

export interface AutomationPayload {
  target: AutomationTarget
  value: number
  curve?: EasingCurve
  rampBeats?: number // Keep for now as emit passes it
  durationSeconds?: number
}

export interface TempoPayload {
  bpm: number
  transition?: any
}

export interface ArticulationPayload {
  articulation: Articulation
  value: number // 0-1
}

// Base event structure
interface BaseCompiledEvent {
  startSeconds: number
  channel?: MidiChannel  // Optional for global events (tempo, etc.)
  source?: ExpandedOpWrapper
}

export type CompiledEvent =
  | (BaseCompiledEvent & { kind: 'note'; durationSeconds: number; payload: NotePayload })
  | (BaseCompiledEvent & { kind: 'control'; payload: ControlPayload })
  | (BaseCompiledEvent & { kind: 'pitch_bend'; durationSeconds?: number; payload: PitchBendPayload })
  | (BaseCompiledEvent & { kind: 'aftertouch'; payload: AftertouchPayload })
  | (BaseCompiledEvent & { kind: 'automation'; payload: AutomationPayload })
  | (BaseCompiledEvent & { kind: 'tempo'; payload: TempoPayload })
  | (BaseCompiledEvent & { kind: 'articulation'; payload: ArticulationPayload })

// Type guards
export function isNoteEvent(e: CompiledEvent): e is CompiledEvent & { kind: 'note' } {
  return e.kind === 'note'
}

export function isControlEvent(e: CompiledEvent): e is CompiledEvent & { kind: 'control' } {
  return e.kind === 'control'
}

export function isAutomationEvent(e: CompiledEvent): e is CompiledEvent & { kind: 'automation' } {
  return e.kind === 'automation'
}

export function isTempoEvent(e: CompiledEvent): e is CompiledEvent & { kind: 'tempo' } {
  return e.kind === 'tempo'
}

export interface CompiledClip {
  events: CompiledEvent[]
  durationSeconds: number
  durationBeats: number
  tempoMap: TempoMap
  manifest?: PlaybackManifest  // NEW: Phase 1
  metadata: {
    expandedOpCount: number
    maxDepth: number
    warnings: string[]
  }
  // Debug methods
  print?: (options?: any) => void
  toAscii?: (options?: any) => string
}
