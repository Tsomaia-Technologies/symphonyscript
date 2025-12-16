import { CHORD_DEFINITIONS } from './definitions'
import type { ChordDefinition, ChordRoot, ChordQuality } from './types'

export interface ParsedChord {
  root: ChordRoot
  quality: ChordQuality
  intervals: number[]
  definition: ChordDefinition
}

// Build O(1) lookup map from suffix -> definition
const CHORD_MAP: Record<string, ChordDefinition> = {}

CHORD_DEFINITIONS.forEach(def => {
  // Map primary code
  CHORD_MAP[def.primaryCode] = def
  // Map alt codes
  def.altCodes.forEach(alt => {
    CHORD_MAP[alt] = def
  })
})

const ROOT_REGEX = /^([A-G][#b]?)(.*)$/

/**
 * Parse a chord code into its components.
 * Example: 'Cmaj7' -> { root: 'C', quality: 'maj7', ... }
 */
export function parseChordCode(code: string): ParsedChord {
  const match = code.match(ROOT_REGEX)
  if (!match) {
    throw new Error(`Invalid chord code format: "${code}"`)
  }

  const rootStr = match[1]
  const suffix = match[2]

  // Validate root
  if (!isChordRoot(rootStr)) {
    throw new Error(`Invalid chord root: "${rootStr}"`)
  }

  // Lookup quality
  const def = CHORD_MAP[suffix]
  if (!def) {
    // If suffix is empty, it means just Root was provided.
    // In CHORD_MAP, we registered primaryCode: '' for Major Triad.
    // So CHORD_MAP[''] should be Major Triad.
    throw new Error(`Unknown chord quality: "${suffix}"`)
  }

  return {
    root: rootStr,
    quality: def.quality,
    intervals: def.intervals,
    definition: def
  }
}

// Type guard for ChordRoot
function isChordRoot(root: string): root is ChordRoot {
  const validRoots = new Set([
     'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 
     'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'
  ])
  return validRoots.has(root)
}
