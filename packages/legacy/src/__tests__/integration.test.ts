import { Clip, compile, Instrument, session, Track, ClipNode } from '@symphonyscript/core'
import { estimateExpansion, expandClip, ExpansionError } from '../compiler/pipeline'

describe('Integration: Hello World', () => {
  it('should compile a complex full session without errors', () => {
    // 1. Define Instruments
    const kick = Instrument.synth('Kick_Drum')
      .osc('square')
      .attack(0.01)
      .release(0.2)
      .pan(-0.2)

    const bass = Instrument.synth('Bass_Synth')
      .osc('sawtooth')
      .attack(0.05)
      .release(0.5)
      .volume(0.8)

    const piano = Instrument.synth('Piano')
      .osc('sine')
      .attack(0.02)
      .release(1.5)

    // 2. Define Clips
    // Use .build() to get ClipNode, ensuring clean composition
    const beat = Clip.drums('Basic_Beat')
      .kick()
      .rest('8n')
      .hat()
      .snare()
      .rest('8n')
      .hat()
      .build()

    const bassRiff = Clip.melody('Bass_Riff')
      .note('C2', '8n').staccato()
      .rest('8n')
      .note('E2', '8n').staccato()
      .rest('8n')
      .note('G2', '4n').legato()
      .build()

    const keysPart = (Clip.keys('Keys_Chords')
      .sustain()
      .chord(['C4', 'E4', 'G4'] as any, '2n')
      .chord(['F4', 'A4', 'C5'] as any, '2n').commit() as any)
      .release()
      .build()

    const stringMelody = (Clip.strings('String_Lead')
      .note('G4', '4n').commit() as any)
      .bend(2)
      .note('A4', '2n').legato() // Returns Cursor
      .commit() // Returns MelodyBuilder -> Cast to Any to call bendReset methods
      .bendReset()
      .build()

    // 3. Structure
    const intro = Clip.create('Intro')
      .tempo(120)
      .timeSignature('4/4')
      .loop(2, b => b.play(beat))

    // 4. Tracks
    const drumTrack = Track.from(intro, kick)
    const bassTrack = Track.from(
      Clip.create('Bass_Line').loop(2, b => b.play(bassRiff)),
      bass
    )
    const keysTrack = Track.from(keysPart, piano)
    const stringTrack = Track.from(stringMelody, Instrument.synth('Violin').osc('sawtooth'))

    // 5. Session
    const mySession = session({ tempo: 120 })
      .add(drumTrack)
      .add(bassTrack)
      .add(keysTrack)
      .add(stringTrack)

    // 6. Compile
    const { output, warnings } = compile(mySession, { timeSignature: '4/4' })

    // Assertions
    expect(output).toBeDefined()
    expect(output.timeline.length).toBeGreaterThan(0)
    expect(output.meta.durationSeconds).toBeGreaterThan(0)
    expect(output.meta.timeSignature).toBe('4/4')
    expect(output.meta.tempoChanges.length).toBeGreaterThanOrEqual(1)

    // Manifest Check
    const manifestKeys = Object.keys(output.manifest)
    expect(manifestKeys.length).toBeGreaterThan(0)

    // No validation errors expected for this valid song
    const errors = warnings.filter(w => w.level === 'error')
    expect(errors).toHaveLength(0)
  })
})

