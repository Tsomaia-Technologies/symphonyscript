// =============================================================================
// SymphonyScript v2.1 - Compiler Types
// =============================================================================

import type {Articulation, InstrumentId, NoteName, TempoCurve, TimeSignatureString} from '../types/primitives'
import type {ClipOperation} from '../clip/types'
import type {InstrumentConfig} from '../instrument/Instrument'
import type {AutomationTarget} from '../automation/types'
import type {AudioRoutingGraph} from './routing-resolver'

// --- Compiled Output ---

export interface CompiledOutput {
  meta: {
    bpm: number
    durationSeconds: number
    timeSignature: TimeSignatureString
    tempoChanges: TempoChange[]
  }
  manifest: Record<InstrumentId, InstrumentConfig>
  timeline: AudioEvent[]
  /** Effect routing graph for inserts and sends (RFC-018) */
  routing?: AudioRoutingGraph
}

export interface TempoChange {
  atSecond: number
  bpm: number
  transitionSeconds?: number
  curve?: TempoCurve  // Easing curve for the transition
}

// --- Audio Events ---

// ... (existing imports)

// --- Audio Events ---

export type AudioEvent =
  NoteOnEvent
  | NoteOffEvent
  | ControlEvent
  | TempoEvent
  | PitchBendEvent
  | AftertouchEvent
  | AutomationEvent

// ... (existing interfaces)

export interface AftertouchEvent {
  kind: 'aftertouch'
  time: number
  instrumentId: InstrumentId
  type: 'channel' | 'poly'
  value: number  // 0-127 for MIDI output
  note?: NoteName
}

export interface AutomationEvent {
  kind: 'automation'
  time: number
  instrumentId: InstrumentId
  target: AutomationTarget
  value: number
  rampSeconds?: number
  curve?: string
}

export interface NoteOnEvent {
  kind: 'note_on'
  time: number  // Absolute seconds
  instrumentId: InstrumentId
  note: NoteName
  velocity: number
  duration: number  // Seconds
  articulation?: Articulation
  tie?: 'start' | 'continue' | 'end'
}

export interface NoteOffEvent {
  kind: 'note_off'
  time: number
  instrumentId: InstrumentId
  note: NoteName
  velocity?: number  // Release velocity (0-1)
}

export interface ControlEvent {
  kind: 'control'
  time: number
  instrumentId: InstrumentId
  controller: number
  value: number
}

export interface TempoEvent {
  kind: 'tempo'
  time: number
  bpm: number
  transitionSeconds?: number
  curve?: TempoCurve  // Easing curve for the transition
}

export interface PitchBendEvent {
  kind: 'pitch_bend'
  time: number
  instrumentId: InstrumentId
  value: number  // -1 to 1 (normalized)
}

export interface AftertouchEvent {
  kind: 'aftertouch'
  time: number
  instrumentId: InstrumentId
  type: 'channel' | 'poly'
  value: number  // 0-127 for MIDI output
  note?: NoteName
}

// --- Compiler Context ---

export interface CompilerContext {
  elapsedSeconds: number     // Absolute seconds from track start
  transposition: number      // Semitones
  instrumentId: InstrumentId
  currentBpm: number
  timeSignature: TimeSignatureString
  // Recursion depth removed - using iterative stack
  lastNote?: NoteName        // Last played note (for glide)
  // Dynamics context
  dynamicsRegion?: {
    type: 'crescendo' | 'decrescendo' | 'ramp' | 'curve'
    startSeconds: number
    endSeconds: number
    fromVelocity?: number
    toVelocity?: number
    curve?: import('../types/primitives').EasingCurve
    points?: import('../clip/types').VelocityPoint[]
    resolvedPoints?: { normalizedTime: number; value: number; curve?: import('../types/primitives').EasingCurve }[]
  }
  // Swing context
  swing?: number             // 0 = straight, 0.5 = triplet feel, 1 = full swing
  groove?: import('../groove/types').GrooveTemplate
  beatPosition: number       // Current beat position within measure (0-based, in beats)

  // NEW: Phase 1 Context
  elapsedBeats: number       // Monotonically increasing beats from start
  measureNumber: number      // 1-indexed measure count
  // Note: timeSignature is already present above (line 93), but we ensure it's used correctly

  // Active Tempo Ramp
  activeTempoRamp?: {
    startBpm: number
    targetBpm: number
    startBeats: number     // Beat position where ramp starts
    endBeats: number       // Beat position where ramp ends
    durationBeats: number
    curve?: import('../types/primitives').TempoCurve
  }
}

// --- Iterative Compiler State ---

export interface CompileFrame {
  operations: ClipOperation[]
  pc: number                 // Program Counter (current operation index)
  ctx: CompilerContext       // Context for THIS frame

  // For loops:
  loopCount?: number         // Remaining iterations
  loopStartPc?: number       // Where to jump back to
  originalOps?: ClipOperation[] // For restoring loop body if needed

  startSeconds: number       // Time when this frame started (for relative duration calcs)
  maxDuration: number        // Accumulated duration of this frame

  // NEW: Parallel Processing (Phase 1)
  isParallelManager?: boolean
  parallelQueue?: Array<{
    operations: ClipOperation[]
    ctx: CompilerContext
  }>
  parallelResults?: AudioEvent[][]
}
