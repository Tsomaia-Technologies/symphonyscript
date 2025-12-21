import type {ExpandedOpWrapper, TimedPipelineOp, TimedSequence} from './types'
import type {NoteOp} from '../../clip/types'

export interface CoalesceWarning {
  type: 'orphaned_tie_start' | 'orphaned_tie_end' | 'mismatched_pitch'
  beat: number
  pitch: string
  message: string
}

export interface CoalesceResult {
  sequence: TimedSequence
  warnings: CoalesceWarning[]
}

/**
 * Coalesce tied notes into single extended notes.
 *
 * Algorithm:
 * 1. Process operations in time order
 * 2. Maintain active ties map
 * 3. Merge start->continue->end sequences into one note
 * 4. Warn on orphaned ties
 */

/**
 * Generate unique key for tie tracking.
 * Includes expressionId for polyphonic voice disambiguation.
 */
function tieKey(noteOp: NoteOp): string {
  const exprId = noteOp.expressionId ?? 0
  return `${exprId}:${noteOp.note}`
}

export function coalesceStream(sequence: TimedSequence): CoalesceResult {
  const warnings: CoalesceWarning[] = []
  const result: TimedPipelineOp[] = []

  // Track active tie chains: expressionId:pitch -> state
  const activeTies = new Map<string, {
    startOp: TimedPipelineOp & ExpandedOpWrapper
    totalDuration: number
    pitch: string  // Keep pitch for warnings
  }>()

  // Iterate through operations
  // Note: Sequence is assumed to be sorted by beatStart from Timing phase
  for (const op of sequence.operations) {
    // Pass through non-note operations or markers
    if (op.kind !== 'op' || op.original.kind !== 'note') {
      result.push(op)
      continue
    }

    const noteOp = op.original as NoteOp
    const key = tieKey(noteOp)
    const pitch = noteOp.note  // Keep for warning messages
    const tie = noteOp.tie

    if (!tie) {
      // No tie - check if we are interrupting an active tie?
      // Actually, a non-tied note on the same pitch DOES NOT necessarily break a tie
      // if it's a different voice/track, but here we process a single flattened stream.
      // If it's the same channel/track (which isn't distinguished well yet here),
      // we should probably warn?
      // But simple logic: if active tie exists for this pitch, and we see valid tie-end later,
      // this note might just be an overlapping voice.
      // For now, simpler: "No tie" notes are just independent.
      // But we should check for orphaned starts if we wanted to be strict.
      // The spec says: "No tie - emit as-is"
      result.push(op)
      continue
    }

    switch (tie) {
      case 'start': {
        // If we already have an active start for this pitch, it's orphaned
        if (activeTies.has(key)) {
          const orphan = activeTies.get(key)!
          warnings.push({
            type: 'orphaned_tie_start',
            beat: orphan.startOp.beatStart,
            pitch: orphan.pitch,
            message: `Tie start at beat ${orphan.startOp.beatStart} was never ended (new start at ${op.beatStart})`
          })
          // Emit the orphaned note with its accumulated duration
          emitTiedNote(result, orphan.startOp, orphan.totalDuration)
        }

        // Start new tie
        activeTies.set(key, {
          startOp: op as TimedPipelineOp & ExpandedOpWrapper,
          totalDuration: op.beatDuration,
          pitch
        })
        break
      }

      case 'continue': {
        const active = activeTies.get(key)
        if (active) {
          // Extend duration
          active.totalDuration += op.beatDuration
          // Do NOT emit this op
        } else {
          // Orphaned continue
          warnings.push({
            type: 'orphaned_tie_end', // categorize as end-type/tail orphan
            beat: op.beatStart,
            pitch,
            message: `Tie continue at beat ${op.beatStart} has no matching start`
          })
          // Emit as regular note
          result.push(stripTie(op))
        }
        break
      }

      case 'end': {
        const active = activeTies.get(key)
        if (active) {
          // Complete the tie
          active.totalDuration += op.beatDuration
          emitTiedNote(result, active.startOp, active.totalDuration)
          activeTies.delete(key)
        } else {
          // Orphaned end
          warnings.push({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie end at beat ${op.beatStart} has no matching start`
          })
          // Emit as regular note
          result.push(stripTie(op))
        }
        break
      }
    }
  }

  // Cleanup remaining active ties (orphaned starts)
  for (const [, active] of Array.from(activeTies)) {
    warnings.push({
      type: 'orphaned_tie_start',
      beat: active.startOp.beatStart,
      pitch: active.pitch,
      message: `Tie start at beat ${active.startOp.beatStart} was never ended`
    })
    emitTiedNote(result, active.startOp, active.totalDuration)
  }

  // Re-sort required?
  // Coalescing reduces count, but `emitTiedNote` pushes to end?
  // NO, we pushed to `result` during the loop.
  // `start` case does nothing to `result`.
  // `end` case pushes the merged note.
  // This effectively moves the 'start' note to the time of the 'end' note in the array order,
  // THOUGH it keeps its original beatStart.
  // So yes, we must RESORT because `emitTiedNote` inserts the note when the END matches,
  // which is later in the stream.

  result.sort((a, b) => {
    const aBeat = 'beatStart' in a ? a.beatStart : 0
    const bBeat = 'beatStart' in b ? b.beatStart : 0
    return aBeat - bBeat
  })

  return {
    sequence: {
      operations: result,
      totalBeats: sequence.totalBeats,
      measures: sequence.measures
    },
    warnings
  }
}

function emitTiedNote(result: TimedPipelineOp[], startOp: TimedPipelineOp & ExpandedOpWrapper, totalDuration: number) {
  // Clone and update duration
  const merged: TimedPipelineOp = {
    ...startOp,
    beatDuration: totalDuration,
    original: {
      ...startOp.original as NoteOp,
      duration: totalDuration, // Update underlying note duration too for completeness
      tie: undefined // Remove tie marker so Emit doesn't get confused (though Emit ignores it mostly)
    }
  }
  result.push(merged)
}

function stripTie(op: TimedPipelineOp): TimedPipelineOp {
  if (op.kind !== 'op' || op.original.kind !== 'note') return op
  return {
    ...op,
    original: {
      ...(op.original as NoteOp),
      tie: undefined
    }
  }
}

// =============================================================================
// Streaming Coalesce (RFC-026.5)
// =============================================================================

import { MinHeap } from '@symphonyscript/core/util/heap'

/**
 * Warning collector for streaming coalesce.
 * Uses closure pattern since generator return values are lost with yield*.
 */
export interface WarningCollector {
  add(warning: CoalesceWarning): void
  getWarnings(): CoalesceWarning[]
}

/**
 * Create a new warning collector.
 */
export function createWarningCollector(): WarningCollector {
  const warnings: CoalesceWarning[] = []
  return {
    add: (w) => warnings.push(w),
    getWarnings: () => [...warnings]  // Return copy to prevent mutation
  }
}

/**
 * Queue item for streaming coalesce.
 * Discriminated union for notes and markers.
 */
type NoteQueueItem = {
  kind: 'note'
  beatStart: number
  inputOrder: number  // Original input position for stable sorting
  op: TimedPipelineOp & ExpandedOpWrapper
  totalDuration: number
  pitch: string
  /** True if this note was part of a tie chain and needs finalization */
  wasTied: boolean
}

type MarkerQueueItem = {
  kind: 'marker'
  beatStart: number
  inputOrder: number  // Original input position for stable sorting
  op: TimedPipelineOp
}

type QueueItem = NoteQueueItem | MarkerQueueItem

/**
 * Comparator for queue items.
 * Primary: beatStart (ascending)
 * Secondary: inputOrder (ascending) to match batch's stable sort behavior
 */
function queueComparator(a: QueueItem, b: QueueItem): number {
  const beatDiff = a.beatStart - b.beatStart
  if (beatDiff !== 0) return beatDiff
  return a.inputOrder - b.inputOrder
}

/**
 * Check if operation is a note operation.
 */
function isNoteOp(op: TimedPipelineOp): op is TimedPipelineOp & ExpandedOpWrapper & { original: NoteOp } {
  return op.kind === 'op' && op.original.kind === 'note'
}


/**
 * Finalize a note queue item into a TimedPipelineOp.
 * Only modifies notes that were part of a tie chain.
 */
function finalizeQueueNote(item: NoteQueueItem): TimedPipelineOp {
  // Non-tied notes pass through unchanged
  if (!item.wasTied) {
    return item.op
  }
  
  // Tied notes need duration update and tie removal
  return {
    ...item.op,
    beatDuration: item.totalDuration,
    original: {
      ...(item.op.original as NoteOp),
      duration: item.totalDuration,
      tie: undefined
    }
  }
}

/**
 * Streaming coalesce using priority queue.
 * 
 * This implementation:
 * 1. Queues ALL operations (notes and markers) for beat-order correctness
 * 2. Uses MinHeap to maintain order without final re-sort
 * 3. Handles tie chains by holding in activeTies until resolved
 * 
 * Benefits over batch:
 * - Order maintained implicitly (no O(n log n) final sort)
 * - Foundation for incremental compilation
 * 
 * @param source - Iterable of timed pipeline operations
 * @param warnings - Warning collector for orphaned ties
 */
export function* streamingCoalesce(
  source: Iterable<TimedPipelineOp>,
  warnings: WarningCollector
): Generator<TimedPipelineOp> {
  const activeTies = new Map<string, NoteQueueItem>()
  const readyQueue = new MinHeap<QueueItem>(queueComparator)
  
  let currentInputOrder = 0
  
  for (const op of source) {
    const opInputOrder = currentInputOrder++
    
    if (isNoteOp(op)) {
      const noteOp = op.original as NoteOp
      const key = tieKey(noteOp)
      const pitch = noteOp.note
      const tie = noteOp.tie
      
      if (tie === 'start') {
        // If we already have an active start for this pitch, it's orphaned
        if (activeTies.has(key)) {
          const orphan = activeTies.get(key)!
          warnings.add({
            type: 'orphaned_tie_start',
            beat: orphan.beatStart,
            pitch: orphan.pitch,
            message: `Tie start at beat ${orphan.beatStart} was never ended (new start at ${op.beatStart})`
          })
          // Push orphaned note to queue
          readyQueue.push(orphan)
        }
        
        // Start new tie - hold in activeTies
        activeTies.set(key, {
          kind: 'note',
          beatStart: op.beatStart,
          inputOrder: opInputOrder,
          op,
          totalDuration: op.beatDuration,
          pitch,
          wasTied: true
        })
      } else if (tie === 'continue') {
        const active = activeTies.get(key)
        if (active) {
          // Extend duration - don't emit yet
          active.totalDuration += op.beatDuration
        } else {
          // Orphaned continue
          warnings.add({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie continue at beat ${op.beatStart} has no matching start`
          })
          // Queue as regular note (stripped of tie)
          readyQueue.push({
            kind: 'note',
            beatStart: op.beatStart,
            inputOrder: opInputOrder,
            op: stripTie(op) as TimedPipelineOp & ExpandedOpWrapper,
            totalDuration: op.beatDuration,
            pitch,
            wasTied: false  // Orphaned, treat as regular
          })
        }
      } else if (tie === 'end') {
        const active = activeTies.get(key)
        if (active) {
          // Complete the tie - add to ready queue
          // Use current inputOrder (when END is processed) to match batch behavior
          // where tied notes are pushed to result[] at END time
          active.totalDuration += op.beatDuration
          active.inputOrder = opInputOrder
          readyQueue.push(active)
          activeTies.delete(key)
        } else {
          // Orphaned end
          warnings.add({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie end at beat ${op.beatStart} has no matching start`
          })
          // Queue as regular note (stripped of tie)
          readyQueue.push({
            kind: 'note',
            beatStart: op.beatStart,
            inputOrder: opInputOrder,
            op: stripTie(op) as TimedPipelineOp & ExpandedOpWrapper,
            totalDuration: op.beatDuration,
            pitch,
            wasTied: false  // Orphaned, treat as regular
          })
        }
      } else {
        // No tie - queue immediately (pass through unchanged)
        readyQueue.push({
          kind: 'note',
          beatStart: op.beatStart,
          inputOrder: opInputOrder,
          op,
          totalDuration: op.beatDuration,
          pitch,
          wasTied: false
        })
      }
    } else {
      // Markers also queued for beat-order correctness
      readyQueue.push({
        kind: 'marker',
        beatStart: op.beatStart,
        inputOrder: opInputOrder,
        op
      })
    }
  }
  
  // Flush orphaned ties with warnings
  for (const [, active] of activeTies) {
    warnings.add({
      type: 'orphaned_tie_start',
      beat: active.beatStart,
      pitch: active.pitch,
      message: `Tie start at beat ${active.beatStart} was never ended`
    })
    readyQueue.push(active)
  }
  
  // Drain queue in beat order
  while (!readyQueue.isEmpty()) {
    const item = readyQueue.pop()!
    if (item.kind === 'marker') {
      yield item.op
    } else {
      yield finalizeQueueNote(item)
    }
  }
}

/**
 * Convenience wrapper that creates warning collector.
 * Returns iterator and getWarnings function.
 */
export function streamingCoalesceWithWarnings(
  source: Iterable<TimedPipelineOp>
): { iterator: Generator<TimedPipelineOp>; getWarnings: () => CoalesceWarning[] } {
  const collector = createWarningCollector()
  return {
    iterator: streamingCoalesce(source, collector),
    getWarnings: collector.getWarnings
  }
}

/**
 * Streaming coalesce that returns CoalesceResult compatible with batch version.
 * Consumes the entire iterator to produce result.
 */
export function streamingCoalesceToResult(
  sequence: TimedSequence
): CoalesceResult {
  const { iterator, getWarnings } = streamingCoalesceWithWarnings(sequence.operations)
  const operations = [...iterator]
  
  return {
    sequence: {
      operations,
      totalBeats: sequence.totalBeats,
      measures: sequence.measures
    },
    warnings: getWarnings()
  }
}

// =============================================================================
// Incremental Compilation Support
// =============================================================================

/**
 * Serialized state of an active tie chain.
 * Used for incremental compilation to restore tie state.
 */
export interface SerializedTieState {
  /** Tie key: expressionId:pitch */
  key: string
  /** Beat when tie:start was encountered */
  startBeat: number
  /** Sum of durations accumulated so far */
  accumulatedDuration: number
  /** Full operation needed to emit final note */
  startOp: TimedPipelineOp
  /** Input order for stable sorting in heap */
  inputOrder: number
}

/**
 * Streaming coalesce with initial tie state.
 * Used for incremental compilation to resume from a section boundary.
 *
 * @param source - Iterable of timed pipeline operations
 * @param warnings - Warning collector for orphaned ties
 * @param initialTies - Serialized tie state from previous section
 * @param initialInputOrder - Starting input order counter value
 */
export function* streamingCoalesceWithInitialTies(
  source: Iterable<TimedPipelineOp>,
  warnings: WarningCollector,
  initialTies: SerializedTieState[],
  initialInputOrder: number
): Generator<TimedPipelineOp> {
  // Restore activeTies map from serialized state
  const activeTies = new Map<string, NoteQueueItem>()
  for (const tie of initialTies) {
    // Extract pitch from key (format: expressionId:pitch)
    const pitch = tie.key.split(':')[1] ?? tie.key
    
    activeTies.set(tie.key, {
      kind: 'note',
      beatStart: tie.startBeat,
      inputOrder: tie.inputOrder,
      op: tie.startOp as TimedPipelineOp & ExpandedOpWrapper,
      totalDuration: tie.accumulatedDuration,
      pitch,
      wasTied: true
    })
  }
  
  const readyQueue = new MinHeap<QueueItem>(queueComparator)
  let currentInputOrder = initialInputOrder
  
  for (const op of source) {
    const opInputOrder = currentInputOrder++
    
    if (isNoteOp(op)) {
      const noteOp = op.original as NoteOp
      const key = tieKey(noteOp)
      const pitch = noteOp.note
      const tie = noteOp.tie
      
      if (tie === 'start') {
        // If we already have an active start for this pitch, it's orphaned
        if (activeTies.has(key)) {
          const orphan = activeTies.get(key)!
          warnings.add({
            type: 'orphaned_tie_start',
            beat: orphan.beatStart,
            pitch: orphan.pitch,
            message: `Tie start at beat ${orphan.beatStart} was never ended (new start at ${op.beatStart})`
          })
          readyQueue.push(orphan)
        }
        
        // Start new tie
        activeTies.set(key, {
          kind: 'note',
          beatStart: op.beatStart,
          inputOrder: opInputOrder,
          op,
          totalDuration: op.beatDuration,
          pitch,
          wasTied: true
        })
      } else if (tie === 'continue') {
        const active = activeTies.get(key)
        if (active) {
          active.totalDuration += op.beatDuration
        } else {
          warnings.add({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie continue at beat ${op.beatStart} has no matching start`
          })
          readyQueue.push({
            kind: 'note',
            beatStart: op.beatStart,
            inputOrder: opInputOrder,
            op: stripTie(op) as TimedPipelineOp & ExpandedOpWrapper,
            totalDuration: op.beatDuration,
            pitch,
            wasTied: false
          })
        }
      } else if (tie === 'end') {
        const active = activeTies.get(key)
        if (active) {
          active.totalDuration += op.beatDuration
          active.inputOrder = opInputOrder
          readyQueue.push(active)
          activeTies.delete(key)
        } else {
          warnings.add({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie end at beat ${op.beatStart} has no matching start`
          })
          readyQueue.push({
            kind: 'note',
            beatStart: op.beatStart,
            inputOrder: opInputOrder,
            op: stripTie(op) as TimedPipelineOp & ExpandedOpWrapper,
            totalDuration: op.beatDuration,
            pitch,
            wasTied: false
          })
        }
      } else {
        // No tie - queue immediately
        readyQueue.push({
          kind: 'note',
          beatStart: op.beatStart,
          inputOrder: opInputOrder,
          op,
          totalDuration: op.beatDuration,
          pitch,
          wasTied: false
        })
      }
    } else {
      // Markers queued for beat-order correctness
      readyQueue.push({
        kind: 'marker',
        beatStart: op.beatStart,
        inputOrder: opInputOrder,
        op
      })
    }
  }
  
  // Flush orphaned ties with warnings
  for (const [, active] of activeTies) {
    warnings.add({
      type: 'orphaned_tie_start',
      beat: active.beatStart,
      pitch: active.pitch,
      message: `Tie start at beat ${active.beatStart} was never ended`
    })
    readyQueue.push(active)
  }
  
  // Drain queue in beat order
  while (!readyQueue.isEmpty()) {
    const item = readyQueue.pop()!
    if (item.kind === 'marker') {
      yield item.op
    } else {
      yield finalizeQueueNote(item)
    }
  }
}

/**
 * Get the current active ties as serializable state.
 * Used for capturing state at section boundaries.
 *
 * @param activeTies - Map of active tie chains
 * @returns Array of serialized tie states
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

// =============================================================================
// Non-streaming Coalesce with Initial Ties (RFC-026.9)
// =============================================================================

/**
 * Non-streaming (batch) coalesce with initial tie state.
 * Used for incremental compilation to resume from a section boundary.
 * 
 * This is the non-streaming equivalent of `streamingCoalesceWithInitialTies`.
 * It uses batch processing with final sort (faster than streaming for full compiles).
 *
 * @param sequence - TimedSequence to process
 * @param initialTies - Serialized tie state from previous section
 * @returns CoalesceResult with warnings
 */
export function coalesceStreamWithInitialTies(
  sequence: TimedSequence,
  initialTies: SerializedTieState[]
): CoalesceResult {
  const warnings: CoalesceWarning[] = []
  const result: TimedPipelineOp[] = []

  // Pre-populate activeTies map from serialized state
  const activeTies = new Map<string, {
    startOp: TimedPipelineOp & ExpandedOpWrapper
    totalDuration: number
    pitch: string
  }>()
  
  for (const tie of initialTies) {
    // Extract pitch from key (format: expressionId:pitch)
    const pitch = tie.key.split(':')[1] ?? tie.key
    
    activeTies.set(tie.key, {
      startOp: tie.startOp as TimedPipelineOp & ExpandedOpWrapper,
      totalDuration: tie.accumulatedDuration,
      pitch
    })
  }

  // Process operations (same logic as coalesceStream)
  for (const op of sequence.operations) {
    // Pass through non-note operations or markers
    if (op.kind !== 'op' || op.original.kind !== 'note') {
      result.push(op)
      continue
    }

    const noteOp = op.original as NoteOp
    const key = tieKey(noteOp)
    const pitch = noteOp.note
    const tie = noteOp.tie

    if (!tie) {
      result.push(op)
      continue
    }

    switch (tie) {
      case 'start': {
        if (activeTies.has(key)) {
          const orphan = activeTies.get(key)!
          warnings.push({
            type: 'orphaned_tie_start',
            beat: orphan.startOp.beatStart,
            pitch: orphan.pitch,
            message: `Tie start at beat ${orphan.startOp.beatStart} was never ended (new start at ${op.beatStart})`
          })
          emitTiedNote(result, orphan.startOp, orphan.totalDuration)
        }

        activeTies.set(key, {
          startOp: op as TimedPipelineOp & ExpandedOpWrapper,
          totalDuration: op.beatDuration,
          pitch
        })
        break
      }

      case 'continue': {
        const active = activeTies.get(key)
        if (active) {
          active.totalDuration += op.beatDuration
        } else {
          warnings.push({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie continue at beat ${op.beatStart} has no matching start`
          })
          result.push(stripTie(op))
        }
        break
      }

      case 'end': {
        const active = activeTies.get(key)
        if (active) {
          active.totalDuration += op.beatDuration
          emitTiedNote(result, active.startOp, active.totalDuration)
          activeTies.delete(key)
        } else {
          warnings.push({
            type: 'orphaned_tie_end',
            beat: op.beatStart,
            pitch,
            message: `Tie end at beat ${op.beatStart} has no matching start`
          })
          result.push(stripTie(op))
        }
        break
      }
    }
  }

  // Cleanup remaining active ties (orphaned starts)
  for (const [, active] of Array.from(activeTies)) {
    warnings.push({
      type: 'orphaned_tie_start',
      beat: active.startOp.beatStart,
      pitch: active.pitch,
      message: `Tie start at beat ${active.startOp.beatStart} was never ended`
    })
    emitTiedNote(result, active.startOp, active.totalDuration)
  }

  // Final sort by beat
  result.sort((a, b) => {
    const aBeat = 'beatStart' in a ? a.beatStart : 0
    const bBeat = 'beatStart' in b ? b.beatStart : 0
    return aBeat - bBeat
  })

  return {
    sequence: {
      operations: result,
      totalBeats: sequence.totalBeats,
      measures: sequence.measures
    },
    warnings
  }
}

/**
 * Export NoteQueueItem type for incremental compilation.
 */
export type { NoteQueueItem }
