import { Clip, compile, Instrument, session, Track } from '@symphonyscript/core'
import { AftertouchEvent, NoteOnEvent } from '../compiler/types'

describe('Dynamics & Expression', () => {

  describe('Velocity Regions', () => {
    it('should interpolate velocity for crescendo (0.2 -> 1.0)', () => {
      const clip = Clip.melody('Crescendo')
        .crescendo('1n', { from: 0.2, to: 1.0 }) // 4 beats
        .note('C4', '4n') // Beat 1
        .note('D4', '4n') // Beat 2
        .note('E4', '4n') // Beat 3
        .note('F4', '4n') // Beat 4
        .build()

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(notes).toHaveLength(4)

      expect(notes[0].velocity).toBeLessThan(notes[1].velocity)
      expect(notes[1].velocity).toBeLessThan(notes[2].velocity)
      expect(notes[2].velocity).toBeLessThan(notes[3].velocity)

      // Approximate check:
      // Times: 0, 0.5, 1.0, 1.5. Total Dur: 2.0s.
      // t=0: ~0.2 * 127 = ~25.
      expect(notes[0].velocity).toBeCloseTo(25, 0)
    })

    it('should interpolate velocity for decrescendo', () => {
      const clip = Clip.melody('Decrescendo')
        .decrescendo('2n', { from: 1.0, to: 0.2 })
        .note('C4', '4n')
        .note('D4', '4n')
        .build()

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(notes[0].velocity).toBeGreaterThan(notes[1].velocity)
    })
  })

  describe('Accent', () => {
    it('should boost velocity for accented notes', () => {
      const clip = Clip.melody('Accent')
        .note('C4', '4n').velocity(0.5)
        .note('D4', '4n').velocity(0.5).accent()
        .build()

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

      expect(notes[0].velocity).toBe(64) // 0.5 * 127 rounded = 64
      // Accent typically *1.2 or similar boost (capped at 1.0)
      expect(notes[1].velocity).toBeGreaterThan(notes[0].velocity)
    })
  })

  describe('Aftertouch', () => {
    it('should emit aftertouch events', () => {
      const clip = Clip.melody('Aftertouch')
        .note('C4', '4n')
        .aftertouch(0.5) // Channel
        .note('D4', '4n')
        .aftertouch(0.8, { type: 'poly', note: 'D4' }) // Poly
        .build() // aftertouch returns Builder, so .build() is fine.
      // Wait, .aftertouch(poly) creates op, but where does it put it?
      // Note: aftertouch() is an escape on Helper?
      // In MelodyNoteCursor.ts: aftertouch() -> commit().aftertouch().
      // In MelodyBuilder.ts: aftertouch() -> addOp.
      // So .note().aftertouch() adds note op then aftertouch op.
      // This is correct.

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const events = output.timeline.filter((e): e is AftertouchEvent => e.kind === 'aftertouch')
      expect(events).toHaveLength(2)

      // Value is often scaled to MIDI 0-127
      // 0.5 * 127 = 63.5 -> 64
      expect(events[0].value).toBe(64)
      expect(events[0].type).toBe('channel')

      expect(events[1].value).toBe(Math.round(0.8 * 127))
      expect(events[1].type).toBe('poly')
      expect(events[1].note).toBe('D4')
    })
  })
})
