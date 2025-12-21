/**
 * RFC-026: Event Sourcing Compiler - Phase Wrappers
 * 
 * Wraps existing pipeline phases as Projection implementations.
 * This is Phase 2 of the event sourcing migration.
 */

import type { ClipNode } from '../../clip/types'
import type { TimeSignatureString } from '../../../../../symphonyscript/packages/core/src/types/primitives'
import type { 
  ExpandedSequence, 
  TimedSequence,
  CompiledClip,
  TempoMap 
} from '../pipeline/types'

import { expandClip } from '../pipeline/expand'
import { computeTiming } from '../pipeline/timing'
import { coalesceStream } from '../pipeline/coalesce'
import { buildTempoMap } from '../pipeline/tempo-map'
import { emitEvents } from '../pipeline/emit'

import type { 
  ExpandProjection, 
  TimeProjection, 
  TieProjection, 
  EmitProjection 
} from './types'

// =============================================================================
// Phase Wrappers
// =============================================================================

/**
 * Expand phase wrapper.
 * Transforms ClipNode into flat PipelineOp sequence.
 */
export const expandProjection: ExpandProjection = {
  name: 'expand',
  execute(clip, limits = {}) {
    return expandClip(clip, {
      maxDepth: limits.maxDepth,
      maxLoopExpansions: limits.maxLoopExpansions,
      maxOperations: limits.maxOperations
    })
  }
}

/**
 * Timing phase wrapper.
 * Adds beat position and measure tracking to operations.
 */
export const timeProjection: TimeProjection = {
  name: 'time',
  execute(sequence, timeSignature = '4/4') {
    return computeTiming(sequence, timeSignature)
  }
}

/**
 * Tie coalescing phase wrapper.
 * Merges tied notes into single extended notes.
 */
export const tieProjection: TieProjection = {
  name: 'tie',
  execute(sequence) {
    return coalesceStream(sequence)
  }
}

/**
 * Emit phase wrapper.
 * Converts timed operations into compiled events.
 */
export const emitProjection: EmitProjection = {
  name: 'emit',
  execute(sequence, tempoMap, options = {}) {
    return emitEvents(sequence, tempoMap, options)
  }
}

// =============================================================================
// Tempo Map Builder (Utility)
// =============================================================================

/**
 * Build tempo map from timed sequence.
 * Exposed for pipeline use.
 */
export function buildTempoMapFromSequence(
  sequence: TimedSequence,
  bpm: number,
  options: {
    tempoPrecision?: 'standard' | 'high' | 'sample'
    sampleRate?: number
  } = {}
): TempoMap {
  return buildTempoMap(sequence, bpm, options)
}
