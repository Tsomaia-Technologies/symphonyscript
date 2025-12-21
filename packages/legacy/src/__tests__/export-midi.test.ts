// =============================================================================
// SymphonyScript - MIDI Export Tests
// =============================================================================

import { Clip, compile, Instrument, session, Track, ClipNode, NoteOp } from '@symphonyscript/core'
import { exportMidi } from '../export/midi'
import { parseMidiBuffer, MidiNoteOnEvent, MidiNoteOffEvent, MidiMetaEvent, MidiPitchBendEvent, META_SET_TEMPO, META_TIME_SIGNATURE } from '../import/midi-parser'
import { writeVLQ, bpmToMicrosPerBeat, noteNameToMidi } from '../export/midi-utils'
import { compileClip } from '../compiler/pipeline'
import { importMidiAsClip } from '../import/midi'

describe('MIDI Export', () => {
  describe('VLQ Encoding', () => {
    it('encodes zero correctly', () => {
      const result = writeVLQ(0)
      expect(Array.from(result)).toEqual([0x00])
    })

    it('encodes single byte values (< 128)', () => {
      expect(Array.from(writeVLQ(0x7F))).toEqual([0x7F])
      expect(Array.from(writeVLQ(0x40))).toEqual([0x40])
      expect(Array.from(writeVLQ(1))).toEqual([0x01])
    })

    it('encodes two byte values', () => {
      expect(Array.from(writeVLQ(0x80))).toEqual([0x81, 0x00])
      expect(Array.from(writeVLQ(0x3FFF))).toEqual([0xFF, 0x7F])
    })

    it('encodes larger values', () => {
      // 0x100000 = 1048576 requires 3 bytes
      expect(Array.from(writeVLQ(0x100000))).toEqual([0xC0, 0x80, 0x00])
    })
  })

  describe('Basic Export', () => {
    it('exports a single note clip', () => {
      const clip = Clip.melody('SingleNote')
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)

      expect(result.buffer).toBeInstanceOf(ArrayBuffer)
      expect(result.trackCount).toBeGreaterThan(0)
      expect(result.ppq).toBe(480)

      // Parse the exported MIDI and verify
      const parsed = parseMidiBuffer(result.buffer)
      expect(parsed.format).toBe(1)
      expect(parsed.ppq).toBe(480)
    })

    it('exports notes with correct MIDI note numbers', () => {
      const clip = Clip.melody('Notes')
        .note('C4', '4n')  // MIDI 60
        .note('E4', '4n')  // MIDI 64
        .note('G4', '4n')  // MIDI 67
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      // Find note events
      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)

      expect(noteOnEvents.length).toBe(3)
      expect(noteOnEvents[0].note).toBe(60) // C4
      expect(noteOnEvents[1].note).toBe(64) // E4
      expect(noteOnEvents[2].note).toBe(67) // G4
    })

    it('exports sharps and flats correctly', () => {
      const clip = Clip.melody('Accidentals')
        .note('C#4', '4n')  // MIDI 61
        .note('Bb3', '4n')  // MIDI 58
        .note('F#5', '4n')  // MIDI 78
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)

      expect(noteOnEvents.length).toBe(3)
      expect(noteOnEvents[0].note).toBe(61) // C#4
      expect(noteOnEvents[1].note).toBe(58) // Bb3
      expect(noteOnEvents[2].note).toBe(78) // F#5
    })

    it('exports note on and note off pairs', () => {
      const clip = Clip.melody('NoteOnOff')
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent | MidiNoteOffEvent =>
          e.type === 'note_on' || e.type === 'note_off')

      // Should have note on and note off
      const noteOns = noteEvents.filter(e => e.type === 'note_on' && (e as MidiNoteOnEvent).velocity > 0)
      const noteOffs = noteEvents.filter(e => e.type === 'note_off' || (e.type === 'note_on' && (e as MidiNoteOnEvent).velocity === 0))

      expect(noteOns.length).toBe(1)
      expect(noteOffs.length).toBe(1)
    })
  })

  describe('Timing', () => {
    it('exports notes with correct tick positions', () => {
      const clip = Clip.melody('Timing')
        .note('C4', '4n')  // Beat 0-1
        .note('D4', '4n')  // Beat 1-2
        .note('E4', '4n')  // Beat 2-3
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled, { ppq: 480 })
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)
        .sort((a, b) => a.tick - b.tick)

      expect(noteOnEvents.length).toBe(3)
      expect(noteOnEvents[0].tick).toBe(0)        // Beat 0
      expect(noteOnEvents[1].tick).toBe(480)      // Beat 1
      expect(noteOnEvents[2].tick).toBe(960)      // Beat 2
    })

    it('exports eighth notes with correct timing', () => {
      const clip = Clip.melody('EighthNotes')
        .note('C4', '8n')
        .note('D4', '8n')
        .note('E4', '8n')
        .note('F4', '8n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled, { ppq: 480 })
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)
        .sort((a, b) => a.tick - b.tick)

      expect(noteOnEvents.length).toBe(4)
      expect(noteOnEvents[0].tick).toBe(0)
      expect(noteOnEvents[1].tick).toBe(240)   // 0.5 beats
      expect(noteOnEvents[2].tick).toBe(480)   // 1 beat
      expect(noteOnEvents[3].tick).toBe(720)   // 1.5 beats
    })
  })

  describe('Velocity', () => {
    it('exports velocity correctly', () => {
      const clip = Clip.melody('Velocity')
        .note('C4', '4n').velocity(0.79) // ~100 MIDI
        .note('D4', '4n').velocity(0.39) // ~50 MIDI
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)
        .sort((a, b) => a.tick - b.tick)

      expect(noteOnEvents.length).toBe(2)
      expect(noteOnEvents[0].velocity).toBe(100) // 0.79 * 127 ≈ 100
      expect(noteOnEvents[1].velocity).toBe(50)  // 0.39 * 127 ≈ 50
    })
  })

  describe('Detune', () => {
    it('exports detune as pitch bend event', () => {
      const clip = Clip.melody('Detune')
        .note('C4', '4n').detune(100) // +100 cents = +0.5 semitone
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const pitchBends = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiPitchBendEvent => e.type === 'pitch_bend')

      expect(pitchBends.length).toBeGreaterThan(0)
      // First bend should be above center (8192) for positive detune
      expect(pitchBends[0].value).toBeGreaterThan(8192)
    })

    it('exports negative detune correctly', () => {
      const clip = Clip.melody('NegativeDetune')
        .note('C4', '4n').detune(-100) // -100 cents
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const pitchBends = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiPitchBendEvent => e.type === 'pitch_bend')

      expect(pitchBends.length).toBeGreaterThan(0)
      // First bend should be below center (8192) for negative detune
      expect(pitchBends[0].value).toBeLessThan(8192)
    })

    it('resets pitch bend after detuned note', () => {
      const clip = Clip.melody('DetuneReset')
        .note('C4', '4n').detune(100)
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const pitchBends = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiPitchBendEvent => e.type === 'pitch_bend')

      // Should have at least 2 pitch bend events: set and reset
      expect(pitchBends.length).toBeGreaterThanOrEqual(2)
      // Last pitch bend should be center (8192) - reset
      expect(pitchBends[pitchBends.length - 1].value).toBe(8192)
    })
  })

  describe('Tempo', () => {
    it('exports initial tempo as meta event', () => {
      const clip = Clip.melody('Tempo')
        .tempo(140)
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 140 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      // Find tempo meta events
      const tempoEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiMetaEvent => e.type === 'meta' && e.metaType === META_SET_TEMPO)

      expect(tempoEvents.length).toBeGreaterThan(0)

      // Verify tempo value (microseconds per beat)
      const firstTempo = tempoEvents[0]
      const microsPerBeat = (firstTempo.data[0] << 16) | (firstTempo.data[1] << 8) | firstTempo.data[2]
      const bpm = 60_000_000 / microsPerBeat

      // Should be close to 140 BPM
      expect(Math.round(bpm)).toBe(140)
    })

    it('exports tempo changes', () => {
      const clip = Clip.melody('TempoChange')
        .tempo(120)
        .note('C4', '4n')
        .tempo(140)
        .note('D4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const tempoEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiMetaEvent => e.type === 'meta' && e.metaType === META_SET_TEMPO)

      // Should have at least 2 tempo events (initial + change)
      expect(tempoEvents.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Time Signature', () => {
    it('exports time signature meta event', () => {
      const clip = Clip.melody('TimeSig')
        .timeSignature('3/4')
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120, timeSignature: '3/4' })
      const result = exportMidi(compiled, { includeTimeSignatures: true })
      const parsed = parseMidiBuffer(result.buffer)

      const timeSigEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiMetaEvent => e.type === 'meta' && e.metaType === META_TIME_SIGNATURE)

      expect(timeSigEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Multi-track Session', () => {
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

      const mySession = session({ tempo: 120 })
        .add(Track.from(pianoClip, piano))
        .add(Track.from(bassClip, bass))

      const { output } = compile(mySession)
      const result = exportMidi(output, { format: 1 })
      const parsed = parseMidiBuffer(result.buffer)

      // Format 1: conductor track + instrument tracks
      expect(parsed.format).toBe(1)
      expect(parsed.trackCount).toBeGreaterThanOrEqual(2)
    })

    it('exports format 0 (single track) when specified', () => {
      const piano = Instrument.synth('Piano')

      const clip = Clip.melody('Piano')
        .note('C4', '4n')
        .note('E4', '4n')
        .build()

      const mySession = session({ tempo: 120 })
        .add(Track.from(clip, piano))

      const { output } = compile(mySession)
      const result = exportMidi(output, { format: 0 })
      const parsed = parseMidiBuffer(result.buffer)

      expect(parsed.format).toBe(0)
      expect(parsed.trackCount).toBe(1)
    })
  })

  describe('PPQ Options', () => {
    it('uses default PPQ of 480', () => {
      const clip = Clip.melody('PPQ')
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)

      expect(result.ppq).toBe(480)
    })

    it('uses custom PPQ when specified', () => {
      const clip = Clip.melody('CustomPPQ')
        .note('C4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled, { ppq: 960 })
      const parsed = parseMidiBuffer(result.buffer)

      expect(result.ppq).toBe(960)
      expect(parsed.ppq).toBe(960)
    })
  })

  describe('Round Trip', () => {
    it('preserves note count in export → import cycle', () => {
      const clip = Clip.melody('RoundTrip')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .note('F4', '4n')
        .note('G4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)

      expect(noteOnEvents.length).toBe(5)
    })

    it('preserves timing relationships in export → import cycle', () => {
      const clip = Clip.melody('TimingRoundTrip')
        .note('C4', '4n')
        .rest('4n')
        .note('E4', '4n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled, { ppq: 480 })
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)
        .sort((a, b) => a.tick - b.tick)

      expect(noteOnEvents.length).toBe(2)
      // First note at tick 0, second at tick 960 (2 beats)
      expect(noteOnEvents[0].tick).toBe(0)
      expect(noteOnEvents[1].tick).toBe(960)
    })

    it('import → export → import produces equivalent notes', () => {
      // Create a simple clip, compile, export to MIDI
      const originalClip = Clip.melody('OriginalClip')
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .build()

      const compiled = compileClip(originalClip, { bpm: 120 })
      const { buffer } = exportMidi(compiled, { ppq: 480 })

      // Import the exported MIDI back
      const { clip: reimported } = importMidiAsClip(buffer)

      // Extract note operations from both
      const originalNotes = originalClip.operations.filter(
        (op): op is NoteOp => op.kind === 'note'
      )
      const reimportedNotes = reimported.operations.filter(
        (op): op is NoteOp => op.kind === 'note'
      )

      // Should have same number of notes
      expect(reimportedNotes.length).toBe(originalNotes.length)

      // Notes should have matching pitches (in order)
      for (let i = 0; i < originalNotes.length; i++) {
        expect(reimportedNotes[i].note).toBe(originalNotes[i].note)
      }
    })
  })

  describe('Edge Cases', () => {
    it('handles empty clip', () => {
      const clip = Clip.melody('Empty').build()
      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)

      expect(result.buffer).toBeInstanceOf(ArrayBuffer)
      expect(result.buffer.byteLength).toBeGreaterThan(0)
    })

    it('handles very short notes', () => {
      const clip = Clip.melody('Short')
        .note('C4', '32n')
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent | MidiNoteOffEvent =>
          e.type === 'note_on' || e.type === 'note_off')

      expect(noteEvents.length).toBeGreaterThanOrEqual(2)
    })

    it('handles chords (stacked notes)', () => {
      const clip = Clip.melody('Chord')
        .stack(s => (s as any)
          .note('C4', '2n')
          .note('E4', '2n')
          .note('G4', '2n')
        )
        .build()

      const compiled = compileClip(clip, { bpm: 120 })
      const result = exportMidi(compiled)
      const parsed = parseMidiBuffer(result.buffer)

      const noteOnEvents = parsed.tracks
        .flatMap(t => t.events)
        .filter((e): e is MidiNoteOnEvent => e.type === 'note_on' && e.velocity > 0)

      // All three notes should be present
      expect(noteOnEvents.length).toBe(3)

      // All at the same tick (chord)
      const firstTick = noteOnEvents[0].tick
      expect(noteOnEvents.every(e => e.tick === firstTick)).toBe(true)
    })
  })
})

