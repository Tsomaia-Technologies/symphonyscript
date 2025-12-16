/**
 * RFC-026.9: Incremental Compilation
 *
 * Main incremental compilation algorithm.
 * Recompiles only changed sections while reusing cached results.
 */

import type { ClipNode } from '../../clip/types'
import type {
  CompiledClip,
  CompiledEvent,
  TempoMap,
  TimedSequence
} from '../pipeline/types'
import {
  expandClip,
  ExpansionError
} from '../pipeline/expand'
import { computeTiming, computeTimingFromState, type TimingInitialState } from '../pipeline/timing'
import {
  coalesceStream,
  coalesceStreamWithInitialTies,
  streamingCoalesceToResult,
  streamingCoalesceWithInitialTies,
  createWarningCollector,
  type SerializedTieState
} from '../pipeline/coalesce'
import { buildTempoMap } from '../pipeline/tempo-map'
import { emitEvents } from '../pipeline/emit'
import { estimateExpansion } from '../pipeline/estimate'
import { generateManifest } from '../pipeline/manifest'

import type {
  Section,
  ProjectionSnapshot,
  CompilationCache,
  InvalidationResult,
  IncrementalCompileResult
} from './types'
// hashClip removed - section-level comparison is used instead
import { detectSections, findFirstChangedSection, updateSectionBeats, findFirstChangedSectionLazy } from './sections'
import { initialProjectionState } from './snapshot'
import { buildCache, updateCache, getCachedEvents, getCachedEntryState } from './cache'

// =============================================================================
// Pipeline Options
// =============================================================================

/**
 * Options for incremental compilation.
 */
export interface IncrementalPipelineOptions {
  /** Initial BPM */
  bpm: number
  /** Time signature (default: '4/4') */
  timeSignature?: `${number}/${number}`
  /** Max recursion depth */
  maxDepth?: number
  /** Max loop expansions */
  maxLoopExpansions?: number
  /** Max operations */
  maxOperations?: number
  /** Default velocity */
  defaultVelocity?: number
  /** MIDI channel */
  channel?: number
  /** Sample rate for quantization */
  sampleRate?: number
  /** Tempo precision */
  tempoPrecision?: 'standard' | 'high' | 'sample'
  /** Pre-estimate expansion */
  preEstimate?: boolean
  /** Random seed */
  seed?: number
  /** Use streaming coalesce (default: false, non-streaming is faster) */
  streaming?: boolean
}

// =============================================================================
// Invalidation Detection
// =============================================================================

/**
 * Find which sections need recompilation.
 *
 * @param oldCache - Previous compilation cache
 * @param newSections - New sections from current clip
 * @returns Invalidation result
 */
export function findInvalidatedSections(
  oldCache: CompilationCache,
  newSections: Section[]
): InvalidationResult {
  const oldSections = oldCache.sections

  // No cache = full compile
  if (oldSections.length === 0) {
    return {
      firstChanged: 0,
      cascadeAll: true,
      reason: 'no_cache'
    }
  }

  // Different section count = structural change
  if (oldSections.length !== newSections.length) {
    const firstChanged = findFirstChangedSection(
      oldSections.map(s => ({ ...s, hash: s.hash, startIndex: s.startIndex, endIndex: s.endIndex, startBeat: 0, endBeat: 0 })),
      newSections
    )
    return {
      firstChanged: firstChanged === -1 ? Math.min(oldSections.length, newSections.length) : firstChanged,
      cascadeAll: true,
      reason: 'section_count_changed'
    }
  }

  // Compare section hashes
  const firstChanged = findFirstChangedSection(
    oldSections.map(s => ({ ...s, hash: s.hash, startIndex: s.startIndex, endIndex: s.endIndex, startBeat: 0, endBeat: 0 })),
    newSections
  )

  if (firstChanged === -1) {
    // No changes
    return {
      firstChanged: -1,
      cascadeAll: false
    }
  }

  // Check if boundaries shifted (indicates structural change)
  const oldSection = oldSections[firstChanged]
  const newSection = newSections[firstChanged]
  const boundaryChanged =
    oldSection.startIndex !== newSection.startIndex ||
    oldSection.endIndex !== newSection.endIndex

  return {
    firstChanged,
    cascadeAll: boundaryChanged,
    reason: boundaryChanged ? 'boundary_changed' : 'hash_mismatch'
  }
}

// =============================================================================
// Partial Compilation
// =============================================================================

/**
 * Compile a clip starting from a specific section.
 *
 * @param clip - Full ClipNode
 * @param startIndex - Operation index to start from
 * @param entryState - State at section boundary
 * @param tempoMap - Tempo map from full compile
 * @param options - Pipeline options
 * @returns Compiled events and exit state
 */
