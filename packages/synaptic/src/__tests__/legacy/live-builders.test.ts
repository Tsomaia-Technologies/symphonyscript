// =============================================================================
// SymphonyScript - Live Builders Tests (RFC-043 Phase 4)
// =============================================================================
// Comprehensive tests for LiveMelodyBuilder, LiveDrumBuilder, and cursors.

import { LiveClipBuilder } from '../../../core/src/linker/LiveClipBuilder'
import { LiveMelodyBuilder } from '../../../core/src/linker/LiveMelodyBuilder'
import { LiveDrumBuilder } from '../../../core/src/linker/LiveDrumBuilder'
import { LiveKeyboardBuilder } from '../../../core/src/linker/LiveKeyboardBuilder'
import { LiveStringsBuilder } from '../../../core/src/linker/LiveStringsBuilder'
import { LiveWindBuilder } from '../../../core/src/linker/LiveWindBuilder'
import { LiveMelodyNoteCursor } from '../../../core/src/linker/cursors/LiveMelodyNoteCursor'
import { LiveChordCursor } from '../../../core/src/linker/cursors/LiveChordCursor'
import { LiveDrumHitCursor } from '../../../core/src/linker/cursors/LiveDrumHitCursor'
import { LiveSession } from '../../../core/src/linker/LiveSession'
import { Clip } from '../../../core/src/linker/Clip'
import { SiliconBridge } from '../../../../kernel/src/silicon-bridge'
import { SiliconSynapse } from '../../../../kernel/src/silicon-synapse'
import { MockConsumer } from '../../../../kernel/src/mock-consumer'

// =============================================================================
// Global Cleanup
// =============================================================================

afterAll(() => {
  LiveClipBuilder.clearCache()
  LiveSession.clear()
})

// =============================================================================
// Test Helpers
// =============================================================================

function createTestBridge(): SiliconBridge {
  const linker = SiliconSynapse.create({
    nodeCapacity: 256,
    safeZoneTicks: 0
  })
  return new SiliconBridge(linker, {
    attributeDebounceTicks: 1,
    structuralDebounceTicks: 1
  })
}

function createTestEnvironment() {
  const linker = SiliconSynapse.create({
    nodeCapacity: 256,
    safeZoneTicks: 0
  })
  const bridge = new SiliconBridge(linker, {
    attributeDebounceTicks: 1,
    structuralDebounceTicks: 1
  })
  const consumer = new MockConsumer(linker.getSAB(), 24)
  consumer.reset()

  return { linker, bridge, consumer }
}

// =============================================================================
// LiveMelodyBuilder Tests
// =============================================================================

