export * from './types'
export {
  coalesceStream,
  coalesceStreamWithInitialTies,
  streamingCoalesce,
  streamingCoalesceWithWarnings,
  streamingCoalesceToResult,
  streamingCoalesceWithInitialTies,
  serializeActiveTies,
  createWarningCollector,
  type CoalesceResult,
  type CoalesceWarning,
  type WarningCollector,
  type SerializedTieState,
  type NoteQueueItem
} from './coalesce'
export {expandClip, ExpansionError, type ExpansionLimitType} from './expand'
export {computeTiming, computeTimingFromState, type TimingInitialState} from './timing'
export {buildTempoMap} from './tempo-map'
export {emitEvents} from './emit'
export {estimateExpansion, type ExpansionEstimate} from './estimate'
export {generateManifest} from './manifest'

import {type AsciiOptions, renderPattern} from '../../debug/ascii'
import type {ClipNode} from '../../clip/types'
import type {CompiledClip} from './types'
import {expandClip, ExpansionError} from './expand'
import {computeTiming} from './timing'
import {coalesceStream, streamingCoalesceToResult} from './coalesce'
import {buildTempoMap} from './tempo-map'
import {emitEvents} from './emit'
import {estimateExpansion} from './estimate'
import {generateManifest} from './manifest'

export interface PipelineOptions {
  bpm: number
  timeSignature?: string
  maxDepth?: number
  maxLoopExpansions?: number
  maxOperations?: number
  defaultVelocity?: number
  channel?: number

  /**
   * Sample rate for timing quantization.
   * When set, all event times are quantized to sample boundaries.
   * Common values: 44100, 48000, 96000
   */
  sampleRate?: number

  /**
   * Tempo integration precision.
   * - 'standard': Fast, ~99.9% accurate (default)
   * - 'high': Slower, ~99.999% accurate
   * - 'sample': Highest, sample-accurate (requires sampleRate)
   */
  tempoPrecision?: 'standard' | 'high' | 'sample'

  /**
   * If true, estimate expansion size before compiling.
   * Throws early with helpful message if limits would be exceeded.
   */
  preEstimate?: boolean

  /**
   * Random seed for deterministic compilation.
   * When set, humanize and random patterns produce reproducible output.
   * Use the same seed to get identical results.
   */
  seed?: number

  /**
   * Use streaming coalesce algorithm (heap-based ordering).
   * 
   * Benefits:
   * - Order maintained implicitly via MinHeap (no final re-sort)
   * - Foundation for incremental compilation
   * 
   * Default: false (batch mode for backward compatibility)
   * @experimental
   */
  streaming?: boolean

  /**
   * Enable incremental compilation with caching.
   * 
   * When enabled, use `incrementalCompile()` from the incremental module
   * instead of `compileClip()` for cache support.
   * 
   * @experimental
   * @see src/compiler/incremental for full incremental API
   */
  incremental?: boolean
}

/**
 * Compile clip through full pipeline.
 * 
 * @param clip - The clip to compile
 * @param options - Pipeline configuration options
 * @param options.streaming - Use streaming coalesce (heap-based, no re-sort)
 */
export function compileClip(clip: ClipNode, options: PipelineOptions): CompiledClip {
  // Pre-estimation check (optional)
  if (options.preEstimate) {
    const estimate = estimateExpansion(clip)
    const maxOps = options.maxOperations ?? 100000

    if (estimate.estimatedOperations > maxOps) {
      throw new ExpansionError(
        `Composition would produce ~${estimate.estimatedOperations.toLocaleString()} operations ` +
        `(limit: ${maxOps.toLocaleString()}). ` +
        (estimate.warnings.length > 0
          ? `Hints: ${estimate.warnings.join('; ')}`
          : 'Reduce loop counts or nested clips.'),
        'operations',
        clip.name ?? 'root'
      )
    }
  }

  const expanded = expandClip(clip, {
    maxDepth: options.maxDepth,
    maxLoopExpansions: options.maxLoopExpansions,
    maxOperations: options.maxOperations
  })
  const timed = computeTiming(expanded, (options.timeSignature ?? '4/4') as any)

  // Coalesce Phase: Merge tied notes
  // Use streaming or batch based on options
  const coalesced = options.streaming
    ? streamingCoalesceToResult(timed)
    : coalesceStream(timed)

  const tempoMap = buildTempoMap(coalesced.sequence, options.bpm, {
    tempoPrecision: options.tempoPrecision,
    sampleRate: options.sampleRate
  })

  const result: CompiledClip = emitEvents(coalesced.sequence, tempoMap, {
    defaultVelocity: options.defaultVelocity,
    channel: options.channel,
    sampleRate: options.sampleRate,
    seed: options.seed
  })

  // Generate Manifest
  result.manifest = generateManifest(result.events)

  // Merge warnings
  if (coalesced.warnings.length > 0) {
    result.metadata.warnings.push(...coalesced.warnings.map(w => w.message))
  }

  // Attach debug methods
  result.print = (asciiOptions?: AsciiOptions) => {
    console.log(renderPattern(result.events, clip.name ?? 'Clip', {
      bpm: options.bpm,
      ...asciiOptions
    }))
  }

  result.toAscii = (asciiOptions?: AsciiOptions) => {
    return renderPattern(result.events, clip.name ?? 'Clip', {
      bpm: options.bpm,
      ...asciiOptions
    })
  }

  return result
}