export function compileFromState(
  clip: ClipNode,
  startIndex: number,
  entryState: ProjectionSnapshot,
  tempoMap: TempoMap,
  options: IncrementalPipelineOptions
): { events: CompiledEvent[]; exitState: ProjectionSnapshot; warnings: string[] } {
  // 1. Create partial clip with remaining operations
  const partialClip: ClipNode = {
    ...clip,
    operations: clip.operations.slice(startIndex)
  }

  // 2. Expand partial clip
  const expanded = expandClip(partialClip, {
    maxDepth: options.maxDepth,
    maxLoopExpansions: options.maxLoopExpansions,
    maxOperations: options.maxOperations
  })

  // 3. Compute timing from state
  const initialTimingState: TimingInitialState = {
    beat: entryState.beat,
    measure: entryState.measure,
    beatInMeasure: entryState.beatInMeasure,
    beatsPerMeasure: entryState.beatsPerMeasure
  }

  const timeSignature = options.timeSignature ?? '4/4'
  const timed = computeTimingFromState(expanded, timeSignature, initialTimingState)

  // 4. Coalesce with initial ties (streaming or non-streaming)
  let coalescedSequence: TimedSequence
  let coalescedWarnings: string[]
  
  if (options.streaming) {
    // Streaming coalesce with initial ties
    const warningCollector = createWarningCollector()
    const coalescedOps = [
      ...streamingCoalesceWithInitialTies(
        timed.operations,
        warningCollector,
        entryState.activeTies,
        entryState.lastInputOrder
      )
    ]
    coalescedSequence = {
      operations: coalescedOps,
      totalBeats: timed.totalBeats,
      measures: timed.measures
    }
    coalescedWarnings = warningCollector.getWarnings().map(w => w.message)
  } else {
    // Non-streaming coalesce with initial ties (faster)
    const coalesced = coalesceStreamWithInitialTies(timed, entryState.activeTies)
    coalescedSequence = coalesced.sequence
    coalescedWarnings = coalesced.warnings.map(w => w.message)
  }

  // 5. Emit events using provided tempo map
  const result = emitEvents(coalescedSequence, tempoMap, {
    defaultVelocity: options.defaultVelocity,
    channel: options.channel,
    sampleRate: options.sampleRate,
    seed: options.seed
  })

  // 6. Calculate exit state
  const exitState: ProjectionSnapshot = {
    ...entryState,
    beat: timed.totalBeats,
    measure: timed.measures,
    beatInMeasure: 0, // Simplified
    activeTies: [], // No active ties after full drain
    lastInputOrder: entryState.lastInputOrder + coalescedSequence.operations.length
  }

  return {
    events: result.events,
    exitState,
    warnings: coalescedWarnings
  }
}

// =============================================================================
// Full Compile (Initial)
// =============================================================================

/**
 * Perform a full compilation (no cache available).
 *
 * @param clip - ClipNode to compile
 * @param options - Pipeline options
 * @returns Full compilation result with cache
 */
function fullCompile(
  clip: ClipNode,
  options: IncrementalPipelineOptions
): IncrementalCompileResult {
  // Pre-estimation check
  if (options.preEstimate) {
    const estimate = estimateExpansion(clip)
    const maxOps = options.maxOperations ?? 100000

    if (estimate.estimatedOperations > maxOps) {
      throw new ExpansionError(
        `Composition would produce ~${estimate.estimatedOperations.toLocaleString()} operations ` +
        `(limit: ${maxOps.toLocaleString()}).`,
        'operations',
        clip.name ?? 'root'
      )
    }
  }

  // Standard pipeline
  const expanded = expandClip(clip, {
    maxDepth: options.maxDepth,
    maxLoopExpansions: options.maxLoopExpansions,
    maxOperations: options.maxOperations
  })

  const timeSignature = options.timeSignature ?? '4/4'
  const timed = computeTiming(expanded, timeSignature)
  
  // Use streaming or non-streaming coalesce based on option
  const coalesced = options.streaming
    ? streamingCoalesceToResult(timed)
    : coalesceStream(timed)

  const tempoMap = buildTempoMap(coalesced.sequence, options.bpm, {
    tempoPrecision: options.tempoPrecision,
    sampleRate: options.sampleRate
  })

  const result = emitEvents(coalesced.sequence, tempoMap, {
    defaultVelocity: options.defaultVelocity,
    channel: options.channel,
    sampleRate: options.sampleRate,
    seed: options.seed
  })

  result.manifest = generateManifest(result.events)

  if (coalesced.warnings.length > 0) {
    result.metadata.warnings.push(...coalesced.warnings.map(w => w.message))
  }

  // Detect sections for caching
  const sections = detectSections(clip)

  // Update section beat positions
  const beatPositions = new Map<number, number>()
  let currentBeat = 0
  for (let i = 0; i < clip.operations.length; i++) {
    beatPositions.set(i, currentBeat)
    // Advance beat based on operation (simplified)
    const op = clip.operations[i]
    if (op.kind === 'note' || op.kind === 'rest') {
      // Duration would need parsing - simplified here
      currentBeat += 1
    }
  }
  const sectionsWithBeats = updateSectionBeats(sections, beatPositions, timed.totalBeats)

  // Build cache
  const cache = buildCache(clip, sectionsWithBeats, result, timed, {
    bpm: options.bpm,
    timeSignature
  })

  // Store clip reference for O(1) identity check
  cache.lastClip = clip

  return {
    result,
    cache,
    stats: {
      fullCompile: true,
      sectionsReused: 0,
      sectionsRecompiled: sections.length,
      totalSections: sections.length
    }
  }
}

