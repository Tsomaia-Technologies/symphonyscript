// =============================================================================
// SymphonyScript - Hierarchical Time Signature Tests
// Verifies RFC-016: Clip -> Track -> Session -> Default (4/4)
// =============================================================================

import { Clip, compile, Instrument, session, Track } from '../index'
import { resolveInitialTimeSignature } from '../compiler/timesig-resolver'
import { SCHEMA_VERSION } from '../schema/version'

describe('Hierarchical Time Signature', () => {

  const clip = Clip.melody('Test').note('C4', '4n').build()
  const inst = Instrument.synth('Test')
  const emptySession = { kind: 'session' as const, tracks: [], _version: SCHEMA_VERSION }

  describe('Resolver Logic (Unit)', () => {

    it('should use global default (4/4) when nothing is specified', () => {
      const track = { kind: 'track' as const, clip, instrument: inst, _version: SCHEMA_VERSION }
      const ts = resolveInitialTimeSignature(emptySession, track, clip)
      expect(ts).toBe('4/4')
    })

    it('should use session timeSignature if specified', () => {
      const s = { ...emptySession, timeSignature: '3/4' as const }
      const track = { kind: 'track' as const, clip, instrument: inst, _version: SCHEMA_VERSION }
      const ts = resolveInitialTimeSignature(s, track, clip)
      expect(ts).toBe('3/4')
    })

    it('should allow track timeSignature to override session', () => {
      const s = { ...emptySession, timeSignature: '3/4' as const }
      const track = { kind: 'track' as const, clip, instrument: inst, timeSignature: '7/8' as const, _version: SCHEMA_VERSION }
      const ts = resolveInitialTimeSignature(s, track, clip)
      expect(ts).toBe('7/8')
    })

    it('should allow clip timeSignature operation to override everything', () => {
      const clipWithTS = Clip.melody('TS').timeSignature('5/4').note('C4').build()
      const s = { ...emptySession, timeSignature: '3/4' as const }
      const track = { kind: 'track' as const, clip: clipWithTS, instrument: inst, timeSignature: '7/8' as const, _version: SCHEMA_VERSION }
      
      const ts = resolveInitialTimeSignature(s, track, clipWithTS)
      expect(ts).toBe('5/4')
    })

    it('should ignore mid-clip time signature changes for initial resolution', () => {
      const clipMid = Clip.melody()
        .note('C4')
        .timeSignature('5/4') // Mid-clip
        .note('D4')
        .build()
      
      const s = { ...emptySession, timeSignature: '3/4' as const }
      const track = { kind: 'track' as const, clip: clipMid, instrument: inst, _version: SCHEMA_VERSION }

      const ts = resolveInitialTimeSignature(s, track, clipMid)
      expect(ts).toBe('3/4') // Should fallback to session, ignoring mid-clip '5/4'
    })
  })

  describe('Integration (Compile)', () => {
    
    it('uses global default (4/4)', () => {
      const s = session().add(Track.from(clip, inst))
      const { output } = compile(s)
      expect(output.meta.timeSignature).toBe('4/4')
    })

    it('uses session timeSignature', () => {
      const s = session({ timeSignature: '3/4' }).add(Track.from(clip, inst))
      const { output } = compile(s)
      expect(output.meta.timeSignature).toBe('3/4')
    })

    it('uses track timeSignature override (though meta shows global)', () => {
      // Note: meta.timeSignature shows global/session signature for display.
      // Track-specific signature affects beat calculations (which we can verify if needed, 
      // but resolveInitialTimeSignature unit tests cover the logic).
      // Here we just verify the property propagates.
      
      const t = Track.from(clip, inst, { timeSignature: '7/8' })
      expect(t.build().timeSignature).toBe('7/8')
      
      const s = session().add(t)
      const { output } = compile(s)
      // Meta still reports global default if not set on session
      expect(output.meta.timeSignature).toBe('4/4')
    })

    it('supports legacy compile option as fallback', () => {
      const s = session().add(Track.from(clip, inst))
      const { output } = compile(s, { timeSignature: '9/8' })
      // Meta reports the fallback option
      expect(output.meta.timeSignature).toBe('9/8')
    })
  })
})
