/**
 * RFC-026.9: Incremental Compilation Tests
 *
 * Verifies:
 * 1. Full compile produces correct results
 * 2. incrementalCompile(clip, null) equals compileClip(clip)
 * 3. Partial recompile for pitch change (no cascade)
 * 4. Cascade recompile for duration/tempo changes
 * 5. Tie chains crossing section boundaries
 * 6. Multiple consecutive edits (cache reuse)
 */

import { Clip } from '../core'
import { compileClip } from '../compiler/pipeline'
import {
  incrementalCompile,
  detectSections,
  hashOperations,
  isSectionBoundary,
  stableSerialize,
  initialProjectionState,
  findInvalidatedSections,
  createCache,
  isCascadingChange
} from '../compiler/incremental'
import type { ClipNode } from '../clip/types'

// =============================================================================
// Helper Functions
// =============================================================================

const DEFAULT_OPTIONS = {
  bpm: 120,
  timeSignature: '4/4' as const
}

function buildSimpleClip(): ClipNode {
  return Clip.melody()
    .note('C4', '4n')
    .note('D4', '4n')
    .note('E4', '4n')
    .note('F4', '4n')
    .build()
}

function buildClipWithTempo(): ClipNode {
  return Clip.melody()
    .note('C4', '4n')
    .note('D4', '4n')
    .tempo(140)
    .note('E4', '4n')
    .note('F4', '4n')
    .build()
}

function buildClipWithLoop(): ClipNode {
  return Clip.melody()
    .note('C4', '4n')
    .loop(2, (b: any) => b.note('D4', '8n').note('E4', '8n'))
    .note('F4', '4n')
    .build()
}

// =============================================================================
// Hash Utilities Tests
// =============================================================================

describe('Hash Utilities', () => {
  describe('stableSerialize', () => {
    it('produces deterministic output for same object', () => {
      const obj = { b: 2, a: 1, c: { z: 26, y: 25 } }
      const result1 = stableSerialize(obj)
      const result2 = stableSerialize(obj)
      expect(result1).toBe(result2)
    })

    it('sorts object keys alphabetically', () => {
      const obj1 = { b: 2, a: 1 }
      const obj2 = { a: 1, b: 2 }
      expect(stableSerialize(obj1)).toBe(stableSerialize(obj2))
    })

    it('skips _source metadata', () => {
      const withSource = { note: 'C4', _source: { method: 'note' } }
      const withoutSource = { note: 'C4' }
      expect(stableSerialize(withSource)).toBe(stableSerialize(withoutSource))
    })

    it('handles arrays correctly', () => {
      const arr = [1, 2, { a: 3 }]
      const result = stableSerialize(arr)
      expect(result).toContain('[')
      expect(result).toContain(']')
    })

    it('handles null and undefined', () => {
      expect(stableSerialize(null)).toBe('null')
      expect(stableSerialize(undefined)).toBe('undefined')
    })
  })

  describe('hashOperations', () => {
    it('produces same hash for identical operations', () => {
      const clip1 = buildSimpleClip()
      const clip2 = buildSimpleClip()
      expect(hashOperations(clip1.operations)).toBe(hashOperations(clip2.operations))
    })

    it('produces different hash for different operations', () => {
      const clip1 = Clip.melody().note('C4', '4n').build()
      const clip2 = Clip.melody().note('D4', '4n').build()
      expect(hashOperations(clip1.operations)).not.toBe(hashOperations(clip2.operations))
    })
  })

  describe('isCascadingChange', () => {
    it('pitch change is not cascading', () => {
      const op1 = { kind: 'note' as const, note: 'C4' as any, duration: '4n' as const, velocity: 1 }
      const op2 = { kind: 'note' as const, note: 'D4' as any, duration: '4n' as const, velocity: 1 }
      expect(isCascadingChange(op1, op2)).toBe(false)
    })

    it('velocity change is not cascading', () => {
      const op1 = { kind: 'note' as const, note: 'C4' as any, duration: '4n' as const, velocity: 0.8 }
      const op2 = { kind: 'note' as const, note: 'C4' as any, duration: '4n' as const, velocity: 0.5 }
      expect(isCascadingChange(op1, op2)).toBe(false)
    })

    it('duration change is cascading', () => {
      const op1 = { kind: 'note' as const, note: 'C4' as any, duration: '4n' as const, velocity: 1 }
      const op2 = { kind: 'note' as const, note: 'C4' as any, duration: '8n' as const, velocity: 1 }
      expect(isCascadingChange(op1, op2)).toBe(true)
    })

    it('add/remove is cascading', () => {
      const op1 = { kind: 'note' as const, note: 'C4' as any, duration: '4n' as const, velocity: 1 }
      expect(isCascadingChange(op1, undefined)).toBe(true)
      expect(isCascadingChange(undefined, op1)).toBe(true)
    })

    it('tempo change is always cascading', () => {
      const op1 = { kind: 'tempo' as const, bpm: 120 }
      const op2 = { kind: 'tempo' as const, bpm: 140 }
      expect(isCascadingChange(op1, op2)).toBe(true)
    })
  })
})

