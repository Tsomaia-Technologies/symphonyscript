import { Clip, compile, Grooves, Instrument, session, Track } from '@symphonyscript/core'
import type { NoteOnEvent } from '../compiler/types'

describe('Groove & Swing', () => {

  describe('Swing', () => {
    it('should delay off-beat notes when swing is active', () => {
      const clip = Clip.melody('Swing').swing(0.5)
        .note('C4', '16n') // On grid (0)
        .note('C4', '16n') // Off beat (0.125s at 120bpm) - Should be delayed
        .note('C4', '16n') // On grid (0.25s)
        .note('C4', '16n') // Off beat (0.375s)

      const s = session().add(Track.from(clip.commit(), Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

      // Check perfect grid
      // 120 bpm = 2 bps = 1 beat = 0.5s.
      // 16n = 0.25 beats = 0.125s.
      const expectedIdeal = [0, 0.125, 0.250, 0.375]

      // First note (on beat) should be 0
      expect(notes[0].time).toBeCloseTo(0)

      // Second note (e) should NOT be delayed (Swing affects 8ths, not 16ths in default fallback)
      expect(notes[1].time).toBeCloseTo(expectedIdeal[1])

      // Third note (&) should be delayed (0.5 beats = 8th note offbeat)
      expect(notes[2].time).toBeGreaterThan(expectedIdeal[2])

      // Fourth note (a) should NOT be delayed (16th note)
      expect(notes[3].time).toBeCloseTo(expectedIdeal[3])
    })
  })

  describe('Groove Templates', () => {
    it('should apply timing offsets from MPC groove', () => {
      const clip = Clip.melody('MPC').groove(Grooves.MPC_16_55)
        .note('C4', '16n')
        .note('C4', '16n')
        .note('C4', '16n')
        .note('C4', '16n')

      const s = session().add(Track.from(clip.commit(), Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      // MPC_16_55 has specific offsets.
      // We just verify that *some* offset occurred vs the grid.

      const expectedIdeal = [0, 0.125, 0.250, 0.375]
      let hasOffset = false

      notes.forEach((n, i) => {
        if (Math.abs(n.time - expectedIdeal[i]) > 0.001) {
          hasOffset = true
        }
      })

      expect(hasOffset).toBe(true)
    })
  })
})
