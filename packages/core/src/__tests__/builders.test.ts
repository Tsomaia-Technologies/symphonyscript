import { Clip, Clip as ClipFactory, DrumBuilder, Instrument, MelodyBuilder } from '../index'
import type { NoteName } from '../types'
import { degreeToNote, type ScaleContext } from '../scales'

describe('Builders', () => {
  describe('Immutability', () => {
    it('should return new instrument instance when modifying params', () => {
      const bass = Instrument.synth('Bass_Synth')
        .osc('sawtooth')
        .attack(0.05)

      const modifiedBass = bass.pan(0.5)

      expect(bass).not.toBe(modifiedBass)
      expect(bass.config.routing?.pan).toBeUndefined()
      expect(modifiedBass.config.routing?.pan).toBe(0.5)
    })
  })

  describe('Context Inheritance', () => {
    it('should preserve drum map in DrumBuilder loop callback', () => {
      const customMap = { 'kick': 'C2', 'snare': 'D2' } as unknown as { readonly [k: string]: NoteName }
      const drums = ClipFactory.drums('MyDrums', customMap)

      let builderTypeCheck = false
      let mapCheck = false

      drums.loop(4, (b) => {
        builderTypeCheck = b instanceof DrumBuilder

        // Verify resolveNote exists (private access for test)
        const note = (b as any).resolveNote ? (b as any).resolveNote('kick') : null
        mapCheck = (note === 'C2')

        // Must commit to return the builder
        return b.kick().commit()
      })

      expect(builderTypeCheck).toBe(true)
      expect(mapCheck).toBe(true)
    })

    it('should reset transposition in MelodyBuilder loop callback (handled by parent wrapper)', () => {
      const melody = ClipFactory.melody('MyMelody').transpose(2)

      let builderTypeCheck = false
      let transCheck = false

      melody.loop(2, (b) => {
        builderTypeCheck = b instanceof MelodyBuilder
        const trans = (b as any)._transposition
        transCheck = (trans === 0)
        // Must commit to return the builder
        return (b.note('C3').commit() as any)
      })

      expect(builderTypeCheck).toBe(true)
      expect(transCheck).toBe(true)
    })

    it('should preserve swing in stack builder callback', () => {
      const stackClip = ClipFactory.create('Stacker').swing(0.5)
      let swingCheck = false

      stackClip.stack((b) => {
        const sw = (b as any)._swing
        swingCheck = (sw === 0.5)
        return b
      })

      expect(swingCheck).toBe(true)
    })
  })

  describe('DrumBuilder API', () => {
    it('should correctly resolve mapped notes using withMapping', () => {
      const customDrums = Clip.drums('Custom Kit')
        .withMapping({ kick: 'C2', snare: 'E2', hat: 'G#2' } as unknown as { readonly [k: string]: NoteName })
        .kick()
        .snare()
        .hat()

      // .build() is available on cursor
      const ops = customDrums.build().operations

      const notes = ops
        .filter(op => op.kind === 'note')
        .map(op => (op as any).note)

      expect(notes).toContain('C2')
      expect(notes).toContain('E2')
      expect(notes).toContain('G#2')
    })
    describe('Phase 4: Feature Completeness', () => {
      it('should create automation operations', () => {
        const clip = ClipFactory.melody('Auto')
          .automate('filter_cutoff', 0.5, 1, 'linear')
          .volume(0.8)
          .pan(-1, 4)

        const ops = clip.build().operations

        const autoOp = ops[0] as any
        expect(autoOp.kind).toBe('automation')
        expect(autoOp.target).toBe('filter_cutoff')
        expect(autoOp.value).toBe(0.5)
        expect(autoOp.rampBeats).toBe(1) // 1 beat
        expect(autoOp.curve).toBe('linear')

        const volOp = ops[1] as any
        expect(volOp.target).toBe('volume')
        expect(volOp.value).toBe(0.8)

        const panOp = ops[2] as any
        expect(panOp.target).toBe('pan')
        expect(panOp.value).toBe(-1)
        expect(panOp.rampBeats).toBe(4) // 4 beats
      })

      it('should create complex tempo envelopes', () => {
        const clip = ClipFactory.melody('TempoEnv')
          .tempoEnvelope([
            { beat: 0, bpm: 120, curve: 'ease-in' },
            { beat: 4, bpm: 140, curve: 'linear' }
          ])

        const ops = clip.build().operations
        const op = ops[0] as any

        expect(op.kind).toBe('tempo')
        expect(op.bpm).toBe(140) // Targets last bpm
        expect(op.transition).toBeDefined()
        expect(op.transition.duration).toBe(4) // 4 - 0
        expect(op.transition.envelope.keyframes).toHaveLength(2)
      })

      it('should validate tempo envelope keyframes', () => {
        expect(() => {
          ClipFactory.melody('Bad').tempoEnvelope([
            { beat: 0, bpm: 120, curve: 'linear' }
          ] as any)
        }).toThrow('tempoEnvelope validation error')
      })
    })
  })
  describe('Scale Awareness', () => {
    describe('degreeToNote', () => {
      it('should convert degree 1 to root note', () => {
        const ctx: ScaleContext = { root: 'C', mode: 'major', octave: 4 }
        expect(degreeToNote(1, ctx)).toBe('C4')
      })

      it('should convert degree 3 in major scale', () => {
        const ctx: ScaleContext = { root: 'C', mode: 'major', octave: 4 }
        expect(degreeToNote(3, ctx)).toBe('E4')
      })

      it('should convert degree 3 in minor scale', () => {
        const ctx: ScaleContext = { root: 'C', mode: 'minor', octave: 4 }
        expect(degreeToNote(3, ctx)).toBe('Eb4')
      })

      it('should handle octave wrapping', () => {
        const ctx: ScaleContext = { root: 'C', mode: 'major', octave: 4 }
        expect(degreeToNote(8, ctx)).toBe('C5')  // Degree 8 = root up an octave
      })

      it('should handle chromatic alteration', () => {
        const ctx: ScaleContext = { root: 'C', mode: 'major', octave: 4 }
        expect(degreeToNote(3, ctx, -1)).toBe('D#4')  // Flat 3rd (D# in sharp key context)
      })
    })
  })

  describe('MelodyBuilder.scale', () => {
    it('should create scale context', () => {
      const clip = Clip.melody('ScaleTest')
        .scale('C', 'major')
        .degree(1)
        .degree(3)
        .degree(5)
        .build()

      const notes = clip.operations
        .filter(op => op.kind === 'note')
        .map(op => (op as any).note)

      expect(notes.length).toBe(3)
      expect(notes[0]).toBe('C4')
      expect(notes[1]).toBe('E4')
      expect(notes[2]).toBe('G4')
    })

    it('should work with minor scale', () => {
      const clip = Clip.melody('MinorTest')
        .scale('A', 'minor')
        .degree(1).degree(3).degree(5)
        .build()

      const notes = clip.operations
        .filter(op => op.kind === 'note')
        .map(op => (op as any).note)

      expect(notes[0]).toBe('A4')
      expect(notes[1]).toBe('C5')
      expect(notes[2]).toBe('E5')
    })

    it('should support degreeChord', () => {
      const clip = Clip.melody('ChordTest')
        .scale('C', 'major')
        .degreeChord([1, 3, 5])
        .build()

      // Should produce a single stack (chord) with 3 notes
      const stacks = clip.operations.filter(op => op.kind === 'stack')
      expect(stacks.length).toBe(1)

      const chordNotes = (stacks[0] as any).operations.map((op: any) => op.note)
      expect(chordNotes).toEqual(['C4', 'E4', 'G4'])
    })


    it('should throw if degree called without scale', () => {
      expect(() => {
        Clip.melody('NoScale').degree(1)
      }).toThrow('requires scale')
    })

    it('should support roman numerals', () => {
      const clip = Clip.melody('Roman')
        .scale('C', 'major')
        .roman('IV')
        .build()

      const stackOp = clip.operations[0] as any
      expect(stackOp.kind).toBe('stack')
      const notes = stackOp.operations.map((op: any) => op.note)
      expect(notes).toEqual(['F4', 'A4', 'C5']) // IV is F-A-C
    })

    it('should support inversions', () => {
      const clip = Clip.melody('Inversion')
        .scale('C', 'major')
        .roman('I', { inversion: 1 })
        .roman('I', { inversion: 2 })
        .build()

      // Inv 1: E, G, C (3, 5, 8) -> E4, G4, C5
      const stackOp1 = (clip.operations[0] as any)
      const notes1 = stackOp1.operations.map((o: any) => o.note)
      expect(notes1).toEqual(['E4', 'G4', 'C5'])

      // Inv 2: G, C, E (5, 8, 10) -> G4, C5, E5
      const stackOp2 = (clip.operations[1] as any)
      const notes2 = stackOp2.operations.map((o: any) => o.note)
      expect(notes2).toEqual(['G4', 'C5', 'E5'])
    })
  })

  describe('Scope Isolation', () => {
    it('should create a scope operation with isolate method', () => {
      const clip = Clip.melody('Iso')
        .isolate({ tempo: true }, b => b.tempo(120))
        .build()

      const op = clip.operations[0] as any
      expect(op.kind).toBe('scope')
      expect(op.isolate).toEqual({ tempo: true })

      // Verify inner structure (Scope wrap -> Clip -> Ops)
      expect(op.operation.kind).toBe('clip')
      expect(op.operation.clip.operations[0].kind).toBe('tempo')
    })
  })
  describe('Chord Code Integration', () => {
    it('should resolve chord codes', () => {
      const clip = Clip.melody('Chords')
        .chord('Cmaj7', 4, '4n')
        .build()

      const op = clip.operations[0] as any
      expect(op.kind).toBe('stack')
      const notes = op.operations.map((n: any) => n.note)
      expect(notes).toEqual(['C4', 'E4', 'G4', 'B4'])
    })

    it('should support alternative syntax (NoteName array)', () => {
      const clip = Clip.melody('Arr')
        .chord(['C4', 'E4'] as NoteName[], '8n')
        .build()

      const op = clip.operations[0] as any
      expect(op.kind).toBe('stack')
      const notes = op.operations.map((n: any) => n.note)
      expect(notes).toEqual(['C4', 'E4'])
    })

    it('should support inversions via cursor method', () => {
      const clip = Clip.melody('Inv')
        .chord('C', 4, '4n').inversion(1)
        .build()

      const notes = (clip.operations[0] as any).operations.map((n: any) => n.note)
      expect(notes).toEqual(['E4', 'G4', 'C5'])
    })

    it('should support degreeChord inversions', () => {
      const clip = Clip.melody('DegInv')
        .scale('C', 'major')
        .degreeChord([1, 3, 5]).inversion(2)
        .build()
        
      const notes = (clip.operations[0] as any).operations.map((n: any) => n.note)
      expect(notes).toEqual(['G4', 'C5', 'E5'])
    })


  })
})
