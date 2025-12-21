import { Clip, Instrument, session, Track } from '@symphonyscript/core/core'
import { compile, serializeTimeline } from '../compiler'
import { renderPattern } from '../debug/ascii'
import type { CompiledEvent } from '../compiler/pipeline/types'
import { SerializedSession, serializeSession, deserializeClip, validateSerializedSession } from '@symphonyscript/core/session/serialize'
import { NoteName, instrumentId } from '@symphonyscript/core/types'
import { MidiChannel, MidiValue } from '@symphonyscript/core/types/midi'
import { isCompatible, SCHEMA_VERSION } from '@symphonyscript/core/schema/version'
import { validateSchema, SchemaVersionError } from '@symphonyscript/core/schema/validate'
import { migrations } from '@symphonyscript/core/schema/migrations'

describe('Serializer', () => {
  // Shared setup for serializer tests
  const melody = Clip.melody('Test')
    .tempo(120)
    .note('C4', '4n').velocity(1.0)
    .note('E4', '4n').velocity(0.8).staccato()
    .tempo(90)
    .note('G4', '2n').velocity(0.6)
    .build() // Ensure we get a ClipNode

  const piano = Instrument.synth('Piano')
  const { output } = compile(
    session({ tempo: 120 }).add(Track.from(melody, piano))
  )

  it('should generate a full timeline string with header', () => {
    const result = serializeTimeline(output)

    expect(result).toContain('# SymphonyScript')
    expect(result).toContain('NOTE_ON')
    expect(result).toContain('C4')

    expect(result).toContain('TEMPO')
    expect(result).toContain('[Piano]')
  })

  it('should omit header when includeHeader is false', () => {
    const result = serializeTimeline(output, { includeHeader: false })
    expect(result.startsWith('#')).toBe(false)
  })

  it('should respect precision option', () => {
    const result = serializeTimeline(output, { precision: 1 })
    expect(result).toMatch(/@\d+\.\d\s/) // Matches @0.0 or similar
  })
})

