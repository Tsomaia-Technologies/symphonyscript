import { Clip, compile, Instrument, session, Track } from '../index'
import { note } from '../clip/actions'
import { Duration, isNoteName, noteName, Notes } from '../types/primitives'

describe('Validation System', () => {

  // Helper to compile and expect a warning
  function compileAndExpectError(s: any, expectedCode: string) {
    let threw = false
    try {
      const { warnings } = compile(s)
      const found = warnings.find(w => w.level === 'error' && w.code === expectedCode)
      if (found) threw = true
    } catch (e: any) {
      // Some "errors" might throw immediately depending on implementation?
      if (e.message.includes(expectedCode)) threw = true
    }
    return threw
  }

  function compileAndExpectWarning(s: any, expectedCode: string) {
    try {
      const { warnings } = compile(s)
      return warnings.some(w => w.code === expectedCode && w.level === 'warning')
    } catch (e) {
      return false
    }
  }

  describe('Parameter Validation', () => {
    it('should throw error with suggestion for invalid strings like "4x"', () => {
      // This happens at builder time or compile time?
      // Clip builder usually stores strings. Compile time parses.
      try {
        const c = Clip.melody('Valid').note('C4', '4x' as any).commit()
        const s = session().add(Track.from(c, Instrument.synth('Test')))
        compile(s)
        compile(s)
        throw new Error('Should have thrown error')
      } catch (e: any) {
        expect(e.message).toContain('Did you mean \'4n\'?')
      }
    })
  })

  describe('Session Validation', () => {
    it('should detect duplicate instrument names', () => {
      const inst1 = Instrument.synth('MySynth')
      const inst2 = Instrument.synth('MySynth')
      const s = session()
        .add(Track.from(Clip.create('A'), inst1))
        .add(Track.from(Clip.create('B'), inst2))

      expect(compileAndExpectWarning(s, 'DUPLICATE_INSTRUMENT_NAME')).toBe(true)
    })

    it('should detect sidechain source not in session', () => {
      const ghost = Instrument.synth('Ghost')
      const inst = Instrument.synth('WithSC').sidechain(ghost, 0.5)
      const s = session().add(Track.from(Clip.create('A'), inst))

      expect(compileAndExpectWarning(s, 'SIDECHAIN_SOURCE_NOT_IN_SESSION')).toBe(true)
    })

    it('should detect empty clips', () => {
      const s = session().add(Track.from(Clip.create('Empty'), Instrument.synth('Test')))
      expect(compileAndExpectWarning(s, 'EMPTY_CLIP')).toBe(true)
    })

    it('should warn on large loop counts', () => {
      const clip = Clip.create('Loop').loop(5000, b => b.rest('4n'))
      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      expect(compileAndExpectWarning(s, 'LARGE_LOOP_COUNT')).toBe(true)
    })

    it('should warn on extreme transposition', () => {
      let clip = Clip.melody('TooManyOps')

      // Add more than max ops
      for (let i = 0; i < 20050; i++) {
        // Just chain operations (inefficient but tests validation)
        // We use 'as any' because this will effectively be a cursor chain
        // but for loop usage, we need to reassign correctly if we were building for real.
        // For the test, we just want ops in the array.
        // Actually, Relay Pattern returns NEW cursor/builder each time.
        // So we must reassign: clip = clip.note(...) -- but types change.
        // With Relay, huge chains are memory intensive if creating new objects.
        // But here we construct a huge clip.
        // We need to use `addOp` internally or use a mutable approach?
        // Builders are immutable.
        // So `clip = clip.note(...).commit()` works if types align.
        (clip as any) = (clip as any).note('C4', '16n').commit()
      }

      const s = session().add(Track.from(clip, Instrument.synth('Test')))
      expect(compileAndExpectWarning(s, 'MAX_OPERATIONS_PER_CLIP')).toBe(true)
    })

    it('should detect circular clip references', () => {
      // Construct cycle manually
      const mutableOp = { kind: 'clip', clip: null as any }
      const recursiveClip: any = {
        kind: 'clip',
        name: 'Recursive',
        operations: [mutableOp],
        tempo: undefined,
        timeSignature: undefined
      }
      mutableOp.clip = recursiveClip // Cycle

      const s = {
        kind: 'session',
        tracks: [{ kind: 'track', instrument: Instrument.synth('Test'), clip: recursiveClip }],
        buses: []
      }

      const threw = compileAndExpectError(s, 'CIRCULAR_CLIP_REFERENCE')
      expect(threw).toBe(true)
    })
  })

  describe('Source Tracking', () => {
    it('should include source location in operations', () => {
      const op = note(noteName('C4'), '4n')
      expect(op._source).toBeDefined()
      expect(op._source?.method).toBe('note')
    })
  })

  describe('Runtime Validation', () => {
    const { validate, BuilderValidationError } = require('../validation/runtime')

    it('should throw BuilderValidationError for staccato after rest', () => {
      // Mock operations where last op is rest
      const ops = [{ kind: 'rest', duration: '4n' }]
      expect(() => {
        validate.lastOpIsNote('staccato', ops)
      }).toThrow(BuilderValidationError)
    })

    it('should throw for velocity out of range', () => {
      expect(() => {
        validate.velocity('note', 200)
      }).toThrow(BuilderValidationError)
    })

    it('should throw for invalid pitch format', () => {
      expect(() => {
        validate.pitch('note', 'X9')
      }).toThrow(BuilderValidationError)
    })

    it('should include method name in error', () => {
      try {
        validate.velocity('myMethod', -5)
      } catch (e: any) {
        expect(e.method).toBe('myMethod')
      }
    })

    it('should include failing value in message', () => {
      try {
        validate.velocity('test', 999)
      } catch (e: any) {
        expect(e.message).toContain('999')
      }
    })
  })

  describe('Type Safety', () => {
    describe('NoteName Validation', () => {
      it('isNoteName accepts valid note names', () => {
        expect(isNoteName('C4')).toBe(true)
        expect(isNoteName('F#3')).toBe(true)
        expect(isNoteName('Bb5')).toBe(true)
        expect(isNoteName('G2')).toBe(true)
      })

      it('isNoteName rejects invalid note names', () => {
        expect(isNoteName('')).toBe(false)
        expect(isNoteName('C')).toBe(false) // Missing octave
        expect(isNoteName('C99')).toBe(false) // Invalid octave
        expect(isNoteName('H4')).toBe(false) // Invalid note
        expect(isNoteName('invalid')).toBe(false)
      })

      it('noteName() returns branded type for valid input', () => {
        const n = noteName('C4')
        expect(n).toBe('C4')
      })

      it('noteName() throws for invalid input', () => {
        expect(() => noteName('invalid')).toThrow(/Invalid note name/)
        expect(() => noteName('C')).toThrow(/Invalid note name/)
      })
    })

    describe('Notes Helper', () => {
      it('creates correct note names', () => {
        expect(Notes.C(4)).toBe('C4')
        expect(Notes.Fs(3)).toBe('F#3')
        expect(Notes.Bb(5)).toBe('Bb5')
      })
    })

    describe('Duration Constants', () => {
      it('provides standard durations', () => {
        expect(Duration.Quarter).toBe('4n')
        expect(Duration.Eighth).toBe('8n')
        expect(Duration.Whole).toBe('1n')
      })

      it('provides dotted durations', () => {
        expect(Duration.DottedHalf).toBe('2n.')
        expect(Duration.DottedQuarter).toBe('4n.')
      })

      it('provides triplet durations', () => {
        expect(Duration.EighthTriplet).toBe('8t')
        expect(Duration.QuarterTriplet).toBe('4t')
      })
    })

    describe('AutomationTarget', () => {
      const { customTarget, isBuiltinTarget } = require('../automation/types')
      const { Clip } = require('../index')

      it('accepts builtin targets', () => {
        expect(() => Clip.melody().automate('volume', 0.5)).not.toThrow()
        expect(() => Clip.melody().automate('pan', 0.5)).not.toThrow()
      })

      it('accepts custom targets via customTarget()', () => {
        expect(() => Clip.melody().automate(customTarget('my_param'), 0.5)).not.toThrow()
      })

      it('validates custom target names', () => {
        expect(() => customTarget('')).toThrow()
        expect(() => customTarget('a'.repeat(100))).toThrow()
      })

      it('isBuiltinTarget identifies builtins', () => {
        expect(isBuiltinTarget('volume')).toBe(true)
        expect(isBuiltinTarget('pan')).toBe(true)
        expect(isBuiltinTarget('random_string')).toBe(false)
      })
    })

    describe('InstrumentId', () => {
      const { instrumentId, isInstrumentId } = require('../types/primitives')

      it('validates format', () => {
        expect(() => instrumentId('piano')).not.toThrow()
        expect(() => instrumentId('synth_01')).not.toThrow()
        expect(() => instrumentId('my-bass')).not.toThrow()
      })

      it('rejects invalid format', () => {
        expect(() => instrumentId('')).toThrow()
        expect(() => instrumentId('123abc')).toThrow()  // Starts with number
        expect(() => instrumentId('has space')).toThrow()
        expect(() => instrumentId('has.dot')).toThrow()
      })

      it('isInstrumentId guard works', () => {
        expect(isInstrumentId('piano')).toBe(true)
        expect(isInstrumentId('123')).toBe(false)
      })
    })

    describe('Velocity Standardization', () => {
      const { midiVelocityToNormalized, normalizedToMidiVelocity } = require('../types/primitives')
      const { validate, BuilderValidationError } = require('../validation/runtime')

      it('accepts 0-1 range', () => {
        expect(() => validate.velocity('test', 0)).not.toThrow()
        expect(() => validate.velocity('test', 0.5)).not.toThrow()
        expect(() => validate.velocity('test', 1)).not.toThrow()
      })

      it('rejects values outside 0-1', () => {
        expect(() => validate.velocity('test', -0.1)).toThrow()
        expect(() => validate.velocity('test', 1.1)).toThrow()
      })

      it('provides hint for MIDI values', () => {
        try {
          validate.velocity('test', 100)
          fail('Should have thrown')
        } catch (e: any) {
          expect(e).toBeInstanceOf(BuilderValidationError)
          expect(e.message).toContain('midiVelocityToNormalized')
          expect(e.message).toContain('0.79') // 100/127 ~= 0.787
        }
      })

      it('converts MIDI velocity correctly', () => {
        expect(midiVelocityToNormalized(0)).toBe(0)
        expect(midiVelocityToNormalized(127)).toBe(1)
        expect(midiVelocityToNormalized(64)).toBeCloseTo(0.504, 3)
      })

      it('converts normalized to MIDI correctly', () => {
        expect(normalizedToMidiVelocity(0)).toBe(0)
        expect(normalizedToMidiVelocity(1)).toBe(127)
        expect(normalizedToMidiVelocity(0.5)).toBe(64) // 63.5 -> 64
      })
    })
  })
})
