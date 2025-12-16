import { Clip } from '../index'
import { compileClip } from '../compiler/pipeline/index'

describe('Note Expression (MPE)', () => {
  describe('Builder API', () => {
    describe('detune', () => {
      it('applies microtonal detuning', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .detune(50)
          .build()

        const noteOp = clip.operations[0]
        expect(noteOp.kind).toBe('note')
        expect((noteOp as any).detune).toBe(50)
      })

      it('validates range (-1200 to 1200)', () => {
        expect(() => Clip.melody().note('C4').detune(2000))
          .toThrow()
      })

      // With Relay Pattern, Clip.melody().detune() is impossible because detune() is on Cursor, not Builder.
      // This is a type error now. We can remove the test or test that the cursor method exists.
      // Or check that calling detune on a new NoteCursor without note fails? (Except constructor requires Op)
    })

    describe('timbre', () => {
      it('applies brightness value', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .timbre(0.8)
          .build()

        const noteOp = clip.operations[0]
        expect((noteOp as any).timbre).toBe(0.8)
      })

      it('validates range (0-1)', () => {
        expect(() => Clip.melody().note('C4').timbre(1.5))
          .toThrow()
      })
    })

    describe('pressure', () => {
      it('applies initial pressure', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .pressure(0.6)
          .build()

        const noteOp = clip.operations[0]
        expect((noteOp as any).pressure).toBe(0.6)
      })

      it('validates range (0-1)', () => {
        expect(() => Clip.melody().note('C4').pressure(-0.1))
          .toThrow()
      })
    })

    describe('expression()', () => {
      it('applies multiple parameters', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .expression({ detune: 25, timbre: 0.7, pressure: 0.5 })
          .build()

        const noteOp = clip.operations[0] as any
        expect(noteOp.detune).toBe(25)
        expect(noteOp.timbre).toBe(0.7)
        expect(noteOp.pressure).toBe(0.5)
      })

      it('merges with existing values', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .detune(50)
          .expression({ timbre: 0.5 })
          .build()

        const noteOp = clip.operations[0] as any
        expect(noteOp.detune).toBe(50)
        expect(noteOp.timbre).toBe(0.5)
      })
    })
  })

  describe('Emission & Pipeline', () => {
    it('includes expression data in compiled note payload', () => {
      const clip = Clip.melody()
        .note('C4', '4n').detune(50).timbre(0.8).pressure(0.2)
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const noteEvent = result.events.find(e => e.kind === 'note')

      expect(noteEvent?.payload.detune).toBe(50)
      expect(noteEvent?.payload.timbre).toBe(102)   // 0.8 * 127 ≈ 101.6 → 102
      expect(noteEvent?.payload.pressure).toBe(25)  // 0.2 * 127 ≈ 25.4 → 25
    })

    it('emits CC74 for timbre', () => {
      const clip = Clip.melody()
        .note('C4', '4n').timbre(0.8)
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const cc74 = result.events.find(
        e => e.kind === 'control' && e.payload.controller === 74
      )

      expect(cc74).toBeDefined()
      expect(cc74?.kind === 'control' && cc74.payload.value).toBe(102) // 0.8 * 127 ≈ 101.6 -> 102
    })

    it('emits aftertouch for pressure', () => {
      const clip = Clip.melody()
        .note('C4', '4n').pressure(0.5)
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const at = result.events.find(e => e.kind === 'aftertouch')

      expect(at).toBeDefined()
      expect(at?.payload.value).toBe(64) // 0.5 * 127 ≈ 63.5 -> 64
    })

    it('emits control/aftertouch BEFORE note event (same timestamp)', () => {
      const clip = Clip.melody()
        .note('C4', '4n').timbre(0.8).pressure(0.5)
        .build()

      const result = compileClip(clip, { bpm: 120 })

      // Should be [Control, Aftertouch, Note] or [Control, Note] etc.
      // All share same startSeconds
      const events = result.events
      const noteIndex = events.findIndex(e => e.kind === 'note')
      const ccIndex = events.findIndex(e => e.kind === 'control' && e.payload.controller === 74)
      const atIndex = events.findIndex(e => e.kind === 'aftertouch')

      expect(ccIndex).toBeLessThan(noteIndex)
      expect(atIndex).toBeLessThan(noteIndex)
    })

    it('emits timbre as MidiValue (0-127)', () => {
      const clip = Clip.melody()
        .note('C4', '4n').timbre(0.5)
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const noteEvent = result.events.find(e => e.kind === 'note')

      expect(noteEvent?.payload.timbre).toBe(64) // 0.5 * 127 ≈ 63.5 → 64
    })

    it('emits pressure as MidiValue (0-127)', () => {
      const clip = Clip.melody()
        .note('C4', '4n').pressure(1.0)
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const noteEvent = result.events.find(e => e.kind === 'note')

      expect(noteEvent?.payload.pressure).toBe(127)
    })

    it('omits undefined expression fields from payload', () => {
      const clip = Clip.melody()
        .note('C4', '4n')
        .build()

      const result = compileClip(clip, { bpm: 120 })
      const noteEvent = result.events.find(e => e.kind === 'note')

      expect(noteEvent?.payload.timbre).toBeUndefined()
      expect(noteEvent?.payload.pressure).toBeUndefined()
    })
  })
})
