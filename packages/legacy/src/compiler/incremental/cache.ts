/**
 * RFC-026.9: Cache Management
 *
 * Manages compilation cache for incremental recompilation.
 */

import type { ClipNode } from '../../clip/types'
import type { CompiledClip, CompiledEvent, TempoMap, TimedSequence } from '../pipeline/types'
import type {
  Section,
  ProjectionSnapshot,
  CompilationCache,
  CachedSection
} from './types'
import { hashClip } from './hash'
import { initialProjectionState } from './snapshot'

// =============================================================================
// Cache Creation
// =============================================================================

/**
 * Create an empty compilation cache for a clip.
 *
 * @param clipId - Unique identifier for the clip
 * @param operationCount - Number of operations in the clip
 * @returns Empty CompilationCache
 */
export function createCache(clipId: string, operationCount: number = 0): CompilationCache {
  return {
    clipId,
    sections: [],
    tempoMap: createEmptyTempoMap(),
    operationCount
  }
}

/**
 * Create an empty tempo map placeholder.
 * This will be replaced when the cache is built.
 */
function createEmptyTempoMap(): TempoMap {
  return {
    points: [{ beatPosition: 0, bpm: 120 }],
    getBpmAt: () => 120,
    beatToSeconds: (beat: number) => beat * 0.5, // 120 BPM = 0.5s per beat
    durationToSeconds: (startBeat: number, beats: number) => beats * 0.5
  }
}

// =============================================================================
// Cache Building
// =============================================================================

/**
 * Options for building cache.
 */
export interface BuildCacheOptions {
  /** Initial BPM (default: 120) */
  bpm?: number
  /** Initial time signature (default: '4/4') */
  timeSignature?: `${number}/${number}`
}

/**
 * Build a complete cache from a full compilation result.
 * Called after initial full compilation to populate cache.
 *
 * @param clip - Original ClipNode
 * @param sections - Detected sections with hashes
 * @param result - Full compilation result
 * @param timedSequence - Timed sequence from compilation
 * @param options - Build options
 * @returns Populated CompilationCache
 */
export function buildCache(
  clip: ClipNode,
  sections: Section[],
  result: CompiledClip,
  timedSequence: TimedSequence,
  options: BuildCacheOptions = {}
): CompilationCache {
  const clipId = hashClip(clip)

  // Build per-section events and state snapshots
  const cachedSections = buildCachedSections(
    sections,
    result.events,
    timedSequence,
    options
  )

  return {
    clipId,
    sections: cachedSections,
    tempoMap: result.tempoMap,
    lastFullResult: result,
    operationCount: clip.operations.length
  }
}

/**
 * Build cached sections from compilation results.
 */
function buildCachedSections(
  sections: Section[],
  events: CompiledEvent[],
  timedSequence: TimedSequence,
  options: BuildCacheOptions
): CachedSection[] {
  const cachedSections: CachedSection[] = []
  const ops = timedSequence.operations

  // Map beat positions to timed operations for snapshot capture
  const beatToOpIndex = new Map<number, number>()
  for (let i = 0; i < ops.length; i++) {
    const beat = ops[i].beatStart
    if (!beatToOpIndex.has(beat)) {
      beatToOpIndex.set(beat, i)
    }
  }

  // Create initial state
  let entryState = initialProjectionState({
    bpm: options.bpm ?? 120,
    timeSignature: options.timeSignature ?? '4/4'
  })

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]

    // Find events that belong to this section (by beat range)
    const sectionEvents = events.filter(event => {
      if (!('startSeconds' in event)) return false
      // Use source op's beat position if available
      const source = (event as any).source
      if (source && 'beatStart' in source) {
        const beat = source.beatStart
        return beat >= section.startBeat && beat < section.endBeat
      }
      // Fallback: use time-based filtering (approximate)
      return true // Include all events for now, will be refined
    })

    // Calculate exit state for this section
    const exitState = calculateExitState(
      entryState,
      section,
      ops,
      options
    )

    cachedSections.push({
      hash: section.hash,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      entryState,
      exitState,
      events: sectionEvents
    })

    // Next section's entry state is this section's exit state
    entryState = exitState
  }

  return cachedSections
}

/**
 * Calculate the exit state for a section based on its operations.
 */
