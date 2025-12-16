// =============================================================================
// SymphonyScript - Hierarchical Tempo Tests
// Verifies RFC-015: Clip -> Track -> Session -> Default
// =============================================================================

import { Clip, compile, Instrument, session, Track } from '../index'
import { NoteOnEvent } from '../compiler/types'
import { resolveInitialTempo } from '../compiler/tempo-resolver'
import { SCHEMA_VERSION } from '../schema/version'

describe('Hierarchical Tempo Inheritance', () => {

  const clip = Clip.melody('Test').note('C4', '4n').build()
  const inst = Instrument.synth('Test')

  describe('Resolver Logic (Unit)', () => {
    const emptySession = { kind: 'session' as const, tracks: [], _version: SCHEMA_VERSION }

    it('should use global default (120) when nothing is specified', () => {
      const track = { kind: 'track' as const, clip, instrument: inst, _version: SCHEMA_VERSION }
      const tempo = resolveInitialTempo(emptySession, track, clip)
      expect(tempo).toBe(120)
    })

    it('should use session tempo if specified', () => {
      const s = { ...emptySession, tempo: 140 }
      const track = { kind: 'track' as const, clip, instrument: inst, _version: SCHEMA_VERSION }
      const tempo = resolveInitialTempo(s, track, clip)
      expect(tempo).toBe(140)
    })

    it('should allow track tempo to override session tempo', () => {
      const s = { ...emptySession, tempo: 140 }
      const track = { kind: 'track' as const, clip, instrument: inst, tempo: 160, _version: SCHEMA_VERSION }
      const tempo = resolveInitialTempo(s, track, clip)
      expect(tempo).toBe(160)
    })

    it('should allow clip tempo operation to override everything', () => {
      const clipWithTempo = Clip.melody('Tempo').tempo(180).note('C4').build()
      const s = { ...emptySession, tempo: 140 }
      const track = { kind: 'track' as const, clip: clipWithTempo, instrument: inst, tempo: 160, _version: SCHEMA_VERSION }

      const tempo = resolveInitialTempo(s, track, clipWithTempo)
      expect(tempo).toBe(180)
    })

    it('should ignore mid-clip tempo changes when resolving initial tempo', () => {
      // This clip plays notes first, THEN changes tempo — the tempo(60) is NOT the initial tempo
      const clipWithMidTempo = Clip.melody('MidTempo')
        .note('D4', '4n')  // <- Played at inherited tempo
        .note('C4', '4n')  // <- Also inherited
        .tempo(60)         // <- Mid-clip change, not initial
        .note('G4', '4n')  // <- Played at 60
        .build()
      
      const s = { ...emptySession, tempo: 140 }
      const track = { kind: 'track' as const, clip: clipWithMidTempo, instrument: inst, _version: SCHEMA_VERSION }

      const tempo = resolveInitialTempo(s, track, clipWithMidTempo)
      // Should fall back to session tempo (140), NOT use the mid-clip tempo(60)
      expect(tempo).toBe(140)
    })
  })

  describe('Integration (Compile)', () => {
    it('uses fallback 120 BPM when no tempo is set', () => {
      const s = session().add(Track.from(clip, inst))
      const { output } = compile(s)
      
      expect(output.meta.bpm).toBe(120) // Default fallback reported in meta if session.tempo undefined
      
      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // 120 bpm = 0.5s per beat
      expect(note.duration).toBeCloseTo(0.5)
    })

    it('uses session-level tempo', () => {
      const s = session({ tempo: 100 }).add(Track.from(clip, inst)) // 100 bpm = 0.6s per beat
      const { output } = compile(s)
      
      expect(output.meta.bpm).toBe(100)
      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      expect(note.duration).toBeCloseTo(0.6)
    })

    it('overrides session tempo at track level', () => {
      const s = session({ tempo: 60 }) // 1s per beat
        .add(Track.from(clip, inst, { tempo: 120 })) // 0.5s per beat (override)

      const { output } = compile(s)
      
      expect(output.meta.bpm).toBe(60)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      expect(note.duration).toBeCloseTo(0.5) // Track runs at 120
    })

    it('overrides track tempo at clip level', () => {
      const fastClip = Clip.melody('Fast').tempo(240).note('C4', '4n').build()
      
      const s = session({ tempo: 60 })
        .add(Track.from(fastClip, inst, { tempo: 120 }))

      const { output } = compile(s)
      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      
      // 240 bpm = 0.25s per beat
      expect(note.duration).toBeCloseTo(0.25)
    })

    it('supports mixed tempos in same session', () => {
      const slowIdx = Track.from(clip, inst, { tempo: 60 }) // 1s
      const fastIdx = Track.from(clip, inst, { tempo: 120 }) // 0.5s

      const s = session().add(slowIdx).add(fastIdx)
      const { output } = compile(s)

      const notes = output.timeline.filter(e => e.kind === 'note_on') as NoteOnEvent[]
      // First track notes
      expect(notes[0].duration).toBeCloseTo(1.0)
      // Second track notes (might be interleaved or appended depending on sort, but duration is invariant)
      expect(notes[1].duration).toBeCloseTo(0.5)
    })
  })
})
