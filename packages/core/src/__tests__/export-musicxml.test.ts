// =============================================================================
// SymphonyScript - MusicXML Export Tests
// =============================================================================

import { Clip, Instrument, session, Track } from '../index'
import { exportMusicXML } from '../export/musicxml'

describe('MusicXML Export', () => {
  describe('Basic Structure', () => {
    it('generates valid XML declaration', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(result.xml).toContain('<!DOCTYPE score-partwise')
    })

    it('generates score-partwise root element', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<score-partwise version="3.1">')
      expect(result.xml).toContain('</score-partwise>')
    })

    it('includes work title', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { title: 'My Symphony' })

      expect(result.xml).toContain('<work-title>My Symphony</work-title>')
    })

    it('includes creator', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { creator: 'John Doe' })

      expect(result.xml).toContain('<creator type="composer">John Doe</creator>')
    })

    it('includes software identification', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<software>SymphonyScript</software>')
    })
  })

  describe('Part List', () => {
    it('generates part-list with single part', () => {
      const clip = Clip.melody('Piano')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<part-list>')
      expect(result.xml).toContain('<score-part id="P1">')
      expect(result.xml).toContain('<part-name>Piano</part-name>')
      expect(result.xml).toContain('</part-list>')
      expect(result.partCount).toBe(1)
    })

    it('generates multiple parts from session', () => {
      const piano = Instrument.synth('Piano')
      const bass = Instrument.synth('Bass')

      const pianoClip = Clip.melody('Piano Part')
        .note('C4', '4n')
        .build()

      const bassClip = Clip.melody('Bass Part')
        .note('C2', '4n')
        .build()

      const mySession = session({ tempo: 120 })
        .add(Track.from(pianoClip, piano, { name: 'Piano' }))
        .add(Track.from(bassClip, bass, { name: 'Bass' }))

      const result = exportMusicXML(mySession.build())

      expect(result.xml).toContain('<score-part id="P1">')
      expect(result.xml).toContain('<score-part id="P2">')
      expect(result.partCount).toBe(2)
    })

    it('uses custom part names from options', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, {
        partNames: { 'P1': 'Violin I' }
      })

      expect(result.xml).toContain('<part-name>Violin I</part-name>')
    })
  })

  describe('Pitch Encoding', () => {
    it('encodes natural notes correctly', () => {
      const clip = Clip.melody('Naturals')
        .note('C4', '4n')
        .note('D5', '4n')
        .note('E3', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<step>C</step>')
      expect(result.xml).toContain('<octave>4</octave>')
      expect(result.xml).toContain('<step>D</step>')
      expect(result.xml).toContain('<octave>5</octave>')
      expect(result.xml).toContain('<step>E</step>')
      expect(result.xml).toContain('<octave>3</octave>')
    })

    it('encodes sharps with alter', () => {
      const clip = Clip.melody('Sharps')
        .note('C#4', '4n')
        .note('F#5', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<step>C</step>')
      expect(result.xml).toContain('<alter>1</alter>')
      expect(result.xml).toContain('<step>F</step>')
    })

    it('encodes flats with negative alter', () => {
      const clip = Clip.melody('Flats')
        .note('Bb3', '4n')
        .note('Eb4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<step>B</step>')
      expect(result.xml).toContain('<alter>-1</alter>')
      expect(result.xml).toContain('<step>E</step>')
    })
  })

  describe('Duration Encoding', () => {
    it('encodes quarter notes', () => {
      const clip = Clip.melody('Quarter')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { divisions: 4 })

      expect(result.xml).toContain('<duration>4</duration>')
      expect(result.xml).toContain('<type>quarter</type>')
    })

    it('encodes half notes', () => {
      const clip = Clip.melody('Half')
        .note('C4', '2n')
        .build()

      const result = exportMusicXML(clip, { divisions: 4 })

      expect(result.xml).toContain('<duration>8</duration>')
      expect(result.xml).toContain('<type>half</type>')
    })

    it('encodes eighth notes', () => {
      const clip = Clip.melody('Eighth')
        .note('C4', '8n')
        .build()

      const result = exportMusicXML(clip, { divisions: 4 })

      expect(result.xml).toContain('<duration>2</duration>')
      expect(result.xml).toContain('<type>eighth</type>')
    })

    it('encodes sixteenth notes', () => {
      const clip = Clip.melody('Sixteenth')
        .note('C4', '16n')
        .build()

      const result = exportMusicXML(clip, { divisions: 4 })

      expect(result.xml).toContain('<duration>1</duration>')
      expect(result.xml).toContain('<type>16th</type>')
    })

    it('exports triplet notes with time-modification', () => {
      const clip = Clip.melody('Triplet')
        .note('C4', '8t')
        .note('D4', '8t')
        .note('E4', '8t')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<time-modification>')
      expect(result.xml).toContain('<actual-notes>3</actual-notes>')
      expect(result.xml).toContain('<normal-notes>2</normal-notes>')
      expect(result.xml).toContain('<type>eighth</type>')
    })

    it('exports quarter triplets correctly', () => {
      const clip = Clip.melody('QuarterTriplet')
        .note('C4', '4t')
        .note('D4', '4t')
        .note('E4', '4t')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<time-modification>')
      expect(result.xml).toContain('<type>quarter</type>')
    })

    it('encodes whole notes', () => {
      const clip = Clip.melody('Whole')
        .note('C4', '1n')
        .build()

      const result = exportMusicXML(clip, { divisions: 4 })

      expect(result.xml).toContain('<duration>16</duration>')
      expect(result.xml).toContain('<type>whole</type>')
    })
  })

  describe('Rests', () => {
    it('encodes rests correctly', () => {
      const clip = Clip.melody('WithRest')
        .note('C4', '4n')
        .rest('4n')
        .note('E4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<rest/>')
      expect(result.xml).toMatch(/<note>[\s\S]*<rest\/>[\s\S]*<\/note>/)
    })

    it('fills empty measures with whole rest', () => {
      const clip = Clip.melody('Empty')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<rest measure="yes"/>')
    })
  })

  describe('Chords (Stacks)', () => {
    it('encodes stacked notes as chords', () => {
      const clip = Clip.melody('Chord')
        .stack(s => (s as any)
          .note('C4', '2n')
          .note('E4', '2n')
          .note('G4', '2n')
        )
        .build()

      const result = exportMusicXML(clip)

      // First note should not have <chord/>
      // Subsequent notes should have <chord/>
      const chordMarkers = (result.xml.match(/<chord\/>/g) || []).length
      expect(chordMarkers).toBe(2) // E4 and G4 have chord markers
    })
  })

  describe('Ties', () => {
    it('encodes tie start', () => {
      const clip = Clip.melody('TieStart')
        .note('C4', '4n').tie('start')
        .note('C4', '4n').tie('end')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<tie type="start"/>')
      expect(result.xml).toContain('<tied type="start"/>')
    })

    it('encodes tie end', () => {
      const clip = Clip.melody('TieEnd')
        .note('C4', '4n').tie('start')
        .note('C4', '4n').tie('end')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<tie type="stop"/>')
      expect(result.xml).toContain('<tied type="stop"/>')
    })
  })

  describe('Articulations', () => {
    it('encodes staccato articulation', () => {
      const clip = Clip.melody('Staccato')
        .note('C4', '4n').staccato()
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<articulations>')
      expect(result.xml).toContain('<staccato/>')
      expect(result.xml).toContain('</articulations>')
    })

    it('encodes accent articulation', () => {
      const clip = Clip.melody('Accent')
        .note('C4', '4n').accent()
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<accent/>')
    })

    it('encodes tenuto articulation', () => {
      const clip = Clip.melody('Tenuto')
        .note('C4', '4n').tenuto()
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<tenuto/>')
    })

    it('encodes marcato articulation', () => {
      const clip = Clip.melody('Marcato')
        .note('C4', '4n').marcato()
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<strong-accent type="up"/>')
    })
  })

  describe('Time Signature', () => {
    it('encodes 4/4 time signature', () => {
      const clip = Clip.melody('FourFour')
        .timeSignature('4/4')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<time>')
      expect(result.xml).toContain('<beats>4</beats>')
      expect(result.xml).toContain('<beat-type>4</beat-type>')
      expect(result.xml).toContain('</time>')
    })

    it('encodes 3/4 time signature', () => {
      const clip = Clip.melody('ThreeFour')
        .timeSignature('3/4')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<beats>3</beats>')
      expect(result.xml).toContain('<beat-type>4</beat-type>')
    })

    it('encodes 6/8 time signature', () => {
      const clip = Clip.melody('SixEight')
        .timeSignature('6/8')
        .note('C4', '8n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<beats>6</beats>')
      expect(result.xml).toContain('<beat-type>8</beat-type>')
    })
  })

  describe('Tempo', () => {
    it('includes tempo metronome marking', () => {
      const clip = Clip.melody('WithTempo')
        .tempo(120)
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { includeTempo: true })

      expect(result.xml).toContain('<metronome>')
      expect(result.xml).toContain('<beat-unit>quarter</beat-unit>')
      expect(result.xml).toContain('<per-minute>120</per-minute>')
      expect(result.xml).toContain('</metronome>')
    })

    it('excludes tempo when option is false', () => {
      const clip = Clip.melody('NoTempo')
        .tempo(120)
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { includeTempo: false })

      expect(result.xml).not.toContain('<metronome>')
    })
  })

  describe('Measures', () => {
    it('creates correct number of measures', () => {
      // 4 quarter notes = 1 measure in 4/4
      const clip = Clip.melody('OneMeasure')
        .timeSignature('4/4')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .note('F4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.measureCount).toBe(1)
      expect(result.xml).toContain('<measure number="1">')
    })

    it('creates multiple measures when notes exceed one measure', () => {
      // 8 quarter notes = 2 measures in 4/4
      const clip = Clip.melody('TwoMeasures')
        .timeSignature('4/4')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .note('F4', '4n')
        .note('G4', '4n')
        .note('A4', '4n')
        .note('B4', '4n')
        .note('C5', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.measureCount).toBe(2)
      expect(result.xml).toContain('<measure number="1">')
      expect(result.xml).toContain('<measure number="2">')
    })
  })

  describe('Clef', () => {
    it('includes treble clef in first measure', () => {
      const clip = Clip.melody('WithClef')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<clef>')
      expect(result.xml).toContain('<sign>G</sign>')
      expect(result.xml).toContain('<line>2</line>')
      expect(result.xml).toContain('</clef>')
    })
  })

  describe('Divisions', () => {
    it('uses default divisions of 4', () => {
      const clip = Clip.melody('DefaultDivisions')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<divisions>4</divisions>')
    })

    it('uses custom divisions from options', () => {
      const clip = Clip.melody('CustomDivisions')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { divisions: 8 })

      expect(result.xml).toContain('<divisions>8</divisions>')
    })
  })

  describe('Loops', () => {
    it('expands loops into repeated notes', () => {
      const clip = Clip.melody('Loop')
        .loop(2, b => b.note('C4', '4n').commit() as any)
        .build()

      const result = exportMusicXML(clip)

      // Should have 2 C4 notes
      const noteMatches = result.xml.match(/<step>C<\/step>/g) || []
      expect(noteMatches.length).toBe(2)
    })
  })

  describe('Transposition', () => {
    it('handles transposed notes correctly', () => {
      // The transpose() method in MelodyBuilder applies transposition to subsequent notes
      // So after transpose(2), a note('C4') will be stored as C4 in the AST
      // but the builder applies transposition when creating the NoteOp
      const clip = Clip.melody('Transposed')
        .transpose(2) // Up a whole step - this affects the note pitch stored
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip)

      // The transposition is applied by the builder, so the note is stored as D4
      // (C4 + 2 semitones = D4)
      expect(result.xml).toContain('<step>D</step>')
      expect(result.xml).toContain('<octave>4</octave>')
    })
  })

  describe('Session Export', () => {
    it('exports session with multiple tracks', () => {
      const piano = Instrument.synth('Piano')
      const bass = Instrument.synth('Bass')

      const pianoClip = Clip.melody('Piano')
        .note('C4', '4n')
        .note('E4', '4n')
        .build()

      const bassClip = Clip.melody('Bass')
        .note('C2', '2n')
        .build()

      const mySession = session({ tempo: 120, timeSignature: '4/4' })
        .add(Track.from(pianoClip, piano))
        .add(Track.from(bassClip, bass))

      const result = exportMusicXML(mySession.build())

      expect(result.partCount).toBe(2)
      expect(result.xml).toContain('<part id="P1">')
      expect(result.xml).toContain('<part id="P2">')
    })
  })

  describe('XML Escaping', () => {
    it('escapes special characters in title', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { title: 'Rock & Roll' })

      expect(result.xml).toContain('Rock &amp; Roll')
    })

    it('escapes angle brackets in creator', () => {
      const clip = Clip.melody('Test')
        .note('C4', '4n')
        .build()

      const result = exportMusicXML(clip, { creator: 'Test <User>' })

      expect(result.xml).toContain('Test &lt;User&gt;')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty clip', () => {
      const clip = Clip.melody('Empty').build()

      const result = exportMusicXML(clip)

      expect(result.xml).toBeDefined()
      expect(result.measureCount).toBe(1)
    })

    it('handles very short notes', () => {
      const clip = Clip.melody('Short')
        .note('C4', '32n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<type>32nd</type>')
    })

    it('handles low octaves', () => {
      const clip = Clip.melody('Low')
        .note('C1', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<octave>1</octave>')
    })

    it('handles high octaves', () => {
      const clip = Clip.melody('High')
        .note('C8', '4n')
        .build()

      const result = exportMusicXML(clip)

      expect(result.xml).toContain('<octave>8</octave>')
    })
  })
})
