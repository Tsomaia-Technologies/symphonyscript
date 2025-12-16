import { Clip, compile, Instrument, session, Track } from '../index'
import { NoteOnEvent } from '../compiler/types'
import { MelodyBuilder } from '../clip/MelodyBuilder'

describe('Regressions', () => {

  describe('Phase 1 Fixes', () => {

    it('should handle time conversion across tempo changes correctly', () => {
      const clip = Clip.melody('TempoFix')
        .tempo(120)
        .note('C4', '4n') // 0.0s - 0.5s (0.5 duration)
        .note('D4', '4n') // 0.5s - 1.0s (0.5 duration)
        .tempo(60)
        .note('E4', '4n') // 1.0s - 2.0s (1.0 duration)
        .note('F4', '4n') // 2.0s - 3.0s (1.0 duration)
        .build()

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      expect(output.meta.durationSeconds).toBeCloseTo(3.0)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(notes[0].time).toBeCloseTo(0.0)
      expect(notes[1].time).toBeCloseTo(0.5)
      expect(notes[2].time).toBeCloseTo(1.0)
      expect(notes[3].time).toBeCloseTo(2.0)
    })

    it('should handle cumulative transposition and reset', () => {
      const clip = Clip.melody('TransFix')
        .note('C4', '4n') // C4
        .transpose(12)
        .note('C4', '4n') // C5
        .transpose(-5)    // +7
        .note('C4', '4n') // G4
        .transpose(-7)    // 0
        .note('C4', '4n') // C4
        .build()

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      const { output } = compile(s)

      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')
      expect(notes[0].note).toBe('C4')
      expect(notes[1].note).toBe('C5')
      expect(notes[2].note).toBe('G4')
      expect(notes[3].note).toBe('C4')
    })

    it('should throw useful error when applying modifiers to non-notes (e.g. rest)', () => {
      // With Relay Pattern, rest() returns Builder, which does not have staccato().
      // This is a compile-time safety feature, but at runtime it throws "staccato is not a function".
      try {
        (Clip.melody('Bad').rest('4n') as any).staccato()
        fail('Should have thrown error')
      } catch (e: any) {
        expect(e.message).toMatch(/not a function|undefined is not a function/)
      }
    })

    it('should handle deep recursion (Iterative Stack)', () => {
      let deepClip: any = Clip.melody('Deep').note('C4', '4n').commit()
      // Create a stack deep enough to blow normal call stack (e.g. 1500)
      for (let i = 0; i < 1500; i++) {
        const wrapper = Clip.create(`Wrapper${i}`).play(deepClip)
        deepClip = wrapper as any
      }

      const s = session().add(Track.from(deepClip, Instrument.synth('Test')))
      // Should not throw RangeError
      expect(() => compile(s)).not.toThrow()
    })

    it('should handle 1000-deep stack recursion (Iterative Stack)', () => {
      // stack([ stack([ ... note ... ]) ])
      let deepOp: any = { kind: 'note', note: 'C4', duration: '4n', velocity: 1 }
      for (let i = 0; i < 1000; i++) {
        deepOp = { kind: 'stack', operations: [deepOp] }
      }

      const clip = { kind: 'clip', name: 'DeepStack', operations: [deepOp] } as any
      const mockBuilder = { build: () => clip }
      const s = session().add(Track.from(mockBuilder as any, Instrument.synth('Test')))

      const start = performance.now()
      const { output } = compile(s)
      const end = performance.now()

      expect(output.timeline.length).toBeGreaterThan(0)
    })

    it('should not leak transposition to parent scope', () => {
      // Op: [ Note C4, Transpose(+12) { Note C4 }, Note G4 ]
      // Exp: C4, C5, G4
      // If leak: C4, C5, G5
      const ops = [
        { kind: 'note', note: 'C4', duration: '4n', velocity: 1 },
        {
          kind: 'transpose',
          semitones: 12,
          operation: { kind: 'note', note: 'C4', duration: '4n', velocity: 1 }
        },
        { kind: 'note', note: 'G4', duration: '4n', velocity: 1 }
      ] as any[]

      const clip = { kind: 'clip', name: 'LeakTest', operations: ops } as any
      const mockBuilder = { build: () => clip }
      const s = session().add(Track.from(mockBuilder as any, Instrument.synth('Test')))

      const { output } = compile(s)
      const notes = output.timeline.filter((e): e is NoteOnEvent => e.kind === 'note_on')

      expect(notes.length).toBe(3)
      expect(notes[0].note).toBe('C4')
      expect(notes[1].note).toBe('C5')
      expect(notes[2].note).toBe('G4')
    })
  })
})