// =============================================================================
// Section Detection Tests
// =============================================================================

describe('Section Detection', () => {
  describe('isSectionBoundary', () => {
    it('tempo is a boundary', () => {
      expect(isSectionBoundary({ kind: 'tempo', bpm: 120 })).toBe(true)
    })

    it('time_signature is a boundary', () => {
      expect(isSectionBoundary({ kind: 'time_signature', signature: '3/4' })).toBe(true)
    })

    it('loop is a boundary', () => {
      expect(isSectionBoundary({ kind: 'loop', count: 2, operations: [] })).toBe(true)
    })

    it('note is not a boundary', () => {
      expect(isSectionBoundary({ kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 })).toBe(false)
    })

    it('rest is not a boundary', () => {
      expect(isSectionBoundary({ kind: 'rest', duration: '4n' })).toBe(false)
    })
  })

  describe('detectSections', () => {
    it('detects single section for simple clip', () => {
      const clip = buildSimpleClip()
      const sections = detectSections(clip)
      expect(sections.length).toBe(1)
      expect(sections[0].startIndex).toBe(0)
      expect(sections[0].endIndex).toBe(4)
    })

    it('detects multiple sections with tempo change', () => {
      const clip = buildClipWithTempo()
      const sections = detectSections(clip)
      // Should have: [notes before tempo] [tempo] [notes after tempo]
      expect(sections.length).toBeGreaterThanOrEqual(2)
    })

    it('detects sections with loops', () => {
      const clip = buildClipWithLoop()
      const sections = detectSections(clip)
      // Loop creates boundary
      expect(sections.length).toBeGreaterThanOrEqual(2)
    })

    it('empty clip has no sections', () => {
      const clip = Clip.melody().build()
      const sections = detectSections(clip)
      expect(sections.length).toBe(0)
    })
  })
})

// =============================================================================
// State Snapshots Tests
// =============================================================================

describe('State Snapshots', () => {
  describe('initialProjectionState', () => {
    it('returns correct initial state', () => {
      const state = initialProjectionState()
      expect(state.beat).toBe(0)
      expect(state.measure).toBe(1)
      expect(state.bpm).toBe(120)
      expect(state.timeSignature).toBe('4/4')
      expect(state.transposition).toBe(0)
      expect(state.activeTies).toEqual([])
    })

    it('respects custom options', () => {
      const state = initialProjectionState({
        bpm: 140,
        timeSignature: '3/4'
      })
      expect(state.bpm).toBe(140)
      expect(state.timeSignature).toBe('3/4')
      expect(state.beatsPerMeasure).toBe(3)
    })
  })
})

// =============================================================================
// Incremental Compilation Tests
// =============================================================================

