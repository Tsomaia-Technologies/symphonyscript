// =============================================================================
// SymphonyScript - Clip Types (AST Operations & Nodes)
// =============================================================================

import type {
  Articulation,
  EasingCurve,
  NoteDuration,
  NoteName,
  TempoCurve,
  TempoEnvelope,
  TimeSignatureString
} from '../types/primitives'
import type { GrooveTemplate } from '../groove/types'
import type { AutomationOp } from '../automation/types'
import type { ScaleContext } from '../scales/types'
import type { CompiledBlock } from '../compiler/block/types'
import type { OpChain } from './OpChain'

// --- Operations Source Interface ---

/**
 * Interface for types that can provide clip operations.
 * Used by loop(), play(), and other methods that accept external content.
 * 
 * The generic parameter B tracks the builder type for compatibility checking:
 * - MelodyBuilder implements OperationsSource<MelodyBuilder>
 * - MelodyNoteCursor implements OperationsSource<MelodyBuilder>
 * 
 * This allows loop() to enforce that only compatible sources are accepted.
 * 
 * @template B - The builder type this source is compatible with
 */
export interface OperationsSource<B = unknown> {
  /**
   * Returns the operations as an array.
   * - ClipBuilder: extracts from _params.chain
   * - NoteCursor: commits pending op, then extracts from builder
   */
  toOperations(): ClipOperation[]
}

// --- Source Location ---

export interface SourceLocation {
  method: string
}

// --- Humanization & Expression ---

/** Humanization settings for natural feel */
export interface HumanizeSettings {
  timing?: number   // Max timing variance in ms (±)
  velocity?: number // Max velocity variance (±0.0-1.0)
  seed?: number     // Random seed for deterministic output
}

/**
 * Quantization settings for snap-to-grid timing correction.
 * 
 * Pipeline order: Quantize → Groove → Humanize
 * - Quantize = Correction ("Fix my bad timing")
 * - Groove = Style ("Make it swing")
 * - Humanize = Randomization ("Make it feel real")
 */
export interface QuantizeSettings {
  /** Grid division to quantize to ('4n', '8n', '16n', etc.) */
  grid: NoteDuration
  /** Quantization strength (0-1, default 1.0 = full snap) */
  strength?: number
  /** Whether to also quantize note durations (default: false) */
  duration?: boolean
}

/** Note tie type for sustaining across operations */
export type TieType = 'start' | 'continue' | 'end'

/** Glide/portamento settings */
export interface GlideSettings {
  time: NoteDuration  // Duration of the glide
}

/** Velocity point for multi-point curves */
export interface VelocityPoint {
  time: NoteDuration // Relative to start of curve
  value: number     // 0-1
  curve?: EasingCurve
}

// --- AST Operations (The "Code") ---

export type ClipOperation =
  | NoteOp
  | RestOp
  | StackOp
  | ClipOp
  | TransposeOp
  | LoopOp
  | ControlOp
  | TempoOp
  | TimeSignatureOp
  | DynamicsOp
  | AftertouchOp
  | VibratoOp
  | AutomationOp
  | BlockOp
  | PitchBendOp
  | ScopeOp

/** Play a note */
export interface NoteOp {
  kind: 'note'
  note: NoteName
  duration: NoteDuration
  velocity: number
  articulation?: Articulation
  humanize?: HumanizeSettings | null
  quantize?: QuantizeSettings | null
  tie?: TieType
  glide?: GlideSettings

  // NEW: Note Expression (MPE-compatible)
  /**
   * Microtonal pitch adjustment in cents.
   * Range: -1200 to +1200 (±1 octave)
   * Example: 50 = quarter-tone sharp
   */
  detune?: number

  /**
   * Initial timbre/brightness (0-1).
   * Maps to: MPE Y-axis, CC74 (Brightness), or synth filter.
   */
  timbre?: number

  /**
   * Initial pressure/aftertouch (0-1).
   * Applied at note onset for expressive attacks.
   */
  pressure?: number

  /**
   * Voice identifier for tie disambiguation.
   * Notes with different expressionIds maintain independent tie chains.
   */
  expressionId?: number

  _source?: SourceLocation
}

/** Rest (silence) for a duration - advances time without sound */
export interface RestOp {
  kind: 'rest'
  duration: NoteDuration
  _source?: SourceLocation
}

/** Parallel execution - all operations start at the same time */
export interface StackOp {
  kind: 'stack'
  operations: ClipOperation[]
  _source?: SourceLocation
}

