// =============================================================================
// SymphonyScript - Default Duration Tests
// Verifies RFC-016: defaultDuration() context behavior
// =============================================================================

import { Clip, Clip as ClipFactory } from '@symphonyscript/core'
import { NoteOp, RestOp, StackOp } from '../clip/types'

describe('Default Duration Context', () => {

  describe('MelodyBuilder', () => {
    
    it('uses global default (4n) when no context set', () => {
      const clip = Clip.melody().note('C4').build()
      const op = clip.operations[0] as NoteOp
      expect(op.duration).toBe('4n')
    })

    it('uses defaultDuration context', () => {
      const clip = Clip.melody()
        .defaultDuration('8n')
        .note('C4')
        .build()
      
      const op = clip.operations[0] as NoteOp
      expect(op.duration).toBe('8n')
    })

    it('explicit duration overrides context', () => {
      const clip = Clip.melody()
        .defaultDuration('8n')
        .note('C4', '2n')
        .build()
      
      const op = clip.operations[0] as NoteOp
      expect(op.duration).toBe('2n')
    })

    it('rest() uses defaultDuration', () => {
      const clip = Clip.melody()
        .defaultDuration('16n')
        .rest()
        .build()
      
      const op = clip.operations[0] as RestOp
      expect(op.duration).toBe('16n')
    })

    it('explicit rest duration overrides context', () => {
      const clip = Clip.melody()
        .defaultDuration('16n')
        .rest('1n')
        .build()
      
      const op = clip.operations[0] as RestOp
      expect(op.duration).toBe('1n')
    })

    it('chord() uses defaultDuration', () => {
      const clip = Clip.melody()
        .defaultDuration('2n')
        .chord(['C4', 'E4'] as import('@symphonyscript/core/types').NoteName[])
        .build()
      
      const stack = clip.operations[0] as StackOp
      const note = stack.operations[0] as NoteOp
      expect(note.duration).toBe('2n')
    })

    it('chord(code) uses defaultDuration', () => {
      const clip = Clip.melody()
        .defaultDuration('2n')
        // chord('Cmaj', 4) -> should use default duration
        .chord('Cmaj', 4)
        .build()
      
      const stack = clip.operations[0] as StackOp
      const note = stack.operations[0] as NoteOp
      expect(note.duration).toBe('2n')
    })

    it('supports multiple defaultDuration changes in one clip', () => {
      const clip = Clip.melody()
        .defaultDuration('16n')
        .note('C4').commit().note('D4').commit()
        .defaultDuration('8n')
        .note('E4').commit().note('F4').commit()
        .defaultDuration('4n')
        .note('G4')
        .build()
      
      const ops = clip.operations as NoteOp[]
      expect(ops[0].duration).toBe('16n')
      expect(ops[1].duration).toBe('16n')
      expect(ops[2].duration).toBe('8n')
      expect(ops[3].duration).toBe('8n')
      expect(ops[4].duration).toBe('4n')
    })
  })

  describe('DrumBuilder', () => {
    
    it('uses standard drum default (16n) when no context set', () => {
      const clip = Clip.drums().kick().build()
      const op = clip.operations[0] as NoteOp
      expect(op.duration).toBe('16n')
    })

    it('uses defaultDuration if set', () => {
      const clip = Clip.drums()
        .defaultDuration('8n')
        .kick()
        .build()

      const op = clip.operations[0] as NoteOp
      expect(op.duration).toBe('8n')
    })
  })
})
