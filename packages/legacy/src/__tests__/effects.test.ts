// =============================================================================
// SymphonyScript - Effects System Tests (RFC-018)
// =============================================================================

import { Clip, compile, Instrument, session, Track, Session } from '@symphonyscript/core'
import type { BusDefinition } from '../compiler/routing-resolver'

describe('Effects System (RFC-018)', () => {
  describe('Track Inserts', () => {
    it('adds insert effect to track routing', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .add(
          Track.from(melody.commit(), synth)
            .insert('delay', { time: '8n', feedback: 0.4 })
        )

      const { output } = compile(s)

      expect(output.routing).toBeDefined()
      expect(output.routing?.tracks[0].inserts).toHaveLength(1)
      expect(output.routing?.tracks[0].inserts[0].type).toBe('delay')
    })

    it('preserves insert order', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .add(
          Track.from(melody.commit(), synth)
            .insert('compressor', { threshold: -20 })
            .insert('eq', { lowGain: 3 })
            .insert('delay', { time: '8n' })
        )

      const { output } = compile(s)

      const inserts = output.routing?.tracks[0].inserts
      expect(inserts).toHaveLength(3)
      expect(inserts?.[0].type).toBe('compressor')
      expect(inserts?.[1].type).toBe('eq')
      expect(inserts?.[2].type).toBe('delay')
    })

    it('resolves delay time to ms at compile time', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      // At 120 BPM, 8n = 0.5 beats = 250ms
      const s = session({ tempo: 120 })
        .add(
          Track.from(melody.commit(), synth)
            .insert('delay', { time: '8n', feedback: 0.4 })
        )

      const { output } = compile(s)

      const delay = output.routing?.tracks[0].inserts[0]
      expect(delay?.type).toBe('delay')
      expect(delay?.params.time).toBe(250) // ms
      expect(delay?.params.feedback).toBe(0.4)
    })

    it('handles empty insert chain (direct connection)', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .add(Track.from(melody.commit(), synth))

      const { output } = compile(s)

      expect(output.routing?.tracks[0].inserts).toEqual([])
    })
  })

  describe('Session Buses', () => {
    it('defines effect bus with .bus()', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .bus('verb', 'reverb', { decay: 2.5, size: 0.8 })
        .add(Track.from(melody.commit(), synth))

      const { output } = compile(s)

      expect(output.routing?.buses).toHaveLength(1)
      expect(output.routing?.buses[0].id).toBe('verb')
      expect(output.routing?.buses[0].effect.type).toBe('reverb')
      expect(output.routing?.buses[0].effect.params.decay).toBe(2.5)
    })

    it('connects track to bus via .send()', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .bus('reverb', 'reverb', { decay: 2 })
        .add(
          Track.from(melody.commit(), synth)
            .send('reverb', 0.4)
        )

      const { output } = compile(s)

      const trackRouting = output.routing?.tracks[0]
      expect(trackRouting?.sends).toHaveLength(1)
      expect(trackRouting?.sends[0]).toEqual({ busId: 'reverb', amount: 0.4 })
    })

    it('warns on send to unknown bus', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .add(
          Track.from(melody.commit(), synth)
            .send('nonexistent', 0.5)
        )

      const { output, warnings } = compile(s)

      // Send should be filtered out
      expect(output.routing?.tracks[0].sends).toHaveLength(0)

      // Warning should be present
      expect(warnings.some(w => w.code === 'SEND_TO_UNKNOWN_BUS')).toBe(true)
    })

    it('clamps send amount to 0-1', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const track = Track.from(melody.commit(), synth)
        .send('reverb', 1.5)  // Over max
        .send('delay', -0.5)  // Under min

      // Access internal sends array through build()
      const trackNode = track.build()
      expect(trackNode.sends?.[0].amount).toBe(1.0)  // Clamped to max
      expect(trackNode.sends?.[1].amount).toBe(0.0)  // Clamped to min
    })

    it('throws on duplicate bus ID', () => {
      expect(() => {
        session()
          .bus('verb', 'reverb', { decay: 2 })
          .bus('verb', 'delay', { time: '8n' })  // Duplicate!
      }).toThrow(/Duplicate bus ID/)
    })
  })

  describe('Compiled Routing', () => {
    it('outputs routing graph in compile result', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .bus('reverb', 'reverb', { decay: 2 })
        .add(
          Track.from(melody.commit(), synth)
            .insert('distortion', { drive: 0.3 })
            .send('reverb', 0.4)
        )

      const { output } = compile(s)

      expect(output.routing).toBeDefined()
      expect(output.routing?.tracks).toBeDefined()
      expect(output.routing?.buses).toBeDefined()
    })

    it('resolves tempo-synced delay times in buses', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      // At 140 BPM, 16n = 0.25 beats = 107.14ms
      const s = session({ tempo: 140 })
        .bus('slapback', 'delay', { time: '16n', feedback: 0.2 })
        .add(Track.from(melody.commit(), synth))

      const { output } = compile(s)

      const slapback = output.routing?.buses.find((b: BusDefinition) => b.id === 'slapback')
      // 60000 / 140 = 428.57ms per beat, * 0.25 = 107.14ms
      expect(slapback?.effect.params.time).toBeCloseTo(107.14, 1)
    })

    it('includes all tracks and buses', () => {
      const drums = Clip.drums('Drums').kick()
      const bass = Clip.melody('Bass').note('E2', '4n')
      const lead = Clip.melody('Lead').note('C5', '4n')
      
      const kit = Instrument.sampler('Kit')
      const bassInst = Instrument.synth('Bass')
      const leadInst = Instrument.synth('Lead')

      const s = session()
        .bus('room', 'reverb', { decay: 1.5 })
        .bus('slapback', 'delay', { time: 100 })
        .add(Track.from(drums.commit(), kit))
        .add(Track.from(bass.commit(), bassInst).send('room', 0.1))
        .add(Track.from(lead.commit(), leadInst).send('room', 0.4).send('slapback', 0.2))

      const { output } = compile(s)

      expect(output.routing?.tracks).toHaveLength(3)
      expect(output.routing?.buses).toHaveLength(2)
    })
  })

  describe('Breaking Changes', () => {
    it('sendBus() method does not exist', () => {
      const s = session()
      
      // TypeScript would catch this at compile time, but we can also
      // verify at runtime that the method doesn't exist
      expect((s as any).sendBus).toBeUndefined()
    })

    it('auxBus() method does not exist', () => {
      const s = session()
      
      expect((s as any).auxBus).toBeUndefined()
    })

    it('legacy buses property not in output.meta', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      const s = session()
        .bus('reverb', 'reverb', { decay: 2 })
        .add(Track.from(melody.commit(), synth))

      const { output } = compile(s)

      // meta.buses should not exist (TypeScript already prevents this)
      expect((output.meta as any).buses).toBeUndefined()
    })
  })

  describe('Type Safety', () => {
    it('provides type-safe effect params', () => {
      const melody = Clip.melody('Test').note('C4', '4n')
      const synth = Instrument.synth('Lead')

      // These should all compile without type errors
      const track = Track.from(melody.commit(), synth)
        .insert('delay', { time: '8n', feedback: 0.4, pingPong: true })
        .insert('reverb', { decay: 2.5, size: 0.8, damping: 0.6 })
        .insert('distortion', { drive: 0.3, type: 'tube' })
        .insert('filter', { type: 'lowpass', frequency: 2000, resonance: 2 })
        .insert('compressor', { threshold: -20, ratio: 4, attack: 10 })

      const trackNode = track.build()
      expect(trackNode.inserts).toHaveLength(5)
    })

    it('defines buses with type-safe params', () => {
      // These should all compile without type errors
      const s = session()
        .bus('verb', 'reverb', { decay: 2.5, size: 0.8 })
        .bus('dly', 'delay', { time: '8n', feedback: 0.4 })
        .bus('comp', 'compressor', { ratio: 4, threshold: -12 })
        .bus('dist', 'distortion', { drive: 0.5, type: 'fuzz' })
        .bus('flt', 'filter', { type: 'highpass', frequency: 500 })

      const sessionNode = s.build()
      expect(sessionNode.effectBuses).toHaveLength(5)
    })
  })
})
