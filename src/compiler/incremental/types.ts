/**
 * RFC-026.9: Incremental Compilation Types
 *
 * Defines types for section-based caching and incremental recompilation.
 */

import type { TimeSignatureString } from '../../types/primitives'
import type { ClipOperation, ClipNode } from '../../clip/types'
import type {
  TimedPipelineOp,
  TempoMap,
  CompiledClip,
  CompiledEvent
} from '../pipeline/types'

// =============================================================================
// Section Detection
// =============================================================================

/**
 * A section is a contiguous range of operations that can be cached together.
 * Sections are bounded by structural operations (tempo, time signature, etc.).
 */
export interface Section {
  /** Start index in ClipNode.operations[] (inclusive) */
  startIndex: number
  /** End index in ClipNode.operations[] (exclusive) */
  endIndex: number
  /** Content hash for change detection */
  hash: string
  /** Beat position at start of section (after timing phase) */
  startBeat: number
  /** Beat position at end of section (after timing phase) */
  endBeat: number
}

// =============================================================================
// State Snapshots
// =============================================================================

/**
 * Serialized state of an active tie chain.
 * Contains all data needed to reconstruct a NoteQueueItem when resuming.
 */
export interface SerializedTieState {
  /** Tie key: expressionId:pitch (for Map reconstruction) */
  key: string
  /** Beat when tie:start was encountered */
  startBeat: number
  /** Sum of durations accumulated so far */
  accumulatedDuration: number
  /**
   * Full operation needed to emit final note.
   * Contains original NoteOp with pitch, velocity, articulation, etc.
   */
  startOp: TimedPipelineOp
  /** Input order for stable sorting in heap */
  inputOrder: number
}

/**
 * Complete state snapshot at a section boundary.
 * Captures everything needed to resume compilation from this point.
 */
export interface ProjectionSnapshot {
  // --- Timing State ---
  /** Current beat position */
  beat: number
  /** Current measure number (1-based) */
  measure: number
  /** Beat position within current measure */
  beatInMeasure: number
  /** Beats per measure (derived from time signature) */
  beatsPerMeasure: number

  // --- Tempo/Signature State ---
  /** Current BPM */
  bpm: number
  /** Current time signature */
  timeSignature: TimeSignatureString

  // --- Transform State ---
  /** Accumulated transposition in semitones */
  transposition: number
  /** Accumulated velocity multiplier */
  velocityMultiplier: number

  // --- Coalesce State ---
  /** Active tie chains crossing this section boundary */
  activeTies: SerializedTieState[]
  /** Last input order counter value (for stable sorting when resuming) */
  lastInputOrder: number
}

// =============================================================================
// Compilation Cache
// =============================================================================

/**
 * Cached section with compiled events and boundary states.
 */
export interface CachedSection {
  /** Content hash for this section */
  hash: string
  /** Start index in ClipNode.operations[] (inclusive) */
  startIndex: number
  /** End index in ClipNode.operations[] (exclusive) */
  endIndex: number
  /** State at entry to this section */
  entryState: ProjectionSnapshot
  /** State at exit from this section */
  exitState: ProjectionSnapshot
  /** Compiled events for this section */
  events: CompiledEvent[]
}

/**
 * Full compilation cache for a clip.
 */
export interface CompilationCache {
  /** Identifier for the clip (for cache invalidation) */
  clipId: string
  /** Cached sections in order */
  sections: CachedSection[]
  /** Tempo map from full compile (reused since tempo changes cascade) */
  tempoMap: TempoMap
  /** Last full compilation result (for quick returns on no-change) */
  lastFullResult?: CompiledClip
  /** Reference to last compiled clip (for O(1) identity check) */
  lastClip?: ClipNode
  /** Operation count for quick structural check */
  operationCount: number
}

// =============================================================================
// Invalidation
// =============================================================================

/**
 * Result of comparing old and new section hashes.
 */
export interface InvalidationResult {
  /**
   * Index of first changed section (-1 if no changes).
   * All sections from this index onward need recompilation.
   */
  firstChanged: number
  /**
   * Whether all sections after firstChanged must be recompiled.
   * True for duration/tempo/timesig changes, false for pitch-only changes.
   */
  cascadeAll: boolean
  /**
   * Reason for invalidation (for debugging).
   */
  reason?: 'hash_mismatch' | 'section_count_changed' | 'boundary_changed' | 'no_cache'
}

// =============================================================================
// Incremental Compile Options
// =============================================================================

/**
 * Options for incremental compilation.
 */
export interface IncrementalCompileOptions {
  /** Generate a unique clip ID for caching */
  clipId?: string
  /** Initial BPM (default: 120) */
  bpm?: number
  /** Initial time signature (default: '4/4') */
  timeSignature?: TimeSignatureString
  /** Enable streaming coalesce (default: true for incremental) */
  streaming?: boolean
}

/**
 * Result of incremental compilation.
 */
export interface IncrementalCompileResult {
  /** The compiled clip */
  result: CompiledClip
  /** Updated cache for future compilations */
  cache: CompilationCache
  /** Statistics about what was recompiled */
  stats: {
    /** Whether this was a full compile (no usable cache) */
    fullCompile: boolean
    /** Number of sections reused from cache */
    sectionsReused: number
    /** Number of sections recompiled */
    sectionsRecompiled: number
    /** Total number of sections */
    totalSections: number
  }
}
