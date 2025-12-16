/**
 * RFC-026.9: Section Detection
 *
 * Identifies cacheable boundaries in ClipNode operations.
 * Sections are bounded by structural operations that affect global state.
 */

import type { ClipNode, ClipOperation } from '../../clip/types'
import type { Section, CachedSection } from './types'
import { hashOperations } from './hash'

// =============================================================================
// Boundary Detection
// =============================================================================

/**
 * Operations that create section boundaries.
 *
 * These operations affect global state and require fresh projection context:
 * - tempo: BPM affects all subsequent time calculations
 * - time_signature: Measure calculations change
 * - loop: Expansion affects beat timing
 * - stack: Branch timing is complex
 * - scope: State isolation
 */
const BOUNDARY_KINDS = new Set([
  'tempo',
  'time_signature',
  'loop',
  'stack',
  'scope'
])

/**
 * Check if an operation creates a section boundary.
 *
 * @param op - ClipOperation to check
 * @returns True if this operation starts a new section
 */
export function isSectionBoundary(op: ClipOperation): boolean {
  return BOUNDARY_KINDS.has(op.kind)
}

// =============================================================================
// Section Detection
// =============================================================================

/**
 * Detect section boundaries in a clip.
 *
 * Sections are contiguous ranges of operations that can be cached together.
 * A new section starts:
 * - At the beginning of the clip
 * - After any boundary operation (tempo, timesig, loop, stack, scope)
 *
 * Note: Beat positions are set to 0 initially and should be updated
 * after the timing phase.
 *
 * @param clip - ClipNode to analyze
 * @returns Array of sections
 */
export function detectSections(clip: ClipNode): Section[] {
  const operations = clip.operations
  const sections: Section[] = []

  if (operations.length === 0) {
    return sections
  }

  let sectionStart = 0

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]

    // Check if this operation is a boundary
    if (isSectionBoundary(op)) {
      // If there are leaf operations before this boundary, create a section
      if (i > sectionStart) {
        const sectionOps = operations.slice(sectionStart, i)
        sections.push({
          startIndex: sectionStart,
          endIndex: i,
          hash: hashOperations(sectionOps),
          startBeat: 0, // Will be set after timing phase
          endBeat: 0    // Will be set after timing phase
        })
      }

      // The boundary operation itself is a single-operation section
      sections.push({
        startIndex: i,
        endIndex: i + 1,
        hash: hashOperations([op]),
        startBeat: 0,
        endBeat: 0
      })

      sectionStart = i + 1
    }
  }

  // Create final section for remaining operations
  if (sectionStart < operations.length) {
    const sectionOps = operations.slice(sectionStart)
    sections.push({
      startIndex: sectionStart,
      endIndex: operations.length,
      hash: hashOperations(sectionOps),
      startBeat: 0,
      endBeat: 0
    })
  }

  return sections
}

/**
 * Update section beat positions after timing phase.
 * This should be called after compiling to get accurate beat ranges.
 *
 * @param sections - Sections with indices
 * @param beatPositions - Map of operation index to beat position
 * @param totalBeats - Total beats in the clip
 * @returns Sections with updated beat positions
 */
export function updateSectionBeats(
  sections: Section[],
  beatPositions: Map<number, number>,
  totalBeats: number
): Section[] {
  return sections.map((section, index) => {
    const startBeat = beatPositions.get(section.startIndex) ?? 0
    const nextSection = sections[index + 1]
    const endBeat = nextSection
      ? (beatPositions.get(nextSection.startIndex) ?? totalBeats)
      : totalBeats

    return {
      ...section,
      startBeat,
      endBeat
    }
  })
}

// =============================================================================
// Section Comparison
// =============================================================================

/**
 * Find the first section that differs between old and new section arrays.
 *
 * @param oldSections - Previous sections
 * @param newSections - Current sections
 * @returns Index of first changed section, or -1 if identical
 */
export function findFirstChangedSection(
  oldSections: Section[],
  newSections: Section[]
): number {
  const minLength = Math.min(oldSections.length, newSections.length)

  // Check each section for hash differences
  for (let i = 0; i < minLength; i++) {
    if (oldSections[i].hash !== newSections[i].hash) {
      return i
    }
    // Also check if boundaries shifted
    if (oldSections[i].startIndex !== newSections[i].startIndex ||
        oldSections[i].endIndex !== newSections[i].endIndex) {
      return i
    }
  }

  // If section counts differ, return the first "new" section
  if (oldSections.length !== newSections.length) {
    return minLength
  }

  // No changes
  return -1
}

/**
 * Get operations for a specific section from a clip.
 *
 * @param clip - ClipNode
 * @param section - Section to extract
 * @returns Array of operations in that section
 */
export function getSectionOperations(
  clip: ClipNode,
  section: Section
): ClipOperation[] {
  return clip.operations.slice(section.startIndex, section.endIndex)
}

// =============================================================================
// Lazy Section Comparison (Optimized)
// =============================================================================

/**
 * Result of lazy section comparison.
 */
export interface LazyComparisonResult {
  /** Index of first changed section (-1 if no changes) */
  firstChanged: number
  /** Sections that were compared (includes hashes) */
  comparedSections: Section[]
}

/**
 * Find first changed section using cached boundaries with early bailout.
 * 
 * This is an optimized version of detectSections + findFirstChangedSection that:
 * 1. Reuses cached section boundaries (no boundary detection iteration)
 * 2. Hashes sections lazily (one at a time)
 * 3. Bails out early on first difference (no need to hash remaining sections)
 * 
 * @param clip - New clip to compare
 * @param cachedSections - Previously cached sections with boundaries
 * @returns First changed section index and compared sections
 */
export function findFirstChangedSectionLazy(
  clip: ClipNode,
  cachedSections: CachedSection[]
): LazyComparisonResult {
  const comparedSections: Section[] = []
  
  for (let i = 0; i < cachedSections.length; i++) {
    const cached = cachedSections[i]
    
    // Validate bounds (structure change detection)
    if (cached.endIndex > clip.operations.length) {
      // Cached section extends beyond new clip - structure changed
      return { firstChanged: i, comparedSections }
    }
    
    // Hash only this section (lazy - not all upfront)
    const ops = clip.operations.slice(cached.startIndex, cached.endIndex)
    const hash = hashOperations(ops)
    
    comparedSections.push({
      startIndex: cached.startIndex,
      endIndex: cached.endIndex,
      hash,
      startBeat: cached.entryState.beat,
      endBeat: cached.exitState.beat
    })
    
    // Early bailout on first difference
    if (hash !== cached.hash) {
      return { firstChanged: i, comparedSections }
    }
  }
  
  // All sections match
  return { firstChanged: -1, comparedSections }
}
