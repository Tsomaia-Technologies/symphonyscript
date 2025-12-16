/**
 * RFC-026.5: Streaming Coalesce Tests
 * 
 * Verifies:
 * 1. Output equivalence between batch and streaming coalesce
 * 2. Beat order invariant (output[i].beatStart <= output[i+1].beatStart)
 * 3. Stable ordering for same-beat operations
 * 4. Warning parity between batch and streaming
 * 5. Tied note spanning marker scenario
 */

import { Clip } from '@symphonyscript/core'
import { MinHeap } from '@symphonyscript/core/util/heap'
import {
  coalesceStream,
  streamingCoalesceToResult,
  streamingCoalesceWithWarnings,
  createWarningCollector,
  expandClip,
  computeTiming,
  compileClip,
  type TimedPipelineOp
} from '@symphonyscript/core'

// =============================================================================
// MinHeap Unit Tests
// =============================================================================

describe('MinHeap', () => {
  it('maintains min-heap property with numbers', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    
    heap.push(5)
    heap.push(3)
    heap.push(7)
    heap.push(1)
    heap.push(4)
    
    expect(heap.pop()).toBe(1)
    expect(heap.pop()).toBe(3)
    expect(heap.pop()).toBe(4)
    expect(heap.pop()).toBe(5)
    expect(heap.pop()).toBe(7)
    expect(heap.pop()).toBeUndefined()
  })

  it('handles single element', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    
    heap.push(42)
    expect(heap.peek()).toBe(42)
    expect(heap.pop()).toBe(42)
    expect(heap.isEmpty()).toBe(true)
  })

  it('handles empty heap', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    
    expect(heap.isEmpty()).toBe(true)
    expect(heap.peek()).toBeUndefined()
    expect(heap.pop()).toBeUndefined()
    expect(heap.size()).toBe(0)
  })

  it('supports custom comparator for objects', () => {
    interface Item { beatStart: number; sequenceId: number }
    
    const heap = new MinHeap<Item>((a, b) => {
      const beatDiff = a.beatStart - b.beatStart
      if (beatDiff !== 0) return beatDiff
      return a.sequenceId - b.sequenceId
    })
    
    heap.push({ beatStart: 1.0, sequenceId: 2 })
    heap.push({ beatStart: 0.5, sequenceId: 1 })
    heap.push({ beatStart: 1.0, sequenceId: 1 })  // Same beat, earlier seq
    heap.push({ beatStart: 0.0, sequenceId: 0 })
    
    expect(heap.pop()).toEqual({ beatStart: 0.0, sequenceId: 0 })
    expect(heap.pop()).toEqual({ beatStart: 0.5, sequenceId: 1 })
    expect(heap.pop()).toEqual({ beatStart: 1.0, sequenceId: 1 })  // Earlier seq
    expect(heap.pop()).toEqual({ beatStart: 1.0, sequenceId: 2 })
  })

  it('reports correct size', () => {
    const heap = new MinHeap<number>((a, b) => a - b)
    
    expect(heap.size()).toBe(0)
    heap.push(1)
    expect(heap.size()).toBe(1)
    heap.push(2)
    expect(heap.size()).toBe(2)
    heap.pop()
    expect(heap.size()).toBe(1)
  })
})

// =============================================================================
// Streaming Coalesce Tests
// =============================================================================