describe('ASCII Visualization', () => {
  it('should render simple pattern', () => {
    const events: CompiledEvent[] = [
      {
        kind: 'note',
        startSeconds: 0,
        durationSeconds: 0.5,
        channel: 1 as MidiChannel,
        payload: { velocity: 1 as MidiValue, pitch: 'C4' as NoteName }
      },
      {
        kind: 'note',
        startSeconds: 0.5,
        durationSeconds: 0.5,
        channel: 1 as MidiChannel,
        payload: { velocity: 1 as MidiValue, pitch: 'E4' as NoteName }
      },
    ]

    const output = renderPattern(events, 'Test', { bpm: 120, stepsPerBeat: 4 })
    expect(output).toContain('C')
    expect(output).toContain('E')
  })

  it('should show sustain for long notes', () => {
    const events: CompiledEvent[] = [
      {
        kind: 'note',
        startSeconds: 0,
        durationSeconds: 1,
        channel: 1 as MidiChannel,
        payload: { velocity: 1 as MidiValue, pitch: 'C4' as NoteName }
      }, // 2 beats at 120bpm
    ]

    const output = renderPattern(events, 'Test', { bpm: 120, stepsPerBeat: 4 })
    expect(output).toContain('C.......')
  })

  it('should use x for drums', () => {
    const events: CompiledEvent[] = [
      {
        kind: 'note',
        startSeconds: 0,
        durationSeconds: 0.1,
        channel: 1 as MidiChannel,
        payload: { velocity: 1 as MidiValue, pitch: 'Kick' as NoteName }
      },
    ]

    const output = renderPattern(events, 'Drums', { bpm: 120 })
    expect(output).toContain('x')
  })

  it('should render multiple tracks from session', () => {
    const compiled = compile(session({ tempo: 120 }).track('Drums K', Clip.drums('K').kick().commit().build(), Instrument.synth('Drums'))
      .track('Drums S', Clip.drums('S').rest('4n').snare().commit().build(), Instrument.synth('Drums')))
    const ascii = compiled.toAscii?.()

    expect(ascii).toContain('Drums K')
    expect(ascii).toContain('x')
  })

  it('should support preview on builder', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {
    })
    // .note returns Cursor, which has .preview()
    Clip.melody().note('C4', '4n').preview()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('Session Serialization', () => {
  it('serializes simple session to JSON', () => {
    const piano = Instrument.synth('Piano')
    const melody = Clip.melody().note('C4', '4n').commit() // Pass Builder
    const s = session()
      .track('Main', melody, piano)

    // Should not throw
    const serialized = serializeSession(s)
    expect(() => JSON.stringify(serialized)).not.toThrow()

    expect(serialized.tracks).toHaveLength(1)
    const id = serialized.tracks[0].instrumentId
    expect(serialized.instruments[id]).toBeDefined()
    expect(serialized.instruments[id].name).toBe('Piano')
  })

  it('serializes sidechain as ID reference', () => {
    const kick = Instrument.synth('Kick')
    const bass = Instrument.synth('Bass').sidechain(kick, 0.5)

    const s = session()
      .track('Kick', Clip.melody().note('C1', '4n').commit().build(), kick)
      .track('Bass', Clip.melody().note('C2', '4n').commit().build(), bass)

    const serialized = serializeSession(s)
    const json = JSON.stringify(serialized)

    // Should not contain [object Object] (indicator of failed serialization or toString)
    expect(json).not.toContain('[object Object]')

    // Should contain sourceId
    expect(json).toContain('sourceId')

    // Verify structure in object
    const bassId = serialized.tracks[1].instrumentId
    const bassConfig = serialized.instruments[bassId]

    // Check sidechain is present and uses ID
    expect(bassConfig.sidechain).toBeDefined()
    expect(typeof bassConfig.sidechain!.sourceId).toBe('string')

    // Ensure circular reference is broken
    // The 'kick' instrument should be registered and referenced
    const kickId = serialized.tracks[0].instrumentId
    expect(bassConfig.sidechain!.sourceId).toBe(kickId)
  })

  it('validateSerializedSession catches missing instrument', () => {
    const valid: SerializedSession = {
      _version: '1.0.0',
      kind: 'session',
      tracks: [{ _version: '1.0.0', kind: 'track', instrumentId: instrumentId('piano-1'), clip: { kind: 'clip', operations: [] } as any }],
      instruments: {
        [instrumentId('piano-1')]: { type: 'synth', name: 'Piano', config: { kind: 'synth' } as any }
      }
    }

    expect(validateSerializedSession(valid)).toEqual([])

    const invalid: SerializedSession = {
      _version: '1.0.0',
      kind: 'session',
      tracks: [{ _version: '1.0.0', kind: 'track', instrumentId: instrumentId('missing-id'), clip: { kind: 'clip', operations: [] } as any }],
      instruments: {}
    }

    const errors = validateSerializedSession(invalid)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('missing-id')
  })

  it('validateSerializedSession catches missing sidechain source', () => {
    const invalid: SerializedSession = {
      _version: '1.0.0',
      kind: 'session',
      tracks: [],
      instruments: {
        [instrumentId('bass')]: {
          type: 'synth',
          name: 'Bass',
          config: { kind: 'synth' } as any,
          sidechain: { sourceId: instrumentId('ghost-kick'), amount: 0.5 }
        }
      }
    }

    const errors = validateSerializedSession(invalid)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('ghost-kick')
  })
})

describe('Schema Versioning', () => {
  describe('isCompatible', () => {
    it('accepts same version', () => {
      expect(isCompatible('1.0.0', '1.0.0').compatible).toBe(true)
    })

    it('accepts older minor version', () => {
      expect(isCompatible('1.0.0', '1.1.0').compatible).toBe(true)
    })

    it('rejects newer minor version', () => {
      const result = isCompatible('1.2.0', '1.1.0')
      expect(result.compatible).toBe(false)
      expect(result.reason).toContain('newer')
    })

    it('rejects different major version', () => {
      expect(isCompatible('2.0.0', '1.0.0').compatible).toBe(false)
      expect(isCompatible('1.0.0', '2.0.0').compatible).toBe(false)
    })
  })

  describe('migrations', () => {
    it('migrates legacy data (no version) to 1.0.0', () => {
      const legacy = { kind: 'clip', name: 'Test', operations: [] }
      const migrated = migrations.migrate(legacy, '1.0.0') as any
      expect(migrated._version).toBe('1.0.0')
    })

    it('finds multi-step migration path', () => {
      // Register temporary migrations for test
      migrations.register('1.0.0', '1.1.0', (d: any) => ({ ...d, _version: '1.1.0', newField: 'default' }))
      migrations.register('1.1.0', '1.2.0', (d: any) => ({ ...d, _version: '1.2.0' }))

      const data = { _version: '1.0.0', kind: 'clip' }
      const migrated = migrations.migrate<any>(data, '1.2.0')

      expect(migrated._version).toBe('1.2.0')
      expect(migrated.newField).toBe('default')
    })
  })

  describe('validateSchema', () => {
    it('warns on version mismatch (non-strict)', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => { })
      const data = { _version: '0.9.0', kind: 'clip' }

      validateSchema(data)

      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('throws on version mismatch (strict)', () => {
      const data = { _version: '2.0.0', kind: 'clip' }

      expect(() => validateSchema(data, { strict: true }))
        .toThrow(SchemaVersionError)
    })
  })

  describe('Integration', () => {
    it('built clips include _version field', () => {
      const clip = Clip.melody('Test').build()
      expect(clip._version).toBe(SCHEMA_VERSION)
    })

    it('serialized session includes _version', () => {
      const s = session()
      const serialized = serializeSession(s)
      expect(serialized._version).toBe(SCHEMA_VERSION)
      expect(serialized.tracks).toBeDefined()
    })
  })
})

describe('deserializeClip', () => {
  it('deserializes current version without migration', () => {
    const clip = { _version: SCHEMA_VERSION, kind: 'clip', name: 'Test', operations: [] }
    const json = JSON.stringify(clip)
    const result = deserializeClip(json)
    expect(result._version).toBe(SCHEMA_VERSION)
    expect(result.name).toBe('Test')
  })

  it('throws on version mismatch with strict: true', () => {
    const clip = { _version: '0.0.1', kind: 'clip', name: 'Test', operations: [] }
    const json = JSON.stringify(clip)
    expect(() => deserializeClip(json, { strict: true })).toThrow()
  })

  it('migrates old version with migrate: true', () => {
    // No _version means legacy 0.0.0, which has a migration to 1.0.0
    const old = { kind: 'clip', name: 'Legacy', operations: [] }
    const json = JSON.stringify(old)
    const migrated = deserializeClip(json, { migrate: true })
    expect(migrated._version).toBe(SCHEMA_VERSION)
  })

  it('throws on unknown future version with migrate: true', () => {
    const future = { _version: '99.0.0', kind: 'clip', name: 'Future', operations: [] }
    const json = JSON.stringify(future)
    expect(() => deserializeClip(json, { migrate: true })).toThrow(/No migration path/)
  })
})