describe('Pipeline Expansion', () => {
  const { expandClip } = require('../compiler/pipeline/expand')

  it('should flatten loop operations', () => {
    const clip = Clip.melody('LoopTest')
      .note('C4', '4n')
      .loop(3, (c) => c.note('D4', '4n').commit()) // FIX: commit()
      .build()

    const result = expandClip(clip)
    // 1 init note + 3 loop notes = 4 ops
    expect(result.operations.length).toBe(4)
    expect(result.operations[0].original.note).toBe('C4')
    expect(result.operations[1].original.note).toBe('D4')
    expect(result.operations[3].original.note).toBe('D4')
  })

  it('should flatten stack operations into markers', () => {
    const clip = Clip.melody('StackTest')
      .stack(s => (s as any)
        .note('C4', '4n')
        .note('E4', '4n').commit()
      )
      .build()

    // Expected: StackStart -> BranchStart -> C4 -> BranchEnd -> BranchStart -> E4 -> BranchEnd -> StackEnd
    const result = expandClip(clip)

    const kinds = result.operations.map((o: any) => o.kind === 'op' ? o.original.kind : o.kind)
    expect(kinds).toEqual([
      'stack_start',
      'branch_start', 'note', 'branch_end',
      'branch_start', 'note', 'branch_end',
      'stack_end'
    ])
  })

  it('should enforce max depth limit', () => {
    // Create circular ref or deep nest
    const clipA: any = { kind: 'clip', name: 'A', operations: [] }
    const clipB: any = { kind: 'clip', name: 'B', operations: [{ kind: 'clip', clip: clipA }] }
    clipA.operations.push({ kind: 'clip', clip: clipB })

    expect(() => expandClip(clipA, 10)).toThrow(/Max depth/)
  })
})

describe('Nested Stack Correctness (Phase 1/3 Verification)', () => {
  const { compileClip } = require('../compiler/pipeline/index')

  it('produces correct note count for nested stacks', () => {
    const inner = Clip.melody().note('E4', '4n').build()
    const middle = Clip.melody().stack(s => s.play(inner).play(inner)).build()
    const outer = Clip.melody().stack(s => s.play(middle).play(middle)).build()

    const result = compileClip(outer, { bpm: 120 })
    // 4 notes total
    expect(result.events).toHaveLength(4)
  })

  it('starts all parallel branches at the same time', () => {
    const inner = Clip.melody().note('E4', '4n').build()
    const middle = Clip.melody().stack(s => s.play(inner).play(inner)).build()

    const result = compileClip(middle, { bpm: 120 })
    expect(result.events[0].startSeconds).toBe(0)
    expect(result.events[1].startSeconds).toBe(0)
  })

  it('preserves transposition in nested stacks', () => {
    const inner = Clip.melody().note('C4', '4n').build()
    const outer = Clip.melody()
      .transpose(2)
      .stack(s => s.play(inner))
      .build()

    const result = compileClip(outer, { bpm: 120 })
    expect(result.events[0].payload.pitch).toBe('D4')
  })

  it('handles stacks at different beat positions correctly', () => {
    const a = Clip.melody().note('C4', '4n').build()
    const b = Clip.melody().note('E4', '4n').build()

    const clip = Clip.melody()
      .note('G4', '4n')        // beat 0, dur 1
      .stack(s => s.play(a).play(b)) // beat 1
      .build()

    const result = compileClip(clip, { bpm: 120 })

    const g4 = result.events.find((e: any) => e.payload.pitch === 'G4')
    const c4 = result.events.find((e: any) => e.payload.pitch === 'C4')
    const e4 = result.events.find((e: any) => e.payload.pitch === 'E4')

    expect(g4?.startSeconds).toBe(0)
    expect(c4?.startSeconds).toBeCloseTo(0.5)
    expect(e4?.startSeconds).toBeCloseTo(0.5)
  })
})