describe('LiveMelodyBuilder', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  describe('note() returns cursor', () => {
    test('note() returns LiveMelodyNoteCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      const cursor = builder.note('C4' as any, '4n')

      expect(cursor).toBeInstanceOf(LiveMelodyNoteCursor)
    })

    test('cursor.commit() returns builder', () => {
      const bridge = createTestBridge()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      const result = builder.note('C4' as any, '4n').commit()

      expect(result).toBe(builder)
    })

    test('cursor modifier chaining works', () => {
      const bridge = createTestBridge()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      const cursor = builder.note('C4' as any, '4n')
        .velocity(0.8)
        .staccato()
        .detune(10)

      expect(cursor).toBeInstanceOf(LiveMelodyNoteCursor)
    })
  })

  describe('cursor modifiers patch SAB', () => {
    test('velocity() patches SAB', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.note('C4' as any, '4n').velocity(0.5).commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].velocity).toBe(64)  // 0.5 * 127 ≈ 64
    })

    test('staccato() reduces duration', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.note('C4' as any, '4n').staccato().commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].duration).toBe(240)  // 480 * 0.5 = 240
    })

    test('legato() increases duration', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.note('C4' as any, '4n').legato().commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].duration).toBe(504)  // 480 * 1.05 = 504
    })

    test('accent() boosts velocity', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')
      builder.velocity(100)

      builder.note('C4' as any, '4n').accent().commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].velocity).toBe(120)  // 100 * 1.2 = 120
    })

    test('marcato() strongly boosts velocity', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')
      builder.velocity(80)

      builder.note('C4' as any, '4n').marcato().commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].velocity).toBe(104)  // 80 * 1.3 = 104
    })
  })

  describe('chord() returns cursor', () => {
    test('chord() with note array returns LiveChordCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      const cursor = builder.chord(['C4', 'E4', 'G4'] as any, '4n')

      expect(cursor).toBeInstanceOf(LiveChordCursor)
    })

    test('chord() with ChordCode returns LiveChordCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      const cursor = builder.chord('Cmaj' as any, 4, '4n')

      expect(cursor).toBeInstanceOf(LiveChordCursor)
    })

    test('chord cursor.velocity() patches all notes', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.chord(['C4', 'E4', 'G4'] as any, '4n').velocity(0.6).commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)
      events.forEach(e => {
        expect(e.velocity).toBe(76)  // 0.6 * 127 ≈ 76
      })
    })

    test('chord cursor.inversion() rotates notes', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      // C4=60, E4=64, G4=67
      // First inversion: E4=64, G4=67, C5=72
      builder.chord(['C4', 'E4', 'G4'] as any, '4n').inversion(1).commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)

      const pitches = events.map(e => e.pitch).sort((a, b) => a - b)
      expect(pitches).toEqual([64, 67, 72])
    })
  })

  describe('transposition', () => {
    test('transpose() affects subsequent notes', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.transpose(2)
      builder.note('C4' as any, '4n').commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].pitch).toBe(62)  // C4=60 + 2 = 62 (D4)
    })

    test('octave() sets absolute octave', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.octave(5)  // One octave up from neutral (4)
      builder.note('C4' as any, '4n').commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].pitch).toBe(72)  // C4=60 + 12 = 72 (C5)
    })

    test('octaveUp() shifts up', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.octaveUp(1)
      builder.note('C4' as any, '4n').commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events[0].pitch).toBe(72)
    })

    test('octaveDown() shifts down', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.octaveDown(1)
      builder.note('C4' as any, '4n').commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events[0].pitch).toBe(48)
    })
  })

  describe('scale context', () => {
    test('scale() + degree() produces correct notes', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.scale('C', 'major', 4)
      builder.degree(1, '4n').commit()  // C4
      builder.degree(3, '4n').commit()  // E4
      builder.degree(5, '4n').commit()  // G4

      consumer.runUntilTick(2000)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)
      expect(events[0].pitch).toBe(60)  // C4
      expect(events[1].pitch).toBe(64)  // E4
      expect(events[2].pitch).toBe(67)  // G4
    })

    test('degreeChord() produces scale-based chord', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.scale('C', 'major', 4)
      builder.degreeChord([1, 3, 5], '4n').commit()

      consumer.runUntilTick(960)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)

      const pitches = events.map(e => e.pitch).sort((a, b) => a - b)
      expect(pitches).toEqual([60, 64, 67])  // C, E, G
    })
  })

  describe('arpeggio', () => {
    test('arpeggio() generates sequence', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveMelodyBuilder(bridge, 'Test')

      builder.arpeggio(['C4', 'E4', 'G4'] as any[], '8n', { pattern: 'up' })

      consumer.runUntilTick(2000)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)

      // Should be in ascending order
      expect(events[0].pitch).toBe(60)  // C4
      expect(events[1].pitch).toBe(64)  // E4
      expect(events[2].pitch).toBe(67)  // G4
    })
  })
})

// =============================================================================
// LiveDrumBuilder Tests
// =============================================================================