describe('Expansion Bounds', () => {
  describe('maxOperations', () => {
    it('throws when operation count exceeded', () => {
      const deepClip = Clip.melody()
        .loop(200, b => b.loop(200, b => (b.note('C4', '16n').commit() as any)))
        .build()

      expect(() => expandClip(deepClip, { maxOperations: 1000 }))
        .toThrow(ExpansionError)
    })

    it('throws at exactly maxOperations (fence-post fix)', () => {
      // Create clip with exactly 10 notes
      let builder = Clip.melody()
      for (let i = 0; i < 10; i++) {
        builder = builder.note('C4', '4n').commit() as any
      }
      const clip = builder.build()
      
      // Should throw at exactly 10
      expect(() => expandClip(clip, { maxOperations: 10 }))
        .toThrow(ExpansionError)
    })

    it('error includes operation count', () => {
      const deepClip = Clip.melody()
        .loop(50, b => b.loop(50, b => (b.note('C4', '16n').commit() as any)))
        .build()

      try {
        expandClip(deepClip, { maxOperations: 1000 })
        fail('Should have thrown')
      } catch (e: any) {
        expect(e).toBeInstanceOf(ExpansionError)
        expect((e as ExpansionError).limitType).toBe('operations')
        expect(e.message).toContain('1000')
      }
    })
  })

  describe('estimateExpansion', () => {
    it('estimates simple clip', () => {
      const clip = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .build()

      const estimate = estimateExpansion(clip)
      expect(estimate.estimatedOperations).toBe(2)
    })

    it('estimates nested loops', () => {
      const clip = Clip.melody()
        .loop(10, b => b.loop(10, b => (b.note('C4', '16n').commit() as any)))
        .build()

      const estimate = estimateExpansion(clip)
      expect(estimate.estimatedOperations).toBe(100)
    })

    it('warns about large loops', () => {
      const clip = Clip.melody()
        .loop(500, b => (b.note('C4', '16n').commit() as any))
        .build()

      const estimate = estimateExpansion(clip)
      expect(estimate.warnings.length).toBeGreaterThan(0)
      expect(estimate.warnings[0]).toContain('500')
    })

    describe('Determinism', () => {
      it('produces identical output with same seed', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .humanize({ timing: 100 }) // Massive timing variance
          .build() // Cursor needs build or commit

        const session1 = session().add(Track.from(clip, Instrument.synth('test')))

        const res1 = compile(session1, { seed: 12345 })
        const res2 = compile(session1, { seed: 12345 })

        expect(res1.output.timeline[0].time).toBe(res2.output.timeline[0].time)
      })

      it('produces different output with different seeds', () => {
        const clip = Clip.melody()
          .note('C4', '4n')
          .humanize({ timing: 100 })
          .build()

        const session1 = session().add(Track.from(clip, Instrument.synth('test')))

        const res1 = compile(session1, { seed: 12345 })
        const res2 = compile(session1, { seed: 67890 })

        expect(res1.output.timeline[0].time).not.toBe(res2.output.timeline[0].time)
      })
      it('handles deeply nested clips without stack overflow', () => {
        // Create clip with 2500 nested levels (well beyond normal stack limit)
        let clip: ClipNode = {
          _version: '1.0.0',
          kind: 'clip',
          name: 'leaf',
          operations: [{ kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }]
        }

        for (let i = 0; i < 2500; i++) {
          clip = {
            _version: '1.0.0',
            kind: 'clip',
            name: `level-${i}`,
            operations: [{ kind: 'clip', clip }]
          }
        }

        // Should not throw RangeError
        const estimate = estimateExpansion(clip)
        // Depth is 2500 levels + 1 for the leaf
        expect(estimate.estimatedDepth).toBeGreaterThanOrEqual(2500)
        expect(estimate.estimatedOperations).toBe(1)
      })

      it('handles stack operations correctly', () => {
        const clip: ClipNode = {
          _version: '1.0.0',
          kind: 'clip',
          name: 'stack-test',
          operations: [{
            kind: 'stack',
            operations: [
              { kind: 'note', note: 'C4' as any, duration: '1n', velocity: 1 },
              { kind: 'note', note: 'E4' as any, duration: '1n', velocity: 1 },
              { kind: 'note', note: 'G4' as any, duration: '1n', velocity: 1 }
            ]
          }]
        }
        const estimate = estimateExpansion(clip)
        expect(estimate.estimatedOperations).toBe(3)
      })
    })
  })
})

// =============================================================================
// RFC-026: Projection Architecture Tests
// =============================================================================

import { compileClipV2 } from '../compiler/projections'
import { compileClip } from '../compiler/pipeline'

describe('Projection Architecture (RFC-026)', () => {
  describe('compileClipV2 equivalence', () => {
    it('produces identical output for simple clip', () => {
      const clip = Clip.melody('Simple')
        .note('C4', '4n')
        .note('E4', '4n')
        .note('G4', '4n')
        .build()

      const options = { bpm: 120, timeSignature: '4/4' as const }
      
      const v1Result = compileClip(clip, options)
      const v2Result = compileClipV2(clip, options)

      // Events should be identical
      expect(v2Result.events.length).toBe(v1Result.events.length)
      expect(v2Result.durationSeconds).toBe(v1Result.durationSeconds)
      expect(v2Result.durationBeats).toBe(v1Result.durationBeats)
    })

    it('produces identical output for complex clip with loops', () => {
      const clip = Clip.melody('Complex')
        .loop(2, b => b
          .note('C4', '8n')
          .note('E4', '8n')
          .commit() as any
        )
        .build()

      const options = { bpm: 120 }
      
      const v1Result = compileClip(clip, options)
      const v2Result = compileClipV2(clip, options)

      expect(v2Result.events.length).toBe(v1Result.events.length)
      expect(v2Result.durationBeats).toBe(v1Result.durationBeats)
    })

    it('produces identical output for clip with stacks', () => {
      const clip = Clip.melody('Stacked')
        .stack(s => (s as any)
          .note('C4', '2n')
          .note('E4', '2n')
          .note('G4', '2n')
        )
        .build()

      const options = { bpm: 120 }
      
      const v1Result = compileClip(clip, options)
      const v2Result = compileClipV2(clip, options)

      expect(v2Result.events.length).toBe(v1Result.events.length)
    })

    it('produces identical output for clip with ties', () => {
      const clip = Clip.melody('Tied')
        .note('C4', '4n').tie('start')
        .note('C4', '4n').tie('end')
        .build()

      const options = { bpm: 120 }
      
      const v1Result = compileClip(clip, options)
      const v2Result = compileClipV2(clip, options)

      // Should have 1 coalesced note
      expect(v2Result.events.length).toBe(v1Result.events.length)
    })
  })
})
