// =============================================================================
// SymphonyScript - Loop Overloads Type Tests
// Verifies type-safe loop() with OperationsSource interface
// =============================================================================

import { Clip } from '../index'
import type { LoopOp } from '../clip/types'

describe('Loop Overloads', () => {
  describe('Builder Function', () => {
    it('should accept builder function returning builder', () => {
      const clip = Clip.melody()
        .loop(2, b => b.note('C4').commit().note('D4').commit())
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(2)
      expect(loopOp.operations.length).toBe(2)
    })

    it('should accept builder function returning cursor', () => {
      const clip = Clip.melody()
        .loop(2, b => b.note('C4').note('D4'))
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(2)
      expect(loopOp.operations.length).toBe(2)
    })
  })

  describe('OperationsSource (ClipBuilder)', () => {
    it('should accept same-type MelodyBuilder', () => {
      const pattern = Clip.melody().note('E4').commit().note('F4').commit()
      
      const clip = Clip.melody()
        .loop(3, pattern)
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(3)
      expect(loopOp.operations.length).toBe(2)
    })

    it('should accept same-type DrumBuilder', () => {
      const pattern = Clip.drums().kick().commit().snare().commit()
      
      const clip = Clip.drums()
        .loop(4, pattern)
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(4)
    })

    // Type safety test: Uncomment to verify compile error
    // it('should NOT accept incompatible builder (compile error)', () => {
    //   const drumPattern = Clip.drums().kick().commit()
    //   // @ts-expect-error - DrumBuilder not assignable to MelodyBuilder
    //   Clip.melody().loop(2, drumPattern)
    // })
  })

  describe('OperationsSource (NoteCursor)', () => {
    it('should accept MelodyNoteCursor', () => {
      const cursor = Clip.melody().note('G4').note('A4')
      
      const clip = Clip.melody()
        .loop(2, cursor)
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(2)
      expect(loopOp.operations.length).toBe(2)
    })

    it('should accept DrumHitCursor', () => {
      const cursor = Clip.drums().kick().snare()
      
      const clip = Clip.drums()
        .loop(3, cursor)
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(3)
    })
  })

  describe('ClipNode', () => {
    it('should accept ClipNode directly', () => {
      const patternNode = Clip.melody().note('B4').commit().build()
      
      const clip = Clip.melody()
        .loop(5, patternNode)
        .build()

      expect(clip.operations[0].kind).toBe('loop')
      const loopOp = clip.operations[0] as LoopOp
      expect(loopOp.count).toBe(5)
      expect(loopOp.operations.length).toBe(1)
    })
  })
})