describe('LiveDrumBuilder', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  describe('drum hit methods return cursor', () => {
    test('hit() returns LiveDrumHitCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      const cursor = builder.hit('kick')

      expect(cursor).toBeInstanceOf(LiveDrumHitCursor)
    })

    test('kick() returns LiveDrumHitCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      const cursor = builder.kick()

      expect(cursor).toBeInstanceOf(LiveDrumHitCursor)
    })

    test('snare() returns LiveDrumHitCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      const cursor = builder.snare()

      expect(cursor).toBeInstanceOf(LiveDrumHitCursor)
    })

    test('hat() returns LiveDrumHitCursor', () => {
      const bridge = createTestBridge()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      const cursor = builder.hat()

      expect(cursor).toBeInstanceOf(LiveDrumHitCursor)
    })
  })

  describe('drum cursor modifiers', () => {
    test('ghost() sets low velocity', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      builder.snare().ghost().commit()

      consumer.runUntilTick(480)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].velocity).toBe(38)  // 0.3 * 127 ≈ 38
    })

    test('accent() boosts velocity', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveDrumBuilder(bridge, 'Test')
      builder.velocity(100)

      builder.kick().accent().commit()

      consumer.runUntilTick(480)
      const events = consumer.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].velocity).toBe(120)  // 100 * 1.2 = 120
    })
  })

  describe('cursor chaining', () => {
    test('hit() chains correctly', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      builder.kick().hat().snare().hat()

      consumer.runUntilTick(2000)
      const events = consumer.getEvents()
      expect(events.length).toBe(4)
    })
  })

  describe('euclidean', () => {
    test('euclidean() generates pattern', () => {
      const { bridge, consumer } = createTestEnvironment()
      const builder = new LiveDrumBuilder(bridge, 'Test')

      builder.euclidean({
        hits: 3,
        steps: 8,
        note: 'kick',
        stepDuration: '16n'
      })

      consumer.runUntilTick(2000)
      const events = consumer.getEvents()
      expect(events.length).toBe(3)  // 3 hits in the pattern
    })
  })
})

// =============================================================================
// LiveKeyboardBuilder Tests
// =============================================================================

describe('LiveKeyboardBuilder', () => {
  test('sustain() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveKeyboardBuilder(bridge, 'Test')

    const result = builder.sustain()

    expect(result).toBe(builder)
  })

  test('release() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveKeyboardBuilder(bridge, 'Test')

    const result = builder.release()

    expect(result).toBe(builder)
  })

  test('inherits melody methods', () => {
    const bridge = createTestBridge()
    const builder = new LiveKeyboardBuilder(bridge, 'Test')

    const cursor = builder.note('C4' as any, '4n')

    expect(cursor).toBeInstanceOf(LiveMelodyNoteCursor)
  })
})

// =============================================================================
// LiveStringsBuilder Tests
// =============================================================================

describe('LiveStringsBuilder', () => {
  test('bend() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveStringsBuilder(bridge, 'Test')

    const result = builder.bend(2)

    expect(result).toBe(builder)
  })

  test('slide() returns builder', () => {
    const bridge = createTestBridge()
    const builder = new LiveStringsBuilder(bridge, 'Test')

    const result = builder.slide('G4' as any, '4n')

    expect(result).toBe(builder)
  })

  test('bendReset() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveStringsBuilder(bridge, 'Test')

    const result = builder.bendReset()

    expect(result).toBe(builder)
  })

  test('inherits melody methods', () => {
    const bridge = createTestBridge()
    const builder = new LiveStringsBuilder(bridge, 'Test')

    const cursor = builder.note('C4' as any, '4n')

    expect(cursor).toBeInstanceOf(LiveMelodyNoteCursor)
  })
})

// =============================================================================
// LiveWindBuilder Tests
// =============================================================================

describe('LiveWindBuilder', () => {
  test('breath() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveWindBuilder(bridge, 'Test')

    const result = builder.breath(0.8)

    expect(result).toBe(builder)
  })

  test('expressionCC() is callable', () => {
    const bridge = createTestBridge()
    const builder = new LiveWindBuilder(bridge, 'Test')

    const result = builder.expressionCC(0.5)

    expect(result).toBe(builder)
  })

  test('inherits melody methods', () => {
    const bridge = createTestBridge()
    const builder = new LiveWindBuilder(bridge, 'Test')

    const cursor = builder.note('C4' as any, '4n')

    expect(cursor).toBeInstanceOf(LiveMelodyNoteCursor)
  })
})

