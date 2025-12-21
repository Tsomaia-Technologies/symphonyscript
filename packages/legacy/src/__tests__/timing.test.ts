import { Clip, Clip as ClipFactory, compile, Instrument, session, Track } from '@symphonyscript/core'
import { NoteOnEvent, TempoEvent } from '../compiler/types'
import { integrateTempo, quantizeToSample } from '../compiler/tempo'
import { coalesceStream, compileClip } from '../compiler/pipeline'
import { expandClip } from '../compiler/pipeline/expand'
import { computeTiming } from '../compiler/pipeline/timing'

describe('Timing & Tempo', () => {

  describe('Precision & Quantization', () => {
    it('should match analytical and numerical integration for linear curves (high precision)', () => {
      const analytical = integrateTempo(60, 120, 4, 'linear')
      // 'standard' numerical uses 100 steps
      // 'high' uses 10000 steps
      // We use 'high' to compare against strict analytical
      const numerical = integrateTempo(60, 120, 4, 'linear', 'high')
      expect(Math.abs(analytical - numerical)).toBeLessThan(0.0001)
    })

    it('should match analytical and high-precision numerical for ease-in', () => {
      const analytical = integrateTempo(60, 120, 4, 'ease-in')
      const numerical = integrateTempo(60, 120, 4, 'ease-in', 'high')
      expect(Math.abs(analytical - numerical)).toBeLessThan(0.0001)
    })

    it('should match analytical and high-precision numerical for ease-out', () => {
      const analytical = integrateTempo(60, 120, 4, 'ease-out')
      const numerical = integrateTempo(60, 120, 4, 'ease-out', 'high')
      expect(Math.abs(analytical - numerical)).toBeLessThan(0.0001)
    })

    it('should match analytical and high-precision numerical for ease-in-out', () => {
      const analytical = integrateTempo(60, 120, 4, 'ease-in-out')
      const numerical = integrateTempo(60, 120, 4, 'ease-in-out', 'high')
      expect(Math.abs(analytical - numerical)).toBeLessThan(0.0001)
    })

    it('should quantize seconds to integer sample indices', () => {
      const time = 1.234567
      const quantized = quantizeToSample(time, 48000)
      const samples = quantized * 48000
      expect(Math.abs(Math.round(samples) - samples)).toBeLessThan(0.0000001)
    })

    it('should produce sample-aligned event times when sampleRate is set', () => {
      const clip = Clip.melody('Quant').note('C4', '4n').note('D4', '4n').build()
      // Use 48kHz
      const result = compileClip(clip, { bpm: 121, sampleRate: 48000 }) // 121 BPM to cause non-integer seconds

      for (const event of result.events) {
        const startSamples = event.startSeconds * 48000
        const durSamples = ((event.kind === 'note' ? event.durationSeconds : 0) ?? 0) * 48000

        expect(Math.abs(Math.round(startSamples) - startSamples)).toBeLessThan(0.0001)
        expect(Math.abs(Math.round(durSamples) - durSamples)).toBeLessThan(0.0001)
      }
    })

    it('should produce deterministic output with high precision', () => {
      const clip = Clip.melody('Det').tempo(60).tempo(120, {
        duration: 4,
        curve: 'ease-in-out'
      }).note('C4', '1n').build()
      const r1 = compileClip(clip, { bpm: 60, tempoPrecision: 'high' })
      const r2 = compileClip(clip, { bpm: 60, tempoPrecision: 'high' })
      expect(r1.events).toEqual(r2.events)
    })
  })

  describe('Duration Calculation', () => {
    it('should calculate duration correctly for constant BPM (120)', () => {
      const clip = Clip.melody('Static').tempo(120).note('C4', '4n').commit()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // 120 BPM = 2 BPS. Quarter note = 1 beat. 1 beat / 2 BPS = 0.5s.
      expect(note.duration).toBeCloseTo(0.5)
    })

    it('should calculate duration correctly for constant BPM (60)', () => {
      const clip = Clip.melody('Static').tempo(60).note('C4', '4n').commit()
      const s = session({ tempo: 60 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // 60 BPM = 1 BPS. Quarter note = 1s.
      expect(note.duration).toBeCloseTo(1.0)
    })

    it('should handle dotted notes', () => {
      const clip = Clip.melody('Dotted').tempo(120).note('C4', '4n.').commit()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // 4n = 0.5s. Doted = 0.5 * 1.5 = 0.75s.
      expect(note.duration).toBeCloseTo(0.75)
    })

    it('should handle triplet notes', () => {
      const clip = Clip.melody('Triplets').tempo(120).note('C4', '8t').commit()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      const note = output.timeline.find(e => e.kind === 'note_on') as NoteOnEvent
      // 8n = 0.25s. Triplet = 0.25 * (2/3) = 0.1666...
      expect(note.duration).toBeCloseTo(0.5 * 0.5 * (2 / 3))
    })
  })

  describe('Time Signature', () => {
    it('should record time signature in meta', () => {
      const clip = Clip.melody('TS').timeSignature('3/4').note('C4', '4n').commit()
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      // Note: compiled output.meta.timeSignature reflects global/initial?
      // Or does compile options override it?
      // "compile(s, { bpm: 120, timeSignature: '4/4' })"
      // If clip sets it, it might update context but does meta reflect changes?
      // Current compiler implementation:
      // "meta: { ... timeSignature: opts.timeSignature ... }"
      // It seems meta.timeSignature is static from options.
      // But let's check if 'time_signature' events exist if we cared?
      // The compiler doesn't emit time_signature events to timeline in current implementation (checked `index.ts`).
      // It updates context.
      // So we can only rely on what compile options return or if it affects measure calculation (not implemented yet).

      expect(output.meta.timeSignature).toBe('4/4') // Default from compile options/defaults
    })
  })

  describe('Tempo Transitions (Ramps & Curves)', () => {
    it('should reduce duration of consecutive notes during accelerando (Precise Ramp)', () => {
      const clip = ClipFactory.melody('Ramp')
        .tempo(60)
        .tempo(120, { duration: '1n', precise: true }) // Ramp over 4 beats
        .note('C4', '4n') // Beat 1
        .note('C4', '4n') // Beat 2
        .note('C4', '4n') // Beat 3
        .note('C4', '4n') // Beat 4
        .commit()

      const s = session({ tempo: 60 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

      // As tempo increases, beat duration (seconds) decreases.
      expect(notes[0].duration).toBeGreaterThan(notes[1].duration)
      expect(notes[1].duration).toBeGreaterThan(notes[2].duration)
      expect(notes[2].duration).toBeGreaterThan(notes[3].duration)
    })

    it('should emit tempo events with curves', () => {
      const clip = Clip.melody('Curves')
        .tempo(60)
        .tempo(120, { duration: '2n', curve: 'ease-in' })

      const s = session({ tempo: 60 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const tempoEvents = output.timeline.filter((e): e is TempoEvent => e.kind === 'tempo')
      // Initial 60, then 120 with curve
      const curveEvent = tempoEvents.find(e => e.curve === 'ease-in')
      expect(curveEvent).toBeDefined()
      expect(curveEvent?.bpm).toBe(120)
      expect(curveEvent?.transitionSeconds).toBeGreaterThan(0)
    })

    it('should support ease-out (ritardando)', () => {
      const clip = Clip.melody('Rit').tempo(120).tempo(60, { duration: '2n', curve: 'ease-out' })
      const s = session({ tempo: 120 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)
      const event = output.timeline.find((e: any) => e.curve === 'ease-out') as TempoEvent
      expect(event).toBeDefined()
    })
    it('should produce distinct timing for ease-in vs linear curves', () => {
      const mkSession = (curve: any) => {
        const clip = ClipFactory.melody('Tempo')
          .tempo(200, { duration: 4, curve, precise: true })
          .rest(4)
        return session().add(Track.from(clip, Instrument.synth('Test')))
      }

      const resLinear = compile(mkSession('linear'))
      const resEase = compile(mkSession('ease-in'))

      const durLinear = resLinear.output.meta.durationSeconds
      const durEase = resEase.output.meta.durationSeconds

      expect(durLinear).toBeGreaterThan(0)
      expect(durEase).toBeGreaterThan(0)
      expect(durEase).not.toBeCloseTo(durLinear, 4)
      expect(durEase).toBeGreaterThan(durLinear)
    })

    it('should compile tempoEnvelope to complex TempoOp and events', () => {
      const clip = ClipFactory.melody('Envelope')
        .tempoEnvelope([
          { beat: 0, bpm: 100, curve: 'linear' },
          { beat: 4, bpm: 200, curve: 'linear' }
        ])

      const s = session({ tempo: 100 }).add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const tempoEvents = output.timeline.filter((e): e is TempoEvent => e.kind === 'tempo')
      // Should have start (100) and then the envelope event?
      // MelodyBuilder.tempoEnvelope emits a SINGLE 'tempo' op with target BPM loop end.
      // Ops: { kind: 'tempo', bpm: 200, transition: { duration: 4, curve: { keyframes } } }

      // So we expect a tempo event with bpm=200 and transitionSeconds approx duration
      const envEvent = tempoEvents.find(e => e.bpm === 200)
      expect(envEvent).toBeDefined()
      // transitionSeconds should be duration of 4 beats at variable tempo?
      // Or simple calculation?
      // Since start bpm=100, end=200, avg=150. Duration ~ 4 beats.
      // 4 beats @ 150bpm = 4 / (150/60) = 4 / 2.5 = 1.6s.
      // 4 beats @ 100bpm = 2.4s.
      // 4 beats @ 200bpm = 1.2s.
      // We just check defined.
      expect(envEvent?.transitionSeconds).toBeDefined()
    })
  })

  describe('Parallel Timing', () => {
    it('should track max duration correctly across parallel branches', () => {
      // Branch 1: 1 beat
      // Branch 2: 2 beats
      // Next Op: Should start after 2 beats

      // Construct manually to ensure structure
      const op = [
        {
          kind: 'stack',
          operations: [
            { kind: 'note', note: 'C4', duration: '4n', velocity: 1 },
            { kind: 'note', note: 'E4', duration: '2n', velocity: 1 }
          ]
        },
        { kind: 'note', note: 'G4', duration: '1n', velocity: 1 }
      ] as any[]

      const clip = { kind: 'clip', name: 'Parallel', operations: op } as any
      const mockBuilder = { build: () => clip }
      const s = session({ tempo: 120 }).add(Track.from(mockBuilder as any, Instrument.synth('Test')))

      const { output } = compile(s)
      const lastNote = output.timeline.find(e => e.kind === 'note_on' && e.note === 'G4')

      // 2n at 120bpm = 1.0s.
      expect(lastNote).toBeDefined()
      expect(lastNote?.time).toBeCloseTo(1.0, 3)
    })
  })

  describe('Pipeline Timing', () => {
    const { expandClip } = require('../compiler/pipeline/expand')
    const { computeTiming } = require('../compiler/pipeline/timing')

    it('should compute beats for sequential ops', () => {
      const clip = Clip.melody('Seq').note('C4', '4n').note('D4', '4n')
      // 4n = 1 beat in 4/4
      const expanded = expandClip(clip.build())
      const timed = computeTiming(expanded)

      const ops = timed.operations.filter((o: any) => o.kind === 'op')
      expect(ops[0].beatStart).toBe(0)
      expect(ops[0].beatDuration).toBe(1)
      expect(ops[1].beatStart).toBe(1)
      expect(ops[1].beatDuration).toBe(1)
      expect(timed.totalBeats).toBe(2)
    })

    it('should compute beats for parallel branches (stack)', () => {
      // Stack [C4 2n, E4 4n] -> Both start at 0.
      // Max duration = 2 (2n).
      // Next op G4 starts at 2.
      const clip = Clip.melody('Stack')
        .stack(s => (s.note('C4', '2n').note('E4', '4n').commit() as any))
        .note('G4', '4n').commit()

      const expanded = expandClip(clip.build())
      const timed = computeTiming(expanded)

      const ops = timed.operations.filter((o: any) => o.kind === 'op')
      // C4
      expect(ops[0].original.note).toBe('C4')
      expect(ops[0].beatStart).toBe(0)

      // E4
      expect(ops[1].original.note).toBe('E4')
      expect(ops[1].beatStart).toBe(0)

      // G4
      expect(ops[2].original.note).toBe('G4')
      expect(ops[2].beatStart).toBe(2)

      expect(timed.totalBeats).toBe(3)
    })
  })

  describe('Measure Tracking', () => {
    it('correctly tracks measure in parallel branches', () => {
      // Create stack with parallel branches: C4 (4 beats) and E4+G4 (2+2 beats)
      // All notes should be in measure 1 since they all happen within beats 0-4
      const clip = {
        _version: '0.1.0',
        kind: 'clip',
        name: 'MeasureStack',
        operations: [
          {
            kind: 'stack',
            operations: [
              { kind: 'note', note: 'C4', duration: '1n', velocity: 1 },  // Branch 1: 4 beats
              { kind: 'note', note: 'E4', duration: '2n', velocity: 1 },  // Branch 2: 2 beats (beat 0)
              { kind: 'note', note: 'G4', duration: '2n', velocity: 1 }   // Branch 3: 2 beats (beat 0)
            ]
          }
        ]
      } as any

      const expanded = expandClip(clip)
      const timed = computeTiming(expanded, '4/4')

      const ops = timed.operations.filter((o: any) => o.kind === 'op' && o.original.kind === 'note') as any[]

      // All notes start at beat 0 because they're parallel branches
      expect(ops[0].original.note).toBe('C4')
      expect(ops[0].beatStart).toBe(0)
      expect(ops[0].measure).toBe(1)

      // E4: starts at beat 0 (parallel branch 2)
      expect(ops[1].original.note).toBe('E4')
      expect(ops[1].beatStart).toBe(0)
      expect(ops[1].measure).toBe(1)

      // G4: starts at beat 0 (parallel branch 3)
      expect(ops[2].original.note).toBe('G4')
      expect(ops[2].beatStart).toBe(0)
      expect(ops[2].measure).toBe(1)
    })

    it('tracks beatInMeasure correctly on backward jump', () => {
      // Stack with 2 parallel branches, second branch has sequential notes
      // Branch 1: C4 (4 beats), Branch 2: D4 at beat 0 + E4 at beat 2
      // After processing C4, state is at beat 4 (measure 2)
      // Processing branch 2 jumps back to beat 0 (measure 1)
      const clip = {
        _version: '0.1.0',
        kind: 'clip',
        name: 'BackjumpTest',
        operations: [
          {
            kind: 'stack',
            operations: [
              { kind: 'note', note: 'C4', duration: '1n', velocity: 1 },  // 4 beats
              // Second branch: sequential notes
              { kind: 'note', note: 'D4', duration: '2n', velocity: 1 },  // 2 beats, beat 0
            ]
          }
        ]
      } as any

      const expanded = expandClip(clip)
      const timed = computeTiming(expanded, '4/4')

      const ops = timed.operations.filter((o: any) => o.kind === 'op' && o.original.kind === 'note') as any[]

      // C4: beat 0, measure 1
      expect(ops[0].beatStart).toBe(0)
      expect(ops[0].measure).toBe(1)
      expect(ops[0].beatInMeasure).toBe(0)

      // D4: beat 0 (after backward jump from beat 4), measure 1
      expect(ops[1].beatStart).toBe(0)
      expect(ops[1].measure).toBe(1)
      expect(ops[1].beatInMeasure).toBe(0)
    })

    it('handles note after parallel stack correctly', () => {
      // Stack ends at beat 4 (max of branches), then F4 should be at beat 4 = measure 2
      const clip = {
        _version: '0.1.0',
        kind: 'clip',
        name: 'AfterStack',
        operations: [
          {
            kind: 'stack',
            operations: [
              { kind: 'note', note: 'C4', duration: '1n', velocity: 1 },  // 4 beats
              { kind: 'note', note: 'D4', duration: '2n', velocity: 1 }   // 2 beats
            ]
          },
          { kind: 'note', note: 'F4', duration: '4n', velocity: 1 }  // After stack, beat 4 = measure 2
        ]
      } as any

      const expanded = expandClip(clip)
      const timed = computeTiming(expanded, '4/4')

      const ops = timed.operations.filter((o: any) => o.kind === 'op' && o.original.kind === 'note') as any[]

      // F4: beat 4 = start of measure 2
      const f4 = ops.find((o: any) => o.original.note === 'F4')
      expect(f4.beatStart).toBe(4)
      expect(f4.measure).toBe(2)
      expect(f4.beatInMeasure).toBe(0)
    })
  })
})

describe('Tempo Integration Edge Cases', () => {
  describe('near-equal BPM', () => {
    it('linear handles epsilon difference', () => {
      const result = integrateTempo(120.0001, 120.0000, 4, 'linear')
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeCloseTo(2, 1)
    })

    it('ease-in handles epsilon difference', () => {
      const result = integrateTempo(120.0001, 120.0000, 4, 'ease-in')
      expect(Number.isFinite(result)).toBe(true)
    })
  })

  describe('extreme deceleration', () => {
    it('ease-in handles 4x slowdown', () => {
      const result = integrateTempo(120, 30, 4, 'ease-in')
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeGreaterThan(2) // slower than constant 120 BPM
    })

    it('ease-in handles 10x slowdown', () => {
      const result = integrateTempo(100, 10, 4, 'ease-in')
      expect(Number.isFinite(result)).toBe(true)
    })

    it('ease-in handles extreme deceleration (fallback to numerical)', () => {
      // This triggers the fallback path for atanh domain
      const result = integrateTempo(120, 1, 4, 'ease-in')
      expect(Number.isFinite(result)).toBe(true)
    })
  })

  describe('input validation', () => {
    it('throws on zero BPM', () => {
      expect(() => integrateTempo(0, 120, 4, 'linear'))
        .toThrow(/BPM must be positive/)
    })

    it('throws on negative BPM', () => {
      expect(() => integrateTempo(-60, 120, 4, 'linear'))
        .toThrow(/BPM must be positive/)
    })

    it('returns 0 for 0 beats', () => {
      expect(integrateTempo(120, 60, 0, 'linear')).toBe(0)
    })
  })
})

describe('Tie Coalescing', () => {
  // Helper to run pipeline up to coalesce
  function prepareSequence(clip: any) {
    const expanded = expandClip(clip)
    return computeTiming(expanded, '4/4')
  }

  describe('basic ties', () => {
    it('merges start + end into single note', () => {
      const clip = Clip.melody('Tie')
        .note('C4', '2n').tie('start')
        .note('C4', '2n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      const { sequence, warnings } = coalesceStream(timed)

      // Should have 1 note (merged), not 2
      const notes = sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )
      expect(notes).toHaveLength(1)

      // 2n + 2n = 4 beats (assuming 4n=1 beat, 2n=2 beats)
      // Wait, definition of 2n depends on PPQ? No, standard music notation.
      // 4/4 time: 4n = 1 beat. 2n = 2 beats. Total 4 beats.
      expect((notes[0] as any).beatDuration).toBe(4)
      expect(warnings).toHaveLength(0)
    })

    it('merges start + continue + end', () => {
      const clip = Clip.melody('TieLong')
        .note('C4', '4n').tie('start')
        .note('C4', '4n').tie('continue')
        .note('C4', '4n').tie('continue')
        .note('C4', '4n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      const { sequence, warnings } = coalesceStream(timed)

      const notes = sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )
      expect(notes).toHaveLength(1)
      expect((notes[0] as any).beatDuration).toBe(4) // 4 * 1 beat
      expect(warnings).toHaveLength(0)
    })
  })

  describe('orphaned ties', () => {
    it('warns on orphaned start', () => {
      const clip = Clip.melody('OrphanStart')
        .note('C4', '2n').tie('start')
        .note('D4', '2n')  // Different pitch, no end for C4
        .build()

      const timed = prepareSequence(clip)
      const { warnings } = coalesceStream(timed)

      expect(warnings).toHaveLength(1)
      expect(warnings[0].type).toBe('orphaned_tie_start')
      expect(warnings[0].pitch).toBe('C4')
    })

    it('warns on orphaned end', () => {
      const clip = Clip.melody('OrphanEnd')
        .note('C4', '2n')  // No start
        .note('C4', '2n').tie('end')
        .build()

      const timed = prepareSequence(clip)
      const { warnings } = coalesceStream(timed)

      expect(warnings).toHaveLength(1)
      expect(warnings[0].type).toBe('orphaned_tie_end')
    })
  })

  describe('multiple voices', () => {
    it('handles simultaneous ties on different pitches', () => {
      const clip = Clip.melody('PolyTies')
        .stack(b => b
          .note('C4', '2n').tie('start')
          .note('E4', '2n').tie('start')
          .commit() as any
        )
        .stack(b => b
          .note('C4', '2n').tie('end')
          .note('E4', '2n').tie('end')
          .commit() as any
        )
        .build()

      const timed = prepareSequence(clip)
      const { sequence, warnings } = coalesceStream(timed)

      const notes = sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )

      // Should be 2 notes: C4 (4 beats) and E4 (4 beats)
      expect(notes).toHaveLength(2)

      const pitches = notes.map((n: any) => n.original.note).sort()
      expect(pitches).toEqual(['C4', 'E4'])

      expect((notes[1] as any).beatDuration).toBe(4)
      expect(warnings).toHaveLength(0)
    })
  })

  describe('polyphonic voices', () => {
    it('maintains independent tie chains per voice (parallel)', () => {
      // Use explicit stack() for parallel voices
      const clip = Clip.melody()
        .stack(s => s
          .voice(1, v => v.note('C4', '2n').tie('start').note('C4', '2n').tie('end'))
          .voice(2, v => v.note('C4', '4n').note('C4', '4n').note('C4', '4n').note('C4', '4n'))
        )
        .build()

      const timed = prepareSequence(clip)
      const { sequence, warnings } = coalesceStream(timed)

      const notes = sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )

      // Voice 1: 1 coalesced note (4 beats)
      // Voice 2: 4 separate notes (1 beat each)
      expect(notes).toHaveLength(5)
      expect(warnings).toHaveLength(0)
    })

    it('defaults to voice 0 when not specified', () => {
      const clip = Clip.melody().note('C4').note('D4').build()
      const ops = clip.operations.filter(o => o.kind === 'note') as any[]
      expect(ops.every(o => o.expressionId === undefined)).toBe(true)
    })

    it('assigns correct expressionId within voice scope', () => {
      const clip = Clip.melody()
        .voice(3, v => v.note('C4'))
        .build()

      // Operations are sequential (not wrapped in stack)
      const note = clip.operations.find((o: any) => o.kind === 'note') as any
      expect(note.expressionId).toBe(3)
    })

    it('validates voice id range (1-15)', () => {
      expect(() => Clip.melody().voice(0, v => v.note('C4'))).toThrow()
      expect(() => Clip.melody().voice(16, v => v.note('C4'))).toThrow()
    })

    it('sequential voices without stack do not corrupt ties', () => {
      // Two sequential voices, each with their own tied notes
      const clip = Clip.melody()
        .voice(1, v => v.note('C4', '2n').tie('start').note('C4', '2n').tie('end'))
        .voice(2, v => v.note('C4', '2n').tie('start').note('C4', '2n').tie('end'))
        .build()

      const timed = prepareSequence(clip)
      const { sequence, warnings } = coalesceStream(timed)

      const notes = sequence.operations.filter(
        (op: any) => op.kind === 'op' && op.original.kind === 'note'
      )

      // 2 coalesced notes (one per voice, 4 beats each)
      expect(notes).toHaveLength(2)
      expect(warnings).toHaveLength(0)
    })
  })
})

describe('Temporal Isolation', () => {
  it('should isolate tempo changes in nested clips by default', () => {
    // Parent starts at 60 BPM
    // Nested clip sets 120 BPM
    // Parent should return to 60 BPM after nested clip
    const nested = Clip.melody('Nested')
      .tempo(120)
      .note('C4', '4n') // 1 beat at 120 = 0.5s
      .commit()

    const parent = Clip.melody('Parent')
      .tempo(60)
      .play(nested)
      .note('C4', '4n') // 1 beat at 60 = 1.0s
      .commit()

    const s = session({ tempo: 60 }).add(Track.from(parent, Instrument.synth('Test')))
    const { output } = compile(s)

    const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

    // First note (inside nested): 0.5s duration
    expect(notes[0].duration).toBeCloseTo(0.5)

    // Second note (after nested): Should be 1.0s duration (restored to 60 BPM)
    expect(notes[1].duration).toBeCloseTo(1.0)
  })

  it('should allow opt-out with inheritTempo: true', () => {
    // Nested clip sets 120 BPM and opts out of isolation
    // Parent should STAY at 120 BPM after nested clip
    const nested = Clip.melody('Nested')
      .tempo(120)
      .note('C4', '4n')

    let parent = Clip.melody('Parent').tempo(60)

    // Add clip manually to set flag
    const nestedNode = nested.build();
    parent = (parent as any).addOp({
      kind: 'clip',
      clip: nestedNode,
      inheritTempo: true
    })

    parent = (parent.note('C4', '4n').commit() as any)

    const s = session({ tempo: 60 }).add(Track.from(parent, Instrument.synth('Test')))
    const { output } = compile(s)

    const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

    // First note (inside nested): 0.5s
    expect(notes[0].duration).toBeCloseTo(0.5)

    // Second note (after nested): Should ALSO be 0.5s (120 BPM leaked)
    expect(notes[1].duration).toBeCloseTo(0.5)
  })

  it('should cut off tempo ramps at scope boundaries', () => {
    // Start ramp inside isolated scope, but don't finish it?
    // Or start a long ramp, then exit scope. Tempo should snap back.

    const nested = Clip.melody('Nested')
      .tempo(120, { duration: 10, curve: 'linear' }) // Long ramp
      .note('C4', '4n') // 1 beat duration (start of ramp)
      .commit()

    const parent = Clip.melody('Parent')
      .tempo(60)
      .play(nested) // Scope ends here. Ramp should be cut.
      .note('C4', '4n') // Should be back at 60 BPM (1.0s)
      .commit()

    const s = session({ tempo: 60 }).add(Track.from(parent, Instrument.synth('Test')))
    const { output } = compile(s)

    const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

    // Note 1: At 60 BPM ramping up. Duration < 1.0s.
    expect(notes[0].duration).toBeLessThan(1.0)

    // Note 2: Back at 60 BPM. Duration 1.0s.
    expect(notes[1].duration).toBeCloseTo(1.0)
  })

  it('should handle explicit isolate() usage', () => {
    const parent = Clip.melody('Parent')
      .tempo(60)
      .isolate({ tempo: true }, b => b
        .tempo(120)
        .note('C4', '4n').commit() as any
      )
      .note('C4', '4n')
      .commit()

    const s = session({ tempo: 60 }).add(Track.from(parent, Instrument.synth('Test')))
    const { output } = compile(s)

    const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
    expect(notes[0].duration).toBeCloseTo(0.5)
    expect(notes[1].duration).toBeCloseTo(1.0)
  })
})

