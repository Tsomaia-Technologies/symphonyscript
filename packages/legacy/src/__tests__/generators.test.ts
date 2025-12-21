import {Clip as ClipFactory, compile, Instrument, session, Track} from '@symphonyscript/core'
import {NoteOnEvent} from '../compiler/types'
import {euclidean, patternToString, rotatePattern} from '@symphonyscript/core/generators/euclidean'

describe('Generators: Arpeggiator', () => {

  // Helper to get notes from a compiled clip
  function getNotes(clipBuilder: any): string[] {
    const s = session().add(Track.from(clipBuilder, Instrument.synth('Arp')))
    const {output} = compile(s)
    return output.timeline
      .filter((e): e is NoteOnEvent => e.kind === 'note_on')
      .map(e => e.note)
  }

  describe('Patterns', () => {
    const pitches: any[] = ['C4', 'E4', 'G4'] // Common triad

    it('should generate "up" pattern', () => {
      const clip = ClipFactory.melody('Up').arpeggio(pitches, '4n', {pattern: 'up'})
      expect(getNotes(clip)).toEqual(['C4', 'E4', 'G4'])
    })

    it('should generate "down" pattern', () => {
      const clip = ClipFactory.melody('Down').arpeggio(pitches, '4n', {pattern: 'down'})
      expect(getNotes(clip)).toEqual(['G4', 'E4', 'C4'])
    })

    it('should generate "upDown" pattern', () => {
      // C E G -> C E G E (inclusive bottom, exclusive top usually, but code says generic)
      // Code: 1 2 3 -> 1 2 3 2.
      const clip = ClipFactory.melody('UpDown').arpeggio(pitches, '4n', {pattern: 'upDown'})
      expect(getNotes(clip)).toEqual(['C4', 'E4', 'G4', 'E4'])
    })

    it('should generate "downUp" pattern', () => {
      // C E G -> G E C E
      const clip = ClipFactory.melody('DownUp').arpeggio(pitches, '4n', {pattern: 'downUp'})
      expect(getNotes(clip)).toEqual(['G4', 'E4', 'C4', 'E4'])
    })

    it('should generate "converge" pattern', () => {
      // C E G B -> C B E G (Low, High, Low+1, High-1)
      const props: any = ['C4', 'E4', 'G4', 'B4']
      const clip = ClipFactory.melody('Conv').arpeggio(props, '4n', {pattern: 'converge'})
      expect(getNotes(clip)).toEqual(['C4', 'B4', 'E4', 'G4'])
    })

    it('should generate "diverge" pattern', () => {
      // C E G B -> Mid...
      // array length 4. mid = floor(3/2) = 1. index 1 is E4.
      // l=1, r=2.
      // E4 (not emitted if even?), wait code:
      // if odd: push mid.
      // loop: r<len push r, l>=0 push l.
      // r=2(G4), l=1(E4).
      // r=3(B4), l=0(C4).
      // Result: G4 E4 B4 C4.
      const props: any = ['C4', 'E4', 'G4', 'B4']
      const clip = ClipFactory.melody('Div').arpeggio(props, '4n', {pattern: 'diverge'})
      expect(getNotes(clip)).toEqual(['G4', 'E4', 'B4', 'C4'])
    })

    it('should generate "random" pattern', () => {
      // Random is non-deterministic. We check if all notes belong to input set and count matches.
      const clip = ClipFactory.melody('Rnd').arpeggio(pitches, '4n', {pattern: 'random'})
      const result = getNotes(clip)
      expect(result.length).toBe(3)
      result.forEach(n => expect(pitches).toContain(n))
    })
  })

  describe('Options', () => {
    it('should expand octaves', () => {
      // C4, octaves: 2 -> C4, C5
      const clip = ClipFactory.melody('Oct').arpeggio(['C4'] as any, '4n', {pattern: 'up', octaves: 2})
      expect(getNotes(clip)).toEqual(['C4', 'C5'])
    })

    it('should apply gate to note durations', () => {
      // 4n at 120bpm = 0.5s. Gate 0.5 => 0.25s duration.
      const clip = ClipFactory.melody('Gate').arpeggio(['C4'] as any, '4n', {pattern: 'up', gate: 0.5})

      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const {output} = compile(s)

      const note = output.timeline.find((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(note).toBeDefined()
      expect(note?.duration).toBeCloseTo(0.25)
    })


    it('should produce identical random patterns with same seed', () => {
      const pitches: any = ['C4', 'E4', 'G4', 'B4', 'D5']
      const clip1 = ClipFactory.melody('Arp1').arpeggio(pitches, '16n', {pattern: 'random', seed: 12345})
      const clip2 = ClipFactory.melody('Arp2').arpeggio(pitches, '16n', {pattern: 'random', seed: 12345})
      expect(getNotes(clip1)).toEqual(getNotes(clip2))
    })

    it('should produce different random patterns with different seeds', () => {
      const pitches: any = ['C4', 'E4', 'G4', 'B4', 'D5']
      const clip1 = ClipFactory.melody('Arp1').arpeggio(pitches, '16n', {pattern: 'random', seed: 12345})
      const clip2 = ClipFactory.melody('Arp2').arpeggio(pitches, '16n', {pattern: 'random', seed: 67890})
      expect(getNotes(clip1)).not.toEqual(getNotes(clip2))
    })
  })
})

describe('Euclidean Rhythms', () => {
  describe('Algorithm', () => {
    it('should generate tresillo (3,8)', () => {
      const pattern = euclidean(3, 8)
      expect(patternToString(pattern)).toBe('x--x--x-')
    })

    it('should generate cinquillo (5,8)', () => {
      const pattern = euclidean(5, 8)
      expect(patternToString(pattern)).toBe('x-xx-xx-')
    })

    it('should handle edge case: all hits', () => {
      const pattern = euclidean(4, 4)
      expect(patternToString(pattern)).toBe('xxxx')
    })

    it('should handle edge case: no hits', () => {
      const pattern = euclidean(0, 4)
      expect(patternToString(pattern)).toBe('----')
    })

    it('should rotate pattern correctly', () => {
      const pattern = euclidean(3, 8)
      const rotated = rotatePattern(pattern, 1)
      expect(patternToString(rotated)).toBe('-x--x--x')
    })
  })

  describe('Integration', () => {
    it('should integrate with DrumBuilder', () => {
      const clip = ClipFactory.drums('EuclideanDrums')
        .euclidean({hits: 3, steps: 8, note: 'Kick'})
        .build()

      // Should produce 3 notes and 5 rests (total 8 steps)
      const notes = clip.operations.filter(op => op.kind === 'note')
      const rests = clip.operations.filter(op => op.kind === 'rest')
      expect(notes.length).toBe(3)
      expect(rests.length).toBe(5)

      // Verify sequence for tresillo: x--x--x-
      // Ops: Note(Kick), Rest, Rest, Note(Kick), Rest, Rest, Note(Kick), Rest
      expect(clip.operations[0].kind).toBe('note')
      expect(clip.operations[1].kind).toBe('rest')
      expect(clip.operations[2].kind).toBe('rest')
      expect(clip.operations[3].kind).toBe('note')
    })

    it('should integrate with MelodyBuilder', () => {
      const clip = ClipFactory.melody('EuclideanMelody')
        .euclidean({
          hits: 5,
          steps: 8,
          notes: ['C4', 'E4'] as any
        })
        .build()

      // 5 hits, 3 rests.
      const notes = clip.operations.filter(op => op.kind === 'note')
      expect(notes.length).toBe(5)

      // Check cycling notes
      // Pattern x-xx-xx-
      // 0: x (C4)
      // 1: -
      // 2: x (E4)
      // 3: x (C4)
      // 4: -
      // 5: x (E4)
      // 6: x (C4)
      // 7: -

      const noteOps = notes as any[]
      expect(noteOps[0].note).toBe('C4')
      expect(noteOps[1].note).toBe('E4')
      expect(noteOps[2].note).toBe('C4')
      expect(noteOps[3].note).toBe('E4')
    })
  })
})