// =============================================================================
// Clip Factory Tests
// =============================================================================

describe('Clip Factory - Specialized Builders', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  test('Clip.melody() returns LiveMelodyBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.melody('Lead')

    expect(builder).toBeInstanceOf(LiveMelodyBuilder)
  })

  test('Clip.drums() returns LiveDrumBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.drums('Kit')

    expect(builder).toBeInstanceOf(LiveDrumBuilder)
  })

  test('Clip.keyboard() returns LiveKeyboardBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.keyboard('Piano')

    expect(builder).toBeInstanceOf(LiveKeyboardBuilder)
  })

  test('Clip.piano() is alias for keyboard', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.piano('Piano')

    expect(builder).toBeInstanceOf(LiveKeyboardBuilder)
  })

  test('Clip.strings() returns LiveStringsBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.strings('Violin')

    expect(builder).toBeInstanceOf(LiveStringsBuilder)
  })

  test('Clip.wind() returns LiveWindBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.wind('Flute')

    expect(builder).toBeInstanceOf(LiveWindBuilder)
  })

  test('Clip.bass() returns LiveMelodyBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.bass('Bass')

    expect(builder).toBeInstanceOf(LiveMelodyBuilder)
  })
})

// =============================================================================
// Tombstone Pattern Tests
// =============================================================================

describe('Tombstone Pattern with Cursors', () => {
  test('finalize() removes untouched notes', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    // First execution: 3 notes
    builder.note('C4' as any, '4n').commit()
    builder.note('E4' as any, '4n').commit()
    builder.note('G4' as any, '4n').commit()
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(3)

    // Second execution: only 2 notes (middle deleted)
    builder.resetTouched()
    builder.note('C4' as any, '4n').commit()
    builder.note('G4' as any, '4n').commit()
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(2)
  })
})

// =============================================================================
// API Compatibility Tests
// =============================================================================

describe('API Compatibility', () => {
  test('cursor chain: note → velocity → staccato → commit', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    const result = builder
      .note('C4' as any, '4n')
      .velocity(0.8)
      .staccato()
      .commit()

    expect(result).toBe(builder)
    expect(bridge.getMappingCount()).toBe(1)
  })

  test('cursor chain: note → modifiers → rest (escape)', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    const result = builder
      .note('C4' as any, '4n')
      .velocity(0.8)
      .rest('4n')

    expect(result).toBe(builder)
    expect(bridge.getMappingCount()).toBe(1)
  })

  test('cursor chain: note → modifiers → note (relay)', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    builder
      .note('C4' as any, '4n')
      .velocity(0.8)
      .note('E4' as any, '4n')
      .commit()

    expect(bridge.getMappingCount()).toBe(2)
  })

  test('drum chain: kick → hat → snare', () => {
    const bridge = createTestBridge()
    const builder = new LiveDrumBuilder(bridge, 'Test')

    builder
      .kick()
      .hat()
      .snare()

    expect(bridge.getMappingCount()).toBe(3)
  })

  test('finalize() works after cursor operations', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    builder
      .note('C4' as any, '4n')
      .velocity(0.8)
      .finalize()

    // Should not throw
    expect(bridge.getMappingCount()).toBe(1)
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  test('cursor operations complete in reasonable time', () => {
    const bridge = createTestBridge()
    const builder = new LiveMelodyBuilder(bridge, 'Test')

    const iterations = 50
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      builder.note('C4' as any, '4n').velocity(0.8).staccato().commit()
    }

    const end = performance.now()
    const totalMs = end - start
    const perCallUs = (totalMs * 1000) / iterations

    console.log(`Cursor performance: ${iterations} note+modifiers in ${totalMs.toFixed(2)}ms (${perCallUs.toFixed(2)}µs per call)`)

    // Allow generous margin for CI
    expect(perCallUs).toBeLessThan(2000)
  })
})
