/**
 * RFC-026: Event Sourcing Compiler - Projection Types
 * 
 * Projections are pure functions that transform input operations
 * into output operations with associated state tracking.
 */

import type { ClipNode, ClipOperation } from '../../clip/types'
import type { TimeSignatureString } from '../../types/primitives'
import type { 
  ExpandedSequence, 
  PipelineOp, 
  TimedPipelineOp, 
  TimedSequence,
  CompiledClip,
  TempoMap
} from '../pipeline/types'

// =============================================================================
// Context Types
// =============================================================================

/**
 * Shared context passed through the projection pipeline.
 * Provides access to current state and configuration.
 */
export interface ProjectionContext<S> {
  /** Current projection state */
  state: S
  /** Current beat position */
  beat: number
  /** Current BPM (if known) */
  bpm?: number
  /** Current time signature */
  timeSignature?: TimeSignatureString
}

// =============================================================================
// Projection Interface
// =============================================================================

/**
 * A Projection transforms a stream of inputs into a stream of outputs.
 * Pure function semantics: no side effects, deterministic output.
 * 
 * @template S - State type maintained across inputs
 * @template I - Input type
 * @template O - Output type
 */
export interface Projection<S, I, O> {
  /** Unique name for debugging and tracing */
  readonly name: string
  
  /** Initial state when projection starts */
  readonly initialState: S

  /**
   * Process one input, produce zero or more outputs.
   * Must be a pure function with no side effects.
   * 
   * @param input - The input to process
   * @param ctx - Current context including state
   * @returns Outputs, new state, and beat advancement
   */
  project(
    input: I,
    ctx: ProjectionContext<S>
  ): {
    /** Zero or more outputs to emit */
    outputs: O[]
    /** Updated state for next iteration */
    nextState: S
    /** Beats to advance (usually from operation duration) */
    advanceBeats: number
  }

  /**
   * Optional finalization when input stream ends.
   * Used for flushing buffered outputs (e.g., orphaned ties).
   */
  finalize?(ctx: ProjectionContext<S>): O[]
}

// =============================================================================
// Wrapped Phase Types (Phase 2)
// =============================================================================

/**
 * Expand phase wrapper.
 * Transforms ClipNode into flat PipelineOp sequence.
 */
export interface ExpandProjection {
  name: 'expand'
  execute(clip: ClipNode, limits?: {
    maxDepth?: number
    maxLoopExpansions?: number
    maxOperations?: number
  }): ExpandedSequence
}

/**
 * Timing phase wrapper.
 * Adds beat position and measure tracking to operations.
 */
export interface TimeProjection {
  name: 'time'
  execute(
    sequence: ExpandedSequence,
    timeSignature?: TimeSignatureString
  ): TimedSequence
}

/**
 * Tie coalescing phase wrapper.
 * Merges tied notes into single extended notes.
 */
export interface TieProjection {
  name: 'tie'
  execute(sequence: TimedSequence): {
    sequence: TimedSequence
    warnings: Array<{ type: string; message: string }>
  }
}

/**
 * Emit phase wrapper.
 * Converts timed operations into compiled events.
 */
export interface EmitProjection {
  name: 'emit'
  execute(
    sequence: TimedSequence,
    tempoMap: TempoMap,
    options?: {
      defaultVelocity?: number
      channel?: number
      sampleRate?: number
      seed?: number
    }
  ): CompiledClip
}

// =============================================================================
// Pipeline Composition
// =============================================================================

/**
 * Pipeline configuration for compileClipV2.
 */
export interface PipelineConfig {
  bpm: number
  timeSignature?: TimeSignatureString
  maxDepth?: number
  maxLoopExpansions?: number
  maxOperations?: number
  defaultVelocity?: number
  channel?: number
  sampleRate?: number
  tempoPrecision?: 'standard' | 'high' | 'sample'
  preEstimate?: boolean
  seed?: number
}

/**
 * Composed pipeline that processes ClipNode to CompiledClip.
 */
export interface ComposedPipeline {
  compile(clip: ClipNode, config: PipelineConfig): CompiledClip
}