describe('Streaming Coalesce', () => {
  // Helper to run pipeline up to coalesce
  function prepareSequence(clip: any) {
    const expanded = expandClip(clip)
    return computeTiming(expanded, '4/4')
  }

  describe('output equivalence', () => {
    it('produces identical output to batch coalesce for simple notes', () => {
      const clip = Clip.melody('Simple')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      // Compare operations
      expect(streamResult.sequence.operations).toEqual(batchResult.sequence.operations)
      expect(streamResult.warnings).toEqual(batchResult.warnings)
    })

    it('produces identical output for tied notes', () => {
      const clip = Clip.melody('Tied')
        .note('C4', '2n').tie('start')
        .note('C4', '2n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.sequence.operations).toEqual(batchResult.sequence.operations)
      
      // Verify the merged note has correct duration
      const notes = streamResult.sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )
      expect(notes).toHaveLength(1)
      expect((notes[0] as any).beatDuration).toBe(4)
    })

    it('produces identical output for complex ties with continue', () => {
      const clip = Clip.melody('LongTie')
        .note('C4', '4n').tie('start')
        .note('C4', '4n').tie('continue')
        .note('C4', '4n').tie('continue')
        .note('C4', '4n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.sequence.operations).toEqual(batchResult.sequence.operations)
    })

    it('produces identical output for polyphonic ties', () => {
      const clip = Clip.melody('PolyTies')
        .stack(b => b
          .note('C4', '2n').tie('start')
          .note('E4', '2n').tie('start')
          .commit() as any
        )
        .stack(b => b
          .note('C4', '2n').tie('end')
          .note('E4', '2n').tie('end')
          .commit() as any
        )
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.sequence.operations).toEqual(batchResult.sequence.operations)
    })
  })

  describe('beat order invariant', () => {
    it('maintains beat order for simple sequence', () => {
      const clip = Clip.melody('Order')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .note('F4', '4n')
        .build()

      const timed = prepareSequence(clip)
      const result = streamingCoalesceToResult(timed)

      for (let i = 1; i < result.sequence.operations.length; i++) {
        const prev = result.sequence.operations[i - 1]
        const curr = result.sequence.operations[i]
        expect(curr.beatStart).toBeGreaterThanOrEqual(prev.beatStart)
      }
    })

    it('maintains beat order with tied notes', () => {
      const clip = Clip.melody('TieOrder')
        .note('C4', '2n').tie('start')
        .note('D4', '4n')  // This note appears between tie start and end
        .note('C4', '2n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      const result = streamingCoalesceToResult(timed)

      for (let i = 1; i < result.sequence.operations.length; i++) {
        const prev = result.sequence.operations[i - 1]
        const curr = result.sequence.operations[i]
        expect(curr.beatStart).toBeGreaterThanOrEqual(prev.beatStart)
      }
    })
  })

  describe('warning parity', () => {
    it('produces same warnings for orphaned tie start', () => {
      const clip = Clip.melody('OrphanStart')
        .note('C4', '2n').tie('start')
        .note('D4', '2n')  // Different pitch, no end for C4
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.warnings).toHaveLength(batchResult.warnings.length)
      expect(streamResult.warnings[0].type).toBe(batchResult.warnings[0].type)
      expect(streamResult.warnings[0].pitch).toBe(batchResult.warnings[0].pitch)
    })

    it('produces same warnings for orphaned tie end', () => {
      const clip = Clip.melody('OrphanEnd')
        .note('C4', '2n')  // No start
        .note('C4', '2n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.warnings).toHaveLength(batchResult.warnings.length)
      expect(streamResult.warnings[0].type).toBe(batchResult.warnings[0].type)
    })
  })

  describe('marker ordering', () => {
    it('handles stacked notes with markers', () => {
      // Stack operations create markers (stack_start, branch_start, etc.)
      // This tests that markers are properly ordered with notes
      const clip = Clip.melody('StackMarker')
        .stack(b => b
          .note('C4', '4n').tie('start')
          .note('E4', '4n')
          .commit() as any
        )
        .note('C4', '4n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      
      const batchResult = coalesceStream(timed)
      const streamResult = streamingCoalesceToResult(timed)

      expect(streamResult.sequence.operations).toEqual(batchResult.sequence.operations)
    })

    it('maintains beat order for all operations including markers', () => {
      // Verify all operations (notes and markers) are in beat order
      const clip = Clip.melody('BeatOrder')
        .stack(b => b
          .note('C4', '4n')
          .note('E4', '4n')
          .commit() as any
        )
        .note('G4', '4n')
        .build()

      const timed = prepareSequence(clip)
      const result = streamingCoalesceToResult(timed)

      // Verify beat ordering is maintained for ALL operations (including markers)
      for (let i = 1; i < result.sequence.operations.length; i++) {
        const prev = result.sequence.operations[i - 1]
        const curr = result.sequence.operations[i]
        expect(curr.beatStart).toBeGreaterThanOrEqual(prev.beatStart)
      }
    })
  })

  describe('streaming mode integration', () => {
    it('compileClip with streaming: true produces same output as batch', () => {
      const clip = Clip.melody('Integration')
        .note('C4', '4n')
        .note('D4', '2n').tie('start')
        .note('E4', '4n')
        .note('D4', '2n').tie('end')
        .build()

      const batchResult = compileClip(clip, { bpm: 120, streaming: false })
      const streamResult = compileClip(clip, { bpm: 120, streaming: true })

      // Events should be identical
      expect(streamResult.events).toEqual(batchResult.events)
      expect(streamResult.durationBeats).toBe(batchResult.durationBeats)
    })

    it('streaming mode handles complex compositions', () => {
      const clip = Clip.melody('Complex')
        .tempo(120)
        .loop(2, l => l
          .note('C4', '8n')
          .note('D4', '8n')
          .note('E4', '8n')
          .note('F4', '8n')
        )
        .note('G4', '2n').tie('start')
        .note('A4', '4n')
        .note('G4', '2n').tie('end')
        .build()

      const batchResult = compileClip(clip, { bpm: 120, streaming: false })
      const streamResult = compileClip(clip, { bpm: 120, streaming: true })

      expect(streamResult.events).toEqual(batchResult.events)
    })
  })
})

// =============================================================================
// Warning Collector Tests
// =============================================================================

describe('WarningCollector', () => {
  it('collects warnings', () => {
    const collector = createWarningCollector()
    
    collector.add({
      type: 'orphaned_tie_start',
      beat: 0,
      pitch: 'C4',
      message: 'Test warning'
    })
    
    const warnings = collector.getWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].pitch).toBe('C4')
  })

  it('returns copy of warnings array', () => {
    const collector = createWarningCollector()
    
    collector.add({
      type: 'orphaned_tie_start',
      beat: 0,
      pitch: 'C4',
      message: 'Test'
    })
    
    const warnings1 = collector.getWarnings()
    const warnings2 = collector.getWarnings()
    
    expect(warnings1).not.toBe(warnings2)  // Different array instances
    expect(warnings1).toEqual(warnings2)   // Same content
  })
})

// =============================================================================
// streamingCoalesceWithWarnings Tests
// =============================================================================

describe('streamingCoalesceWithWarnings', () => {
  function prepareSequence(clip: any) {
    const expanded = expandClip(clip)
    return computeTiming(expanded, '4/4')
  }

  it('returns iterator and getWarnings function', () => {
    const clip = Clip.melody('Test')
      .note('C4', '4n')
      .build()

    const timed = prepareSequence(clip)
    const { iterator, getWarnings } = streamingCoalesceWithWarnings(timed.operations)

    expect(typeof iterator[Symbol.iterator]).toBe('function')
    expect(typeof getWarnings).toBe('function')
  })

  it('collects warnings after iteration', () => {
    const clip = Clip.melody('OrphanTest')
      .note('C4', '2n').tie('start')
      .note('D4', '2n')  // Orphan
      .build()

    const timed = prepareSequence(clip)
    const { iterator, getWarnings } = streamingCoalesceWithWarnings(timed.operations)

    // Consume iterator
    const results = [...iterator]

    // Warnings should be available
    const warnings = getWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].type).toBe('orphaned_tie_start')
  })
})

