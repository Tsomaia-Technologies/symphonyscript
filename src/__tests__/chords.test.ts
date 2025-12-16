import { parseChordCode } from '../chords/parser'
import { chordToNotes } from '../chords/resolver'

describe('Chord Parser', () => {
  it('parses major triad', () => {
    const parsed = parseChordCode('C')
    expect(parsed.root).toBe('C')
    expect(parsed.quality).toBe('maj')
    expect(parsed.intervals).toEqual([0, 4, 7])
  })

  it('parses minor seventh', () => {
    const parsed = parseChordCode('Cm7')
    expect(parsed.root).toBe('C')
    expect(parsed.quality).toBe('m7')
    expect(parsed.intervals).toEqual([0, 3, 7, 10])
  })

  it('parses sharps and flats', () => {
    expect(parseChordCode('F#maj7').root).toBe('F#')
    expect(parseChordCode('Bbdim').root).toBe('Bb')
  })

  it('parses alternative codes', () => {
    // Delta
    expect(parseChordCode('CΔ').quality).toBe('maj7')
    expect(parseChordCode('CΔ7').quality).toBe('maj7')
    // Minus
    expect(parseChordCode('C-7').quality).toBe('m7')
    expect(parseChordCode('Cmin7').quality).toBe('m7')
    // Circle
    expect(parseChordCode('C°').quality).toBe('dim')
  })

  it('parses empty suffix as major triad', () => {
    const parsed = parseChordCode('G')
    expect(parsed.quality).toBe('maj')
    expect(parsed.definition.intervals).toEqual([0, 4, 7])
  })

  it('throws on invalid root', () => {
    // 'H' does not match the regex ^([A-G][#b]?), so it throws format error
    expect(() => parseChordCode('Hmaj7')).toThrow(/Invalid chord code format/)
  })

  it('throws on invalid quality', () => {
    expect(() => parseChordCode('Cfoo')).toThrow(/Unknown chord quality/)
  })
})

describe('Chord Resolver', () => {
  it('resolves C major in octave 4', () => {
    const notes = chordToNotes('C', 4)
    expect(notes).toEqual(['C4', 'E4', 'G4'])
  })

  it('resolves Am7 in octave 3', () => {
    const notes = chordToNotes('Am7', 3)
    // A3, C4, E4, G4.
    // Intervals: 0, 3, 7, 10.
    // A3(57) + 3 = 60(C4). + 7 = 64(E4). + 10 = 67(G4).
    expect(notes).toEqual(['A3', 'C4', 'E4', 'G4'])
  })



  it('resolves complex altered chord', () => {
    // C7alt: [0, 4, 6, 10, 13, 15, 18, 20]
    // C4(60).
    // E4(64), Gb4(66), Bb4(70), Db5(73), D#5(75), F#5(78), Ab5(80)
    // Note names might vary by enharmonic spelling in midiToNote?
    // midiToNote uses sharps/flats based on index but hardcoded array?
    // src/util/midi.ts:
    // NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    // So Gb becomes F#. Bb becomes A#. Db becomes C#. Ab becomes G#.
    // This is a known limitation or feature of simple MIDI conversion.
    // Test expects the MIDI names.
    const notes = chordToNotes('C7alt', 4)
    expect(notes).toEqual([
      'C4', 'E4', 'F#4', 'A#4', 'C#5', 'D#5', 'F#5', 'G#5'
    ])
  })
})