function calculateExitState(
  entryState: ProjectionSnapshot,
  section: Section,
  ops: readonly any[],
  options: BuildCacheOptions
): ProjectionSnapshot {
  // Find the last operation in this section's beat range
  let lastBeat = section.startBeat
  let lastMeasure = entryState.measure
  let lastBeatInMeasure = entryState.beatInMeasure

  for (const op of ops) {
    if (op.beatStart >= section.startBeat && op.beatStart < section.endBeat) {
      if (op.beatStart + (op.beatDuration ?? 0) > lastBeat) {
        lastBeat = op.beatStart + (op.beatDuration ?? 0)
        lastMeasure = op.measure ?? lastMeasure
        lastBeatInMeasure = op.beatInMeasure ?? lastBeatInMeasure
      }
    }
  }

  // Ensure we use section.endBeat if it's greater
  if (section.endBeat > lastBeat) {
    lastBeat = section.endBeat
  }

  return {
    ...entryState,
    beat: lastBeat,
    measure: lastMeasure,
    beatInMeasure: lastBeatInMeasure,
    // Active ties would be updated by coalesce phase tracking
    // For now, assume no ties cross sections (simplified)
    activeTies: [],
    lastInputOrder: 0
  }
}

// =============================================================================
// Cache Updates
// =============================================================================

/**
 * Update cache after partial recompilation.
 *
 * @param cache - Existing cache
 * @param firstChanged - Index of first recompiled section
 * @param newSections - New section definitions (all sections)
 * @param newEvents - Events for recompiled sections
 * @param newExitState - Exit state after recompilation
 * @returns Updated cache
 */
export function updateCache(
  cache: CompilationCache,
  firstChanged: number,
  newSections: Section[],
  newEvents: CompiledEvent[],
  newExitState: ProjectionSnapshot
): CompilationCache {
  // Keep cached sections before the change point
  const keptSections = cache.sections.slice(0, firstChanged)

  // Build new cached sections for changed region
  const entryState = firstChanged > 0
    ? cache.sections[firstChanged - 1].exitState
    : initialProjectionState()

  // Create new cached sections
  const newCachedSections: CachedSection[] = []
  let currentState = entryState
  let eventOffset = 0

  for (let i = firstChanged; i < newSections.length; i++) {
    const section = newSections[i]

    // Estimate events for this section (simplified)
    // In production, we'd track events per section more precisely
    const sectionEvents = newEvents.slice(eventOffset)

    const exitState = i === newSections.length - 1
      ? newExitState
      : {
          ...currentState,
          beat: section.endBeat,
          measure: currentState.measure,
          beatInMeasure: currentState.beatInMeasure,
          activeTies: [],
          lastInputOrder: 0
        }

    newCachedSections.push({
      hash: section.hash,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      entryState: currentState,
      exitState,
      events: sectionEvents
    })

    currentState = exitState
  }

  return {
    ...cache,
    sections: [...keptSections, ...newCachedSections],
    operationCount: cache.operationCount // Preserve operation count (unchanged in partial recompile)
  }
}

// =============================================================================
// Cache Queries
// =============================================================================

/**
 * Get cached events for sections that can be reused.
 *
 * @param cache - Compilation cache
 * @param upToSection - Index of first section that needs recompilation
 * @returns Array of cached events
 */
export function getCachedEvents(
  cache: CompilationCache,
  upToSection: number
): CompiledEvent[] {
  const events: CompiledEvent[] = []

  for (let i = 0; i < upToSection && i < cache.sections.length; i++) {
    events.push(...cache.sections[i].events)
  }

  return events
}

/**
 * Get the entry state for a section from cache.
 *
 * @param cache - Compilation cache
 * @param sectionIndex - Section index
 * @returns Entry state, or initial state if not cached
 */
export function getCachedEntryState(
  cache: CompilationCache,
  sectionIndex: number
): ProjectionSnapshot {
  if (sectionIndex === 0) {
    return initialProjectionState()
  }

  const prevSection = cache.sections[sectionIndex - 1]
  if (prevSection) {
    return prevSection.exitState
  }

  return initialProjectionState()
}

/**
 * Check if cache is valid for a clip.
 *
 * @param cache - Compilation cache
 * @param clip - ClipNode to check
 * @returns True if cache can be used
 */
export function isCacheValid(
  cache: CompilationCache | null | undefined,
  clip: ClipNode
): boolean {
  if (!cache) {
    return false
  }

  const clipId = hashClip(clip)
  return cache.clipId === clipId
}
