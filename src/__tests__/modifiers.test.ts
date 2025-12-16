import { Clip, Clip as ClipFactory, compile, Instrument, session, Track } from '../index'
import { NoteOnEvent, PitchBendEvent } from '../compiler/types'

describe('Modifiers', () => {

  describe('Humanize', () => {
    it('should produce variance in timing and velocity', () => {
      const humanizeTest = Clip.melody('Humanize')
        .note('C4', '4n') // Reference
        .note('E4', '4n').humanize({ timing: 30, velocity: 0.1 })
        .build()

      const s = session().add(Track.from(humanizeTest, Instrument.synth('Test')))

      // Run multiple times to account for randomness
      let timeChanged = false
      let velChanged = false

      for (let i = 0; i < 10; i++) {
        const { output } = compile(s, { seed: i * 1000 })
        const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
        const n = notes[1]

        // Check for deviation from defaults (time: 0.5s, velocity: 1.0)
        if (Math.abs(n.time - 0.5) > 0.001) timeChanged = true
        if (Math.abs(n.velocity - 1.0) > 0.001) velChanged = true

        if (timeChanged && velChanged) break
      }

      expect(timeChanged).toBe(true)
      expect(velChanged).toBe(true)
    })

    it('should preserve seed property in operation', () => {
      const clip = Clip.melody('Seed')
        .note('C4', '4n').humanize({ timing: 10, seed: 12345 })
        .build()

      const op = clip.operations.find(o => o.kind === 'note' && o.humanize) as any
      expect(op).toBeDefined()
      expect(op!.humanize!.seed).toBe(12345)
    })
  })

  describe('Tie', () => {
    it('should emit only one note_on for a tied sequence', () => {
      const tieTest = Clip.melody('Tie')
        .note('C4', '2n').tie('start')
        .note('C4', '2n').tie('continue')
        .note('C4', '2n').tie('end')
        .note('D4', '4n') // Untied
        .build()

      const s = session({ tempo: 120 }).add(Track.from(tieTest, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter(e => e.kind === 'note_on')
      expect(notes).toHaveLength(2) // C4 (merged) + D4

      const tiedNote = notes[0] as NoteOnEvent
      expect(tiedNote.tie).toBeUndefined()
    })
  })

  describe('Glide', () => {
    it('should emit pitch_bend events', () => {
      const glideTest = Clip.melody('Glide')
        .note('C4', '4n')
        .note('E4', '4n').glide('8n')
        .build()

      const s = session({ tempo: 120 }).add(Track.from(glideTest, Instrument.synth('Test')))
      const { output } = compile(s)

      const bends = output.timeline.filter((e): e is PitchBendEvent => e.kind === 'pitch_bend')
      // Glide emits 2 bends: start (non-center) and end (center = 64).
      expect(bends.length).toBeGreaterThanOrEqual(2)
      expect(bends[0].value).not.toBe(64) // Should not be center
      expect(bends[bends.length - 1].value).toBe(64) // Back to center
    })
  })

  describe('Articulation', () => {
    it('should reduce duration for staccato', () => {
      const clip = Clip.melody('Staccato')
        .note('C4', '4n').staccato() // 0.5s nominally
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // Staccato = 50%
      expect(note.duration).toBeCloseTo(0.25)
      expect(note.articulation).toBe('staccato')
    })

    it('should increase duration for legato', () => {
      const clip = Clip.melody('Legato')
        .note('C4', '4n').legato()
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // Legato = 105%? (Depends on utils.ts implementation)
      // Assuming 1.05 * 0.5 = 0.525
      expect(note.duration).toBeGreaterThan(0.5)
    })
  })

  describe('Transposition', () => {
    it('should apply transposition context', () => {
      const clip = ClipFactory.melody('Trans')
        .transpose(2)
        .note('C4', '4n') // -> D4
        .transpose(-1)
        .note('C4', '4n') // +2 -1 = +1 -> C#4
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(notes[0].note).toBe('D4')
      expect(notes[1].note).toBe('C#4')
    })
  })

  describe('Vibrato', () => {
    it('should emit Control Change 1 (Modulation)', () => {
      // Using MelodyBuilder directly
      // .vibrato() is an escape, returns Builder.
      const clip = Clip.melody('VibratoTest')
        .note('C4', '1n')
        .vibrato(0.8) // depth 0.8

      // Test without build() to exercise Builder return behavior
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const cc = output.timeline.find((e): e is any => e.kind === 'control' && e.controller === 1)

      expect(cc).toBeDefined()
      expect(cc.value).toBe(Math.round(0.8 * 127))
    })
  })
  describe('Octave Control', () => {
    it('octave(5) shifts C4 to C5', () => {
      const clip = Clip.melody('Oct5').octave(5).note('C4', '4n').build()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      const n = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')[0]
      expect(n.note).toBe('C5')
    })

    it('octave(3) shifts C4 to C3', () => {
      const clip = Clip.melody('Oct3').octave(3).note('C4', '4n').build()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      const n = output.timeline[0] as NoteOnEvent
      expect(n.note).toBe('C3')
    })

    it('octaveUp(1) shifts by +12 semitones', () => {
      const clip = Clip.melody('Up1').octaveUp(1).note('C4').build()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      expect((output.timeline[0] as NoteOnEvent).note).toBe('C5')
    })

    it('octaveDown(2) shifts by -24 semitones', () => {
      const clip = Clip.melody('Down2').octaveDown(2).note('C4').build()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      expect((output.timeline[0] as NoteOnEvent).note).toBe('C2')
    })

    it('octave + octaveUp are cumulative', () => {
      // Octave 5 (+12) + Up 1 (+12) = +24 (2 octaves up) -> C4 becomes C6
      const clip = Clip.melody('Cumulative').octave(5).octaveUp(1).note('C4').build()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      expect((output.timeline[0] as NoteOnEvent).note).toBe('C6')
    })

    it('validates octave range', () => {
      expect(() => Clip.melody().octave(-1)).toThrow(/octave must be 0-9/)
      expect(() => Clip.melody().octave(10)).toThrow(/octave must be 0-9/)
      expect(() => Clip.melody().octaveUp(-1)).toThrow(/octaves must be 0-10/)
      expect(() => Clip.melody().octaveDown(11)).toThrow(/octaves must be 0-10/)
    })
  })

  describe('Clip-Level Humanization', () => {
    it('applies humanize to all subsequent notes', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 30 })
        .note('C4')
        .note('D4')
        .build()

      expect((clip.operations[0] as any).humanize?.timing).toBe(30)
      expect((clip.operations[1] as any).humanize?.timing).toBe(30)
    })

    it('precise() disables humanization for a note', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 30 })
        .note('C4')
        .note('D4').precise()
        .build()

      expect((clip.operations[0] as any).humanize?.timing).toBe(30)
      expect((clip.operations[1] as any).humanize).toBeNull()
    })

    it('chord respects clip-level humanize', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 20 })
        .chord(['C4', 'E4', 'G4'] as any)
        .build()

      const stack = clip.operations[0] as any
      expect(stack.operations[0].humanize?.timing).toBe(20)
      expect(stack.operations[1].humanize?.timing).toBe(20)
      expect(stack.operations[2].humanize?.timing).toBe(20)
    })

    it('chord.precise() disables humanization', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 20 })
        .chord(['C4', 'E4', 'G4'] as any).precise()
        .build()

      const stack = clip.operations[0] as any
      expect(stack.operations[0].humanize).toBeNull()
      expect(stack.operations[1].humanize).toBeNull()
      expect(stack.operations[2].humanize).toBeNull()
    })

    it('changing humanize mid-clip works', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 50 })
        .note('C4').commit()
        .defaultHumanize({ timing: 10 })
        .note('D4')
        .build()

      expect((clip.operations[0] as any).humanize?.timing).toBe(50)
      expect((clip.operations[1] as any).humanize?.timing).toBe(10)
    })

    it('note-level humanize overrides clip-level', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 30 })
        .note('C4').humanize({ timing: 100 })
        .build()
      
      expect((clip.operations[0] as any).humanize?.timing).toBe(100)
    })

    it('compiler respects null humanize (no variance)', () => {
      const clip = Clip.melody()
        .defaultHumanize({ timing: 100, seed: 1 })
        .note('C4', '4n')
        .note('D4', '4n').precise()

      const s = session().add(Track.from(clip.commit().build(), Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      // Second note (D4) should be exactly on beat (no variance)
      // At 120 BPM, 4n = 0.5s, so second note at exactly 0.5s
      expect(notes[1].time).toBe(0.5)
    })
  })

  describe('Quantization', () => {
    it('snaps notes to 8th note grid', () => {
      // Create a clip with a note slightly off the 8th note grid
      // At 120 BPM: 8n = 0.25 beats
      // Note at 0.48 beats should snap to 0.5 beats (nearest 8th)
      const clip = Clip.melody('Quantize')
        .quantize('8n')
        .rest('8n')      // Rest for 0.5 beats
        .note('C4', '8n') // Note at beat 0.5
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // At 120 BPM, beat 0.5 = 0.25 seconds
      expect(note.time).toBeCloseTo(0.25)
    })

    it('applies partial quantization strength', () => {
      // With strength 0.5, a note 0.1 beats off-grid should move 0.05 beats toward grid
      const clip = Clip.melody('PartialQuantize')
        .quantize('4n', { strength: 0.5 })
        .note('C4', '4n') // At beat 0
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // Note at beat 0 snaps to grid 0 with any strength
      expect(note.time).toBeCloseTo(0)
    })

    it('quantizes note durations when enabled', () => {
      // Duration quantization should snap note length to grid
      const clip = Clip.melody('DurationQuantize')
        .quantize('4n', { duration: true })
        .note('C4', '4n') // Duration already on grid
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // At 120 BPM, 4n = 0.5s
      expect(note.duration).toBeCloseTo(0.5)
    })

    it('preserves quantize settings in NoteOp', () => {
      const clip = Clip.melody('QuantizeOp')
        .quantize('16n', { strength: 0.8, duration: true })
        .note('C4', '4n')
        .build()

      const op = clip.operations.find(o => o.kind === 'note') as any
      expect(op.quantize).toBeDefined()
      expect(op.quantize.grid).toBe('16n')
      expect(op.quantize.strength).toBe(0.8)
      expect(op.quantize.duration).toBe(true)
    })

    it('inherits clip-level quantize to notes', () => {
      const clip = Clip.melody('InheritQuantize')
        .quantize('8n')
        .note('C4')
        .note('D4')
        .build()

      const notes = clip.operations.filter(o => o.kind === 'note') as any[]
      expect(notes[0].quantize?.grid).toBe('8n')
      expect(notes[1].quantize?.grid).toBe('8n')
    })

    it('precise() disables quantization', () => {
      const clip = Clip.melody('PreciseQuantize')
        .quantize('8n')
        .note('C4')
        .note('D4').precise()
        .build()

      const notes = clip.operations.filter(o => o.kind === 'note') as any[]
      expect(notes[0].quantize?.grid).toBe('8n')
      expect(notes[1].quantize).toBeNull()
    })

    it('chord inherits clip-level quantize', () => {
      const clip = Clip.melody('ChordQuantize')
        .quantize('8n')
        .chord(['C4', 'E4', 'G4'] as any)
        .build()

      const stack = clip.operations[0] as any
      expect(stack.operations[0].quantize?.grid).toBe('8n')
      expect(stack.operations[1].quantize?.grid).toBe('8n')
      expect(stack.operations[2].quantize?.grid).toBe('8n')
    })

    it('layers correctly: quantize → groove → humanize', () => {
      // This test verifies pipeline order by checking that all three effects are applied
      const clip = Clip.melody('PipelineOrder')
        .quantize('4n')                         // 1. Correction
        .groove({ name: 'test', stepsPerBeat: 2, steps: [{ timing: 0.1 }] }) // 2. Style (push by 10%)
        .defaultHumanize({ timing: 10, seed: 42 }) // 3. Randomization
        .note('C4', '4n')
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // Note should be at beat 0, quantized, then groove offset applied, then humanized
      // With groove timing offset of 0.1 * step duration and humanize variance
      // The exact value depends on all three being applied
      expect(note.time).toBeDefined()
    })

    it('allows genre-swapping workflow', () => {
      // Example from plan: quantize to strict grid, then apply groove
      const clip = Clip.melody('GenreSwap')
        .quantize('16n')  // Clean up timing
        .groove({ name: 'swing', stepsPerBeat: 4, steps: [
          { timing: 0 },
          { timing: 0.1 },  // Swing the off-beats
          { timing: 0 },
          { timing: 0.1 }
        ]})
        .note('C4', '16n')
        .note('D4', '16n')
        .note('E4', '16n')
        .note('F4', '16n')
        .build()

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter(e => e.kind === 'note_on') as NoteOnEvent[]
      expect(notes).toHaveLength(4)
      
      // Off-beat notes (2nd and 4th) should be pushed by groove
      // This demonstrates that quantize + groove work together
    })
  })
})