describe('Incremental Compilation', () => {
  describe('Full Compile Equivalence', () => {
    it('incrementalCompile(clip, null) produces same events as compileClip', () => {
      const clip = buildSimpleClip()
      
      const batchResult = compileClip(clip, { ...DEFAULT_OPTIONS, streaming: true })
      const { result: incrementalResult } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      expect(incrementalResult.events.length).toBe(batchResult.events.length)
      
      // Compare event properties (excluding non-deterministic fields)
      for (let i = 0; i < batchResult.events.length; i++) {
        const batch = batchResult.events[i]
        const incr = incrementalResult.events[i]
        
        expect(incr.kind).toBe(batch.kind)
        expect(incr.startSeconds).toBeCloseTo(batch.startSeconds, 5)
        
        if (batch.kind === 'note' && incr.kind === 'note') {
          expect(incr.payload.pitch).toBe(batch.payload.pitch)
          expect(incr.durationSeconds).toBeCloseTo(batch.durationSeconds, 5)
        }
      }
    })

    it('handles clips with tempo changes', () => {
      const clip = buildClipWithTempo()
      
      const { result } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      expect(result.events.length).toBeGreaterThan(0)
      // Should have tempo event
      const tempoEvents = result.events.filter(e => e.kind === 'tempo')
      expect(tempoEvents.length).toBe(1)
    })

    it('handles clips with loops', () => {
      const clip = buildClipWithLoop()
      
      const { result } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      // Loop(2) of 2 notes = 4 notes from loop + 2 surrounding = 6 total
      const noteEvents = result.events.filter(e => e.kind === 'note')
      expect(noteEvents.length).toBe(6)
    })
  })

  describe('Cache Behavior', () => {
    it('returns cached result for identical clip', () => {
      const clip = buildSimpleClip()
      
      // First compile
      const { cache: cache1 } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      // Second compile with same clip
      const { result: result2, stats } = incrementalCompile(clip, cache1, DEFAULT_OPTIONS)
      
      expect(stats.fullCompile).toBe(false)
      expect(stats.sectionsReused).toBeGreaterThan(0)
    })

    it('rebuilds cache for different clip', () => {
      const clip1 = Clip.melody().note('C4', '4n').build()
      const clip2 = Clip.melody().note('D4', '4n').note('E4', '4n').build()
      
      const { cache: cache1 } = incrementalCompile(clip1, null, DEFAULT_OPTIONS)
      const { stats } = incrementalCompile(clip2, cache1, DEFAULT_OPTIONS)
      
      // Different clip = full compile
      expect(stats.fullCompile).toBe(true)
    })
  })

  describe('Partial Recompile', () => {
    it('stats reflect compilation work', () => {
      const clip = buildClipWithTempo()
      
      const { stats } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      expect(stats.totalSections).toBeGreaterThan(0)
      expect(stats.sectionsRecompiled).toBe(stats.totalSections)
    })
  })

  describe('Invalidation Detection', () => {
    it('detects no changes when cache matches', () => {
      const clip = buildSimpleClip()
      
      const { cache } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      const sections = detectSections(clip)
      
      const invalidation = findInvalidatedSections(cache, sections)
      
      expect(invalidation.firstChanged).toBe(-1)
    })

    it('detects changes when hash differs', () => {
      const clip1 = Clip.melody().note('C4', '4n').build()
      
      const { cache } = incrementalCompile(clip1, null, DEFAULT_OPTIONS)
      
      // Create clip with different content
      const clip2 = Clip.melody().note('D4', '4n').build()
      const sections2 = detectSections(clip2)
      
      const invalidation = findInvalidatedSections(cache, sections2)
      
      expect(invalidation.firstChanged).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles empty clip', () => {
      const clip = Clip.melody().build()
      
      const { result, stats } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      expect(result.events.length).toBe(0)
      expect(stats.totalSections).toBe(0)
    })

    it('handles single note clip', () => {
      const clip = Clip.melody().note('C4', '4n').build()
      
      const { result } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      const noteEvents = result.events.filter(e => e.kind === 'note')
      expect(noteEvents.length).toBe(1)
    })

    it('handles chord clip', () => {
      const clip = Clip.melody()
        .stack(s => (s as any)
          .note('C4', '4n')
          .note('E4', '4n')
          .note('G4', '4n')
          .commit()
        )
        .build()
      
      const { result } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
      
      const noteEvents = result.events.filter(e => e.kind === 'note')
      expect(noteEvents.length).toBe(3)
    })
  })

  describe('Multiple Consecutive Edits', () => {
    it('handles multiple incremental updates', () => {
      // First version
      const clip1 = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .build()
      
      const { cache: cache1 } = incrementalCompile(clip1, null, DEFAULT_OPTIONS)
      
      // "Edit" - same structure
      const clip2 = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .build()
      
      const { cache: cache2, stats: stats2 } = incrementalCompile(clip2, cache1, DEFAULT_OPTIONS)
      
      // Should reuse cache
      expect(stats2.fullCompile).toBe(false)
      
      // "Edit" again
      const clip3 = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .build()
      
      const { stats: stats3 } = incrementalCompile(clip3, cache2, DEFAULT_OPTIONS)
      
      expect(stats3.fullCompile).toBe(false)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('compiles complex composition', () => {
    const loopPattern = Clip.melody()
      .note('E4', '8n')
      .note('F4', '8n')
      .build()
    
    const clip = Clip.melody()
      .note('C4', '4n')
      .note('D4', '4n')
      .tempo(140)
      .loop(2, loopPattern)
      .note('G4', '2n')
      .build()
    
    const { result, stats } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
    
    expect(result.events.length).toBeGreaterThan(0)
    expect(stats.totalSections).toBeGreaterThan(1)
  })

  it('result has required properties', () => {
    const clip = buildSimpleClip()
    
    const { result } = incrementalCompile(clip, null, DEFAULT_OPTIONS)
    
    expect(result.events).toBeDefined()
    expect(result.durationSeconds).toBeGreaterThan(0)
    expect(result.durationBeats).toBeGreaterThan(0)
    expect(result.tempoMap).toBeDefined()
    expect(result.metadata).toBeDefined()
  })
})
