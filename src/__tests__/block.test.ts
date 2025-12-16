import { describe, expect, it } from '@jest/globals'
import { MelodyBuilder } from '../clip/MelodyBuilder'
import { compileClip } from '../compiler/pipeline'
import { compileBlock, getDefaultCache } from '../compiler/block'
import type { CompiledEvent } from '../compiler/pipeline/types'

const melody = (name: string) => new MelodyBuilder({ name })

describe('Phase 2: Incremental Compilation', () => {
  describe('compileBlock', () => {
    it('compiles a simple clip to block', () => {
      const clip = melody('Test').note('C4', '4n').build()
      const block = compileBlock(clip, { bpm: 120 })

      expect(block.kind).toBe('compiled_block')
      expect(block.durationBeats).toBe(1)
      expect(block.events.length).toBeGreaterThanOrEqual(1)
    })

    it('generates stable hash', () => {
      const clip = melody('Test').note('C4').build()
      const block1 = compileBlock(clip, { bpm: 120 })
      const block2 = compileBlock(clip, { bpm: 120 })
      expect(block1.hash).toBe(block2.hash)
    })

    it('changes hash when clip changes', () => {
      const clip1 = melody('Test').note('C4').build()
      const clip2 = melody('Test').note('D4').build()
      const block1 = compileBlock(clip1, { bpm: 120 })
      const block2 = compileBlock(clip2, { bpm: 120 })
      expect(block1.hash).not.toBe(block2.hash)
    })

    it('captures end state tempo', () => {
      const clip = melody('Test')
        .tempo(120)
        .note('C4')
        .tempo(140)
        .note('D4')
        .build()

      const block = compileBlock(clip, { bpm: 120 })
      expect(block.endState.tempo).toBe(140)
    })
  })

  describe('FrozenClip integration', () => {
    it('frozen clip plays correctly in parent', () => {
      const frozen = melody('Frozen')
        .note('C4', '4n')
        .note('D4', '4n') // Returns Cursor
        .freeze({ bpm: 120 }) // NoteCursor.freeze() is now supported

      const parent = melody('Parent')
        .note('B3', '4n')
        .play(frozen)
        .note('E4', '4n')

      const compiled = compileClip(parent.build(), { bpm: 120 })
      const notes = compiled.events.filter((e: CompiledEvent) => e.kind === 'note')

      expect(notes).toHaveLength(4)
    })

    it('block events have correct time offsets', () => {
      const frozen = melody('Frozen')
        .note('C4', '4n')
        .freeze({ bpm: 120 })

      const parent = melody('Parent')
        .rest('1n')
        .play(frozen)

      const compiled = compileClip(parent.build(), { bpm: 120 })
      const notes = compiled.events.filter((e: CompiledEvent) => e.kind === 'note')

      expect(notes).toHaveLength(1)
      expect(notes[0].startSeconds).toBeGreaterThan(1.5)
    })
  })

  describe('Cache', () => {
    it('cache hit avoids recompilation', () => {
      const cache = getDefaultCache()
      cache.clear()

      const clip = melody('CacheTest').note('C4').build()

      const block1 = compileBlock(clip, { bpm: 120 })
      const statsBefore = cache.stats()

      const block2 = compileBlock(clip, { bpm: 120 })
      const statsAfter = cache.stats()

      expect(statsAfter.hits).toBe(statsBefore.hits + 1)
      expect(block1.hash).toBe(block2.hash)
    })
  })
})