describe('MIDI Utility Functions', () => {
  describe('bpmToMicrosPerBeat', () => {
    it('converts BPM to microseconds correctly', () => {
      expect(bpmToMicrosPerBeat(120)).toBe(500000)  // 60M / 120 = 500,000
      expect(bpmToMicrosPerBeat(60)).toBe(1000000)  // 60M / 60 = 1,000,000
      expect(bpmToMicrosPerBeat(140)).toBe(428571)  // ~428,571
    })
  })

  describe('noteNameToMidi', () => {
    it('converts standard notes correctly', () => {
      expect(noteNameToMidi('C4')).toBe(60)
      expect(noteNameToMidi('A4')).toBe(69)
      expect(noteNameToMidi('C0')).toBe(12)
      expect(noteNameToMidi('C-1')).toBe(0)
    })

    it('converts sharps correctly', () => {
      expect(noteNameToMidi('C#4')).toBe(61)
      expect(noteNameToMidi('F#3')).toBe(54)
    })

    it('converts flats to equivalent sharps', () => {
      expect(noteNameToMidi('Db4')).toBe(61)  // Same as C#4
      expect(noteNameToMidi('Bb3')).toBe(58)  // Same as A#3
    })

    it('returns null for invalid notes', () => {
      expect(noteNameToMidi('X4')).toBeNull()
      expect(noteNameToMidi('invalid')).toBeNull()
      expect(noteNameToMidi('')).toBeNull()
    })
  })
})