// =============================================================================
// Incremental Compile (Main Entry)
// =============================================================================

/**
 * Compile a clip incrementally, reusing cached results where possible.
 *
 * @param clip - ClipNode to compile
 * @param cache - Previous compilation cache (null for first compile)
 * @param options - Pipeline options
 * @returns Compilation result with updated cache
 */
export function incrementalCompile(
  clip: ClipNode,
  cache: CompilationCache | null,
  options: IncrementalPipelineOptions
): IncrementalCompileResult {
  // No cache = full compile
  if (!cache) {
    return fullCompile(clip, options)
  }

  // FAST PATH: Reference equality check (O(1))
  // If same clip object, return cached result immediately
  if (cache.lastClip === clip && cache.lastFullResult) {
    return {
      result: cache.lastFullResult,
      cache,
      stats: {
        fullCompile: false,
        sectionsReused: cache.sections.length,
        sectionsRecompiled: 0,
        totalSections: cache.sections.length
      }
    }
  }

  // OPTIMIZED PATH: Quick structure check + lazy section comparison
  
  // Quick structure check - if operation count differs, structure changed
  if (clip.operations.length !== cache.operationCount) {
    return fullCompile(clip, options)
  }

  // Lazy section comparison - reuses cached boundaries, hashes lazily with early bailout
  const { firstChanged, comparedSections } = findFirstChangedSectionLazy(clip, cache.sections)

  // No changes = return cached result
  if (firstChanged === -1 && cache.lastFullResult) {
    return {
      result: cache.lastFullResult,
      cache,
      stats: {
        fullCompile: false,
        sectionsReused: cache.sections.length,
        sectionsRecompiled: 0,
        totalSections: cache.sections.length
      }
    }
  }

  // First section changed = full recompile (nothing to reuse)
  if (firstChanged === 0) {
    return fullCompile(clip, options)
  }

  // Partial recompile: reuse cached sections before change point
  const entryState = getCachedEntryState(cache, firstChanged)
  const cachedEvents = getCachedEvents(cache, firstChanged)

  // Get start index for recompilation from cached section boundaries
  const startIndex = cache.sections[firstChanged]?.startIndex ?? 0

  // Compile from state
  const partial = compileFromState(
    clip,
    startIndex,
    entryState,
    cache.tempoMap,
    options
  )

  // Merge events
  const mergedEvents = [...cachedEvents, ...partial.events]

  // Convert cached sections to Section[] for update (structure is unchanged)
  const sectionsForUpdate: Section[] = cache.sections.map(s => ({
    startIndex: s.startIndex,
    endIndex: s.endIndex,
    hash: s.hash,
    startBeat: s.entryState.beat,
    endBeat: s.exitState.beat
  }))

  // Update beat positions for changed sections
  const beatPositions = new Map<number, number>()
  beatPositions.set(startIndex, entryState.beat)
  const sectionsWithBeats = updateSectionBeats(
    sectionsForUpdate,
    beatPositions,
    partial.exitState.beat
  )

  // Build result
  const result: CompiledClip = {
    events: mergedEvents,
    durationSeconds: Math.max(
      ...mergedEvents.map(e => e.startSeconds + ((e as any).durationSeconds ?? 0)),
      0
    ),
    durationBeats: partial.exitState.beat,
    tempoMap: cache.tempoMap,
    manifest: generateManifest(mergedEvents),
    metadata: {
      expandedOpCount: mergedEvents.length,
      maxDepth: 0,
      warnings: partial.warnings
    }
  }

  // Update cache
  const newCache = updateCache(
    cache,
    firstChanged,
    sectionsWithBeats,
    partial.events,
    partial.exitState
  )

  // Store full result and clip reference for O(1) identity check
  newCache.lastFullResult = result
  newCache.lastClip = clip

  return {
    result,
    cache: newCache,
    stats: {
      fullCompile: false,
      sectionsReused: firstChanged,
      sectionsRecompiled: cache.sections.length - firstChanged,
      totalSections: cache.sections.length
    }
  }
}
