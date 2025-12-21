/**
 * RFC-026.9: State Snapshots
 *
 * Captures and restores projection state at section boundaries.
 * Enables resuming compilation from a specific point.
 */

import type { TimeSignatureString } from '../../../../../symphonyscript/packages/core/src/types/primitives'
import type { TimedPipelineOp, ExpandedOpWrapper } from '../pipeline/types'
import type { ProjectionSnapshot, SerializedTieState } from './types'

// =============================================================================
// NoteQueueItem type (matches coalesce.ts internal type)
// =============================================================================

/**
 * Queue item for streaming coalesce - matches coalesce.ts internal type.
 * This is the structure we need to serialize/deserialize for tie state.
 */
export interface NoteQueueItem {
  kind: 'note'
  beatStart: number
  inputOrder: number
  op: TimedPipelineOp & ExpandedOpWrapper
  totalDuration: number
  pitch: string
  wasTied: boolean
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Options for creating initial projection state.
 */
export interface InitialStateOptions {
  /** Initial BPM (default: 120) */
  bpm?: number
  /** Initial time signature (default: '4/4') */
  timeSignature?: TimeSignatureString
}

/**
 * Create initial projection state for starting compilation.
 *
 * @param options - Initial state options
 * @returns Initial ProjectionSnapshot
 */
export function initialProjectionState(
  options: InitialStateOptions = {}
): ProjectionSnapshot {
  const timeSignature = options.timeSignature ?? '4/4'
  const [num, denom] = timeSignature.split('/').map(Number)
  const beatsPerMeasure = num * (4 / denom)

  return {
    // Timing state
    beat: 0,
    measure: 1,
    beatInMeasure: 0,
    beatsPerMeasure,

    // Tempo/signature state
    bpm: options.bpm ?? 120,
    timeSignature,

    // Transform state
    transposition: 0,
    velocityMultiplier: 1,

    // Coalesce state
    activeTies: [],
    lastInputOrder: 0
  }
}

// =============================================================================
// Snapshot Capture
// =============================================================================

/**
 * Context for capturing state.
 */
export interface SnapshotContext {
  /** Current BPM */
  bpm: number
  /** Current time signature */
  timeSignature: TimeSignatureString
  /** Current transposition in semitones */
  transposition?: number
  /** Current velocity multiplier */
  velocityMultiplier?: number
}

/**
 * Capture state at a section boundary.
 *
 * @param beat - Current beat position
 * @param measure - Current measure number
 * @param beatInMeasure - Beat position within measure
 * @param beatsPerMeasure - Beats per measure
 * @param activeTies - Active tie chains (from coalesce)
 * @param lastInputOrder - Last input order counter value
 * @param context - Additional context (bpm, timeSignature, etc.)
 * @returns Snapshot capturing full state
 */
export function captureSnapshot(
  beat: number,
  measure: number,
  beatInMeasure: number,
  beatsPerMeasure: number,
  activeTies: Map<string, NoteQueueItem>,
  lastInputOrder: number,
  context: SnapshotContext
): ProjectionSnapshot {
  return {
    beat,
    measure,
    beatInMeasure,
    beatsPerMeasure,
    bpm: context.bpm,
    timeSignature: context.timeSignature,
    transposition: context.transposition ?? 0,
    velocityMultiplier: context.velocityMultiplier ?? 1,
    activeTies: serializeActiveTies(activeTies),
    lastInputOrder
  }
}

/**
 * Capture snapshot from timed operations array.
 * Useful after full timing phase completion.
 *
 * @param timedOps - Array of timed operations
 * @param activeTies - Active tie chains
 * @param lastInputOrder - Last input order counter value
 * @param context - Additional context
 * @returns Snapshot at end of operations
 */
export function captureSnapshotFromTimed(
  timedOps: TimedPipelineOp[],
  activeTies: Map<string, NoteQueueItem>,
  lastInputOrder: number,
  context: SnapshotContext
): ProjectionSnapshot {
  const lastOp = timedOps[timedOps.length - 1]

  if (!lastOp) {
    return initialProjectionState({
      bpm: context.bpm,
      timeSignature: context.timeSignature
    })
  }

  // Get timing info from last operation
  const beat = lastOp.beatStart + lastOp.beatDuration
  const measure = lastOp.measure
  const beatInMeasure = lastOp.beatInMeasure

  // Parse time signature for beatsPerMeasure
  const [num, denom] = context.timeSignature.split('/').map(Number)
  const beatsPerMeasure = num * (4 / denom)

  return captureSnapshot(
    beat,
    measure,
    beatInMeasure,
    beatsPerMeasure,
    activeTies,
    lastInputOrder,
    context
  )
}

// =============================================================================
// Tie State Serialization
// =============================================================================

/**
 * Serialize active ties map to array format for storage.
 *
 * @param activeTies - Map of tie key to NoteQueueItem
 * @returns Array of SerializedTieState
 */
export function serializeActiveTies(
  activeTies: Map<string, NoteQueueItem>
): SerializedTieState[] {
  const result: SerializedTieState[] = []

  for (const [key, item] of activeTies) {
    result.push({
      key,
      startBeat: item.beatStart,
      accumulatedDuration: item.totalDuration,
      startOp: item.op,
      inputOrder: item.inputOrder
    })
  }

  return result
}

/**
 * Deserialize tie state array back to Map format.
 *
 * @param serialized - Array of SerializedTieState
 * @returns Map of tie key to NoteQueueItem
 */
export function deserializeActiveTies(
  serialized: SerializedTieState[]
): Map<string, NoteQueueItem> {
  const result = new Map<string, NoteQueueItem>()

  for (const tie of serialized) {
    // Extract pitch from key (format: expressionId:pitch)
    const pitch = tie.key.split(':')[1] ?? tie.key

    result.set(tie.key, {
      kind: 'note',
      beatStart: tie.startBeat,
      inputOrder: tie.inputOrder,
      op: tie.startOp as TimedPipelineOp & ExpandedOpWrapper,
      totalDuration: tie.accumulatedDuration,
      pitch,
      wasTied: true
    })
  }

  return result
}

// =============================================================================
// State Merging
// =============================================================================

/**
 * Update snapshot with new timing values.
 * Used when resuming compilation to advance state.
 *
 * @param snapshot - Original snapshot
 * @param beat - New beat position
 * @param measure - New measure
 * @param beatInMeasure - New beat in measure
 * @returns Updated snapshot
 */
export function advanceSnapshot(
  snapshot: ProjectionSnapshot,
  beat: number,
  measure: number,
  beatInMeasure: number
): ProjectionSnapshot {
  return {
    ...snapshot,
    beat,
    measure,
    beatInMeasure
  }
}

/**
 * Merge tie state into snapshot.
 *
 * @param snapshot - Original snapshot
 * @param activeTies - New active ties
 * @param lastInputOrder - New input order counter
 * @returns Updated snapshot
 */
export function updateSnapshotTies(
  snapshot: ProjectionSnapshot,
  activeTies: Map<string, NoteQueueItem>,
  lastInputOrder: number
): ProjectionSnapshot {
  return {
    ...snapshot,
    activeTies: serializeActiveTies(activeTies),
    lastInputOrder
  }
}