/** Nested clip reference */
export interface ClipOp {
  kind: 'clip'
  clip: ClipNode
  /**
   * If true, tempo changes inside this clip will affect the parent scope.
   * Default: false (tempo is isolated)
   */
  inheritTempo?: boolean
  _source?: SourceLocation
}

/** Pitch transposition wrapper */
export interface TransposeOp {
  kind: 'transpose'
  semitones: number
  operation: ClipOperation
  _source?: SourceLocation
}

/** Loop repetition */
export interface LoopOp {
  kind: 'loop'
  count: number
  operations: ClipOperation[]
  _source?: SourceLocation
}

/** MIDI Control Change (CC) */
export interface ControlOp {
  kind: 'control'
  controller: number  // MIDI CC number (e.g., 64 for Sustain)
  value: number       // 0-127
  _source?: SourceLocation
}

/** Tempo transition options */
export interface TempoTransition {
  duration: NoteDuration
  curve?: TempoCurve                  // Simple: 'linear' | 'ease-in' | etc.
  envelope?: TempoEnvelope            // Complex multi-keyframe envelope
  precise?: boolean   // If true, use integral calculation for accurate ramping
}

/** Tempo change */
export interface TempoOp {
  kind: 'tempo'
  bpm: number
  transition?: NoteDuration | TempoTransition  // Simple duration or full options
  _source?: SourceLocation
}

/** Time signature change */
export interface TimeSignatureOp {
  kind: 'time_signature'
  signature: TimeSignatureString
  _source?: SourceLocation
}

/** Dynamics (crescendo, decrescendo, ramp, complex curve) */
export interface DynamicsOp {
  kind: 'dynamics'
  type: 'crescendo' | 'decrescendo' | 'ramp' | 'curve'
  from?: number      // Starting velocity (0-1)
  to?: number        // Ending velocity (0-1)
  duration: NoteDuration
  curve?: EasingCurve
  points?: VelocityPoint[]
  _source?: SourceLocation
}

// ... (existing content)

/** Aftertouch pressure (channel or polyphonic) */
export interface AftertouchOp {
  kind: 'aftertouch'
  type: 'channel' | 'poly'
  value: number     // 0-1 (normalized)
  note?: NoteName   // Only for polyphonic aftertouch
  _source?: SourceLocation
}

/** Vibrato (Modulation + Rate) */
export interface VibratoOp {
  kind: 'vibrato'
  depth?: number // 0-1
  rate?: number  // Hz
  _source?: SourceLocation
}

/** Pitch bend - semitones bend value */
export interface PitchBendOp {
  kind: 'pitch_bend'
  semitones: number  // Amount to bend (-12 to +12 typically)
  _source?: SourceLocation
}

/** Reference to a pre-compiled block */
export interface BlockOp {
  kind: 'block'
  block: CompiledBlock
  _source?: SourceLocation
}

/** Scope configuration for isolation */
export interface ScopeIsolation {
  tempo?: boolean
  dynamics?: boolean
  timeSignature?: boolean
}

/** Explicit scope isolation wrapper */
export interface ScopeOp {
  kind: 'scope'
  isolate: ScopeIsolation
  operation: ClipOperation
  _source?: SourceLocation
}

// --- Clip Node (Built output) ---

/** A clip is a reusable sequence of musical operations */
export interface ClipNode {
  readonly _version: import('../schema/version').SchemaVersion
  kind: 'clip'
  name: string
  operations: ClipOperation[]
  tempo?: number
  timeSignature?: TimeSignatureString
  /** Swing amount (0 = straight, 0.5 = triplet feel, 1 = full swing) */
  swing?: number
  /** Groove template for micro-timing */
  groove?: GrooveTemplate
}

// --- Clip Params (Builder state) ---

export interface ClipParams {
  name: string
  chain?: OpChain
  tempo?: number
  timeSignature?: TimeSignatureString
  swing?: number
  groove?: GrooveTemplate
  defaultDuration?: NoteDuration
  humanize?: HumanizeSettings
  quantize?: QuantizeSettings
}

export interface MelodyParams extends ClipParams {
  transposition?: number
  scaleContext?: ScaleContext
  /** Current voice scope (1-15 for MPE) */
  expressionId?: number
  /** Key signature context for automatic accidentals */
  keyContext?: import('../theory/types').KeyContext
  /** 
   * Accidental override for the next note only.
   * Auto-clears after note() is called.
   */
  nextAccidental?: import('../theory/types').Accidental
}

export interface DrumParams extends ClipParams {
  drumMap?: Record<string, NoteName>
}
