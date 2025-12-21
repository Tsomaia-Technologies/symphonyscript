import { Clip, Instrument, session, Track } from '@symphonyscript/core/core'
import { compile } from '../compiler'
import { renderPattern } from '../debug/ascii'
import type { CompiledEvent } from '../compiler/pipeline/types'

describe('ASCII Visualization (Comprehensive)', () => {

  // --- Helpers ---

  function makeEvent(pitch: string, start: number, duration: number): CompiledEvent {
    return {
      kind: 'note',
      startSeconds: start,
      durationSeconds: duration,
      channel: 1 as import('@symphonyscript/core/types/midi').MidiChannel,
      payload: {
        pitch: pitch as import('@symphonyscript/core/types/primitives').NoteName,
        velocity: 1 as import('@symphonyscript/core/types/midi').MidiValue
      }
    }
  }

  // --- Edge Cases ---

  describe('Edge Cases', () => {
    it('handles empty event list', () => {
      const output = renderPattern([], 'Empty')
      expect(output).toContain('Empty    |')
      // Should arguably show nothing or just header/track line?
      // Implementation calculates totalBeats from maxSeconds. If 0, maybe 0 beats?
      // Let's see what happens.
    })

    it('handles sub-step duration (very short notes)', () => {
      // 0.01s is much less than a 16th note at 120bpm (0.125s)
      const events = [makeEvent('C4', 0, 0.01)]
      const output = renderPattern(events, 'Short', { bpm: 120 })
      // Should still show the 'C' but no sustain
      expect(output).toContain('C---')
    })

    it('handles notes starting off-grid (quantization)', () => {
      // Start at 0.01s. Should map to step 0.
      const events = [makeEvent('C4', 0.01, 0.5)]
      const output = renderPattern(events, 'Offset', { bpm: 120 })
      expect(output).toContain('C...')
    })
  })

  // --- Polyphony ---

  describe('Polyphony', () => {
    it('handles overlapping notes (monophonic view logic)', () => {
      // C4 at 0, E4 at 0.
      // Last one in the list wins for the character cell?
      const events = [
        makeEvent('C4', 0, 0.5),
        makeEvent('E4', 0, 0.5)
      ]
      const output = renderPattern(events, 'Chord')
      // 'E' comes last, should be visible. 'C' might be overwritten.
      // ASCII view is monophonic per track line.
      expect(output).toContain('E')
    })

    it('sustain does not overwrite existing notes', () => {
      // Note 1: C4 for 1 beat (steps 0-3)
      // Note 2: E4 at step 2 (0.25s)
      // C4 sustain should not wipe E4 char
      const events = [
        makeEvent('C4', 0, 0.5),   // Steps 0,1,2,3 -> C...
        makeEvent('E4', 0.25, 0.25) // Step 2 -> E.
      ]
      // Expected: C.E.
      const output = renderPattern(events, 'Overlap', { bpm: 120 })
      expect(output).toMatch(/C\.E\./)
    })
  })

  // --- Customization ---

  describe('Customization', () => {
    it('supports custom resolution (stepsPerBeat)', () => {
      const events = [makeEvent('C4', 0, 0.5)] // 1 beat
      // 8 steps per beat -> 1 beat = 8 chars
      const output = renderPattern(events, 'HighRes', { stepsPerBeat: 8, bpm: 120 })
      expect(output).toMatch(/C\.\.\.\.\.\.\./) // C + 7 dots
    })

    it('supports custom characters', () => {
      const events = [makeEvent('C4', 0, 0.5)]
      const output = renderPattern(events, 'Custom', {
        emptyChar: '_',
        sustainChar: '=',
        bpm: 120,
        totalBeats: 2 // Force 2 beats to check empty chars
      })
      expect(output).toMatch(/C===____/)
    })
  })

  // --- Complex Rhythms ---

  describe('Complex Rhythms', () => {
    it('visualizes euclidean rhythms correctly', () => {
      // 3 hits in 8 steps (Tresillo) -> x--x--x-
      // Using 16n steps, this is 2 beats long (8 * 16n).
      // stepsPerBeat=4 (16th notes).

      const clip = Clip.drums().euclidean({ hits: 3, steps: 8, note: 'Kick' })
      // Provide 'Drums' name so renderer detects it as drum track
      const t1 = Track.from(clip, Instrument.synth('Drums'), { name: 'Drums' })
      const t2 = Track.from(Clip.melody('B').note('E4').commit(), Instrument.synth('B'), { name: 'Track2' })
      
      const s = session({ tempo: 120 }).add(t1).add(t2)
      const result = compile(s, { 
        warnings: true
      })
      const ascii = result.toAscii?.()
      // stepsPerBeat: 1 means 1 beat = 1 char?
      // "note: renderer uses '-' for empty"
      // Euclidean 16n steps. 8 steps = 2 beats.
      // If we want 1 char per step, we need stepsPerBeat = 4 (standard 16th grid).
      // Let's use default options or explicit standard options.

      // Expected: x--x--x-
      // Note: renderer uses '-' for empty.
      expect(ascii).toContain('x--x--x-')
    })

    it('visualizes triplets (approximate)', () => {
      // 3 notes in space of 2 beats? Or 3 notes in 1 beat (8t)?
      const clip = Clip.melody()
        .note('C4', '8t')
        .note('D4', '8t')
        .note('E4', '8t')
    })

    it('should support triplets in ASCII', () => {
      const clip = Clip.melody('B').note('C4', '4t').note('D4', '4t').note('E4', '4t').commit()
      const compiled = compile(session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Synth'))))
      const output = compiled.toAscii?.()
      
      expect(output).toBeDefined()
      // Renderer outputs single char for notes (C, D, E) or first char
      expect(output).toContain('C')
      expect(output).toContain('E')
      // C D E - ?
      expect(output).toMatch(/[CDE].*[CDE].*[CDE]/)
    })
  })

  // --- Session & Tempo ---

  describe('Session Integration', () => {
    it('handles tempo changes alignment', () => {
      // 120bpm for 1 beat, then 60bpm for 1 beat.
      // Beat 1: 0.5s. Beat 2: 1.0s long.
      // Total time: 1.5s.
      // Total beats calculated from time: 1.5 / (60/120)?
      // Wait, renderAsciiTimeline takes a SINGLE 'bpm' for the grid (view bpm).
      // It projects real time onto a fixed grid.
      // If the song slows down, the notes should appear stretched in the grid.

      const clip = Clip.melody()
        .tempo(120)
        .note('C4', '4n') // 0.5s
        .tempo(60)
        .note('C4', '4n') // 1.0s

      const s = session().add(Track.from(clip.commit(), Instrument.synth('Synth')))
      // Render with VIEW bpm = 120.
      // First note: 0.5s -> 1 beat -> 4 chars.
      // Second note: 1.0s -> 2 beats -> 8 chars.

      const output = compile(s).toAscii?.({ bpm: 120 })

      expect(output).toMatch(/C\.\.\.C\.\.\.\.\.\.\./)
    })
  })
})

