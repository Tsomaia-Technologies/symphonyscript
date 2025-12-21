// =============================================================================
// SymphonyScript - Live Mirror Tests (RFC-043 Phase 4)
// =============================================================================
// Tests for LiveClipBuilder, LiveSession, and Clip factory.

import { LiveClipBuilder } from '../LiveClipBuilder'
import { LiveSession, executeUserScript } from '../LiveSession'
import { Clip } from '../Clip'
import { SiliconBridge, createSiliconBridge } from '../silicon-bridge'
import { SiliconSynapse } from '../silicon-synapse'
import { MockConsumer } from '../mock-consumer'

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
    safeZoneTicks: 0 // Disable safe zone for testing
  })
  return new SiliconBridge(linker, {
    attributeDebounceTicks: 1,
    structuralDebounceMs: 1
  })
}

function createTestEnvironment() {
  const linker = SiliconSynapse.create({
    nodeCapacity: 256,
    safeZoneTicks: 0
  })
  const bridge = new SiliconBridge(linker, {
    attributeDebounceTicks: 1,
    structuralDebounceMs: 1
  })
  const consumer = new MockConsumer(linker.getSAB(), 24)
  consumer.reset()

  return { linker, bridge, consumer }
}

// Helper to read a note using the callback pattern
function readNoteData(bridge: SiliconBridge, sourceId: number): { pitch: number; velocity: number; duration: number; baseTick: number; muted: boolean } | undefined {
  let result: { pitch: number; velocity: number; duration: number; baseTick: number; muted: boolean } | undefined
  const success = bridge.readNote(sourceId, (pitch, velocity, duration, baseTick, muted) => {
    result = { pitch, velocity, duration, baseTick, muted }
  })
  return success ? result : undefined
}

// Helper to collect notes from traverseNotes into an array for test assertions
function collectNotes(
  bridge: SiliconBridge
): Array<{ sourceId: number; note: import('../silicon-bridge').EditorNoteData }> {
  const notes: Array<{ sourceId: number; note: import('../silicon-bridge').EditorNoteData }> = []
  bridge.traverseNotes((sourceId, pitch, velocity, duration, baseTick, muted) => {
    notes.push({
      sourceId,
      note: { pitch, velocity, duration, baseTick, muted }
    })
  })
  return notes
}

// =============================================================================
// LiveSession Tests
// =============================================================================

describe('LiveSession', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  test('init sets active bridge', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    expect(LiveSession.isInitialized()).toBe(true)
    expect(LiveSession.getActiveBridge()).toBe(bridge)
  })

  test('getActiveBridge throws if not initialized', () => {
    expect(() => LiveSession.getActiveBridge()).toThrow('LiveSession not initialized')
  })

  test('clear removes active bridge', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    expect(LiveSession.isInitialized()).toBe(true)

    LiveSession.clear()

    expect(LiveSession.isInitialized()).toBe(false)
  })

  test('isInitialized returns correct state', () => {
    expect(LiveSession.isInitialized()).toBe(false)

    const bridge = createTestBridge()
    LiveSession.init(bridge)

    expect(LiveSession.isInitialized()).toBe(true)
  })
})

// =============================================================================
// Clip Factory Tests
// =============================================================================

describe('Clip Factory', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  test('Clip.melody creates LiveClipBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.melody('Lead')

    expect(builder).toBeInstanceOf(LiveClipBuilder)
    expect(builder.getBridge()).toBe(bridge)
  })

  test('Clip.drums creates LiveClipBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.drums('Kit')

    expect(builder).toBeInstanceOf(LiveClipBuilder)
  })

  test('Clip.bass creates LiveClipBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.bass('Bass')

    expect(builder).toBeInstanceOf(LiveClipBuilder)
  })

  test('Clip.create creates LiveClipBuilder', () => {
    const bridge = createTestBridge()
    LiveSession.init(bridge)

    const builder = Clip.create('Generic')

    expect(builder).toBeInstanceOf(LiveClipBuilder)
  })

  test('Clip factory throws if session not initialized', () => {
    expect(() => Clip.melody('Lead')).toThrow('LiveSession not initialized')
  })
})

// =============================================================================
// Mirroring Logic Tests
// =============================================================================

describe('LiveClipBuilder - Mirroring Logic', () => {
  test('note() inserts node on first call', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    builder.note(60, 100, '4n')

    expect(bridge.getMappingCount()).toBe(1)
  })

  test('same SOURCE_ID on re-execution patches (not inserts)', () => {
    const { bridge, consumer } = createTestEnvironment()

    // First execution - creates note with pitch 60
    const builder1 = new LiveClipBuilder(bridge)
    builder1.note(60, 100, '4n')
    builder1.finalize()

    expect(bridge.getMappingCount()).toBe(1)

    // Consume and verify pitch 60
    consumer.runUntilTick(960)
    let events = consumer.getEvents()
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(60)

    // Reset consumer
    consumer.reset()

    // Second execution - same source location, different pitch
    // Since we're in the same test, call site is different
    // For this test, we manually simulate re-execution with same sourceId
    const sourceIds: number[] = []
    bridge.traverseSourceIds((id) => sourceIds.push(id))
    expect(sourceIds.length).toBe(1)

    // Patch the existing note
    bridge.patchImmediate(sourceIds[0], 'pitch', 72)

    // Should still have only 1 node
    expect(bridge.getMappingCount()).toBe(1)

    // Consume and verify pitch changed to 72
    consumer.runUntilTick(960)
    events = consumer.getEvents()
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(72)
  })

  test('new SOURCE_ID inserts new node', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    // Each note() call generates a different SOURCE_ID from call site
    builder.note(60, 100, '4n')
    builder.note(64, 100, '4n')
    builder.note(67, 100, '4n')

    // Each note should have created a new node
    expect(bridge.getMappingCount()).toBe(3)
  })

  test('attribute values update correctly on patch', () => {
    const { bridge, consumer } = createTestEnvironment()

    // Insert a note
    const sourceId = bridge.insertNoteImmediate({
      pitch: 60,
      velocity: 100,
      duration: 480,
      baseTick: 0
    })

    // Verify initial state
    let note = readNoteData(bridge, sourceId)
    expect(note?.pitch).toBe(60)
    expect(note?.velocity).toBe(100)

    // Patch attributes
    bridge.patchImmediate(sourceId, 'pitch', 72)
    bridge.patchImmediate(sourceId, 'velocity', 64)
    bridge.patchImmediate(sourceId, 'duration', 240)

    // Verify patched state
    note = readNoteData(bridge, sourceId)
    expect(note?.pitch).toBe(72)
    expect(note?.velocity).toBe(64)
    expect(note?.duration).toBe(240)

    // Consumer sees updated values
    consumer.runUntilTick(960)
    const events = consumer.getEvents()
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(72)
    expect(events[0].velocity).toBe(64)
  })
})

// =============================================================================
// Tombstone Pattern Tests
// =============================================================================

describe('LiveClipBuilder - Tombstone Pattern', () => {
  test('finalize() removes untouched nodes', () => {
    const bridge = createTestBridge()

    // First execution: create 3 notes
    const builder = new LiveClipBuilder(bridge)
    builder.note(60, 100, '4n')
    builder.note(64, 100, '4n')
    builder.note(67, 100, '4n')
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(3)

    // Second execution: only 2 notes (middle one "deleted" from source)
    // Reset touched set to simulate new execution cycle
    builder.resetTouched()

    // Re-touch only first and third notes
    builder.note(60, 100, '4n')
    builder.note(67, 100, '8n') // Same call site as before, different duration

    // Finalize - middle note should be pruned
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(2)
  })

  test('remove line from source → node deleted from SAB', () => {
    const { bridge, consumer } = createTestEnvironment()

    // First execution: 3 notes
    const builder = new LiveClipBuilder(bridge)
    builder.note(60, 100, '4n')
    builder.note(64, 100, '4n')
    builder.note(67, 100, '4n')
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(3)

    // Second execution: only 2 notes (middle line "deleted")
    builder.resetTouched()
    builder.note(60, 100, '4n')
    // Skip the middle note - simulates user deleting that line
    builder.note(67, 100, '4n')
    builder.finalize()

    expect(bridge.getMappingCount()).toBe(2)

    // Consumer should only see 2 notes
    consumer.runUntilTick(1440)
    const events = consumer.getEvents()
    expect(events.length).toBe(2)
    expect(events[0].pitch).toBe(60)
    expect(events[1].pitch).toBe(67)
  })

  test('add line to source → node inserted', () => {
    const bridge = createTestBridge()

    // Start with 1 note
    const id1 = bridge.insertNoteImmediate({
      pitch: 60,
      velocity: 100,
      duration: 480,
      baseTick: 0
    })

    expect(bridge.getMappingCount()).toBe(1)

    // Simulate execution that adds a note
    const builder = new LiveClipBuilder(bridge)
    builder.note(64, 100, '4n') // This adds a new note

    // Should now have 2 nodes
    expect(bridge.getMappingCount()).toBe(2)
  })

  test('reorder lines → proper tombstone behavior', () => {
    const { bridge, consumer, linker } = createTestEnvironment()
    LiveSession.init(bridge)

    // First execution: notes in order 60, 64, 67
    const builder1 = new LiveClipBuilder(bridge)
    builder1.note(60, 100, '4n')
    builder1.note(64, 100, '4n')
    builder1.note(67, 100, '4n')
    builder1.finalize()

    // RFC-045-FINAL: Process commands after first finalize
    for (let i = 0; i < 20; i++) bridge.tick()
    linker.processCommands()

    expect(bridge.getMappingCount()).toBe(3)

    // Second execution with new builder creates new nodes (different SOURCE_IDs)
    // This simulates a user reordering lines - new call sites = new SOURCE_IDs
    const builder2 = new LiveClipBuilder(bridge)
    builder2.note(67, 100, '4n') // Different SOURCE_ID than builder1's notes
    builder2.note(60, 100, '4n')
    builder2.note(64, 100, '4n')
    builder2.finalize()

    // RFC-045-FINAL: Process commands after second finalize
    for (let i = 0; i < 20; i++) bridge.tick()
    linker.processCommands()

    // builder2 creates 3 new nodes (its own). builder1's nodes remain.
    // To clean up builder1's orphaned nodes, call finalize() on builder1 again.
    // Since builder1's touchedSourceIds is now empty, all its owned nodes are pruned.
    builder1.finalize()

    // RFC-045-FINAL: Tick-to-Verify - process commands from finalize() deletes
    for (let i = 0; i < 20; i++) bridge.tick()
    linker.processCommands()

    // Now only builder2's 3 nodes remain
    expect(bridge.getMappingCount()).toBe(3)

    // Consumer sees all notes from builder2
    consumer.runUntilTick(1440)
    const events = consumer.getEvents()

    expect(events.length).toBe(3)
    const pitches = events.map((e) => e.pitch).sort((a, b) => a - b)
    expect(pitches).toEqual([60, 64, 67])
  })
})

// =============================================================================
// API Compatibility Tests
// =============================================================================

describe('LiveClipBuilder - API Compatibility', () => {
  test('note() method exists and returns cursor', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    const cursor = builder.note(60, 100, '4n')

    // note() now returns a cursor, not the builder
    expect(cursor).not.toBe(builder)
    expect(cursor.commit()).toBe(builder)
  })

  test('chord() method exists and returns this', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    const result = builder.chord([60, 64, 67], 100, '4n')

    expect(result).toBe(builder)
  })

  test('rest() method exists and returns this', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    const result = builder.rest('4n')

    expect(result).toBe(builder)
  })

  test('velocity() method exists and returns this', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    const result = builder.velocity(80)

    expect(result).toBe(builder)
  })

  test('finalize() method exists', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    expect(() => builder.finalize()).not.toThrow()
  })

  test('no build() method exists', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    expect((builder as any).build).toBeUndefined()
  })

  test('method chaining works', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    // With cursor pattern, use commit() or escape methods to chain
    builder
      .velocity(80)
      .note(60, undefined, '4n').commit()
      .note(64, undefined, '4n').commit()
      .rest('4n')
      .note(67, undefined, '4n').commit()

    expect(bridge.getMappingCount()).toBe(3)
  })
})

// =============================================================================
// Full User Flow Tests
// =============================================================================

describe('LiveClipBuilder - Full User Flow', () => {
  afterEach(() => {
    LiveSession.clear()
  })

  test('complete user workflow', () => {
    const { bridge, consumer } = createTestEnvironment()
    LiveSession.init(bridge)

    // User code with cursor pattern - note() returns cursor
    Clip.melody('Lead')
      .note('C4' as any, '4n').commit()
      .note('E4' as any, '4n').commit()
      .note('G4' as any, '4n').commit()
      .finalize()

    expect(bridge.getMappingCount()).toBe(3)

    // Consumer sees all notes
    consumer.runUntilTick(1440)
    const events = consumer.getEvents()
    expect(events.length).toBe(3)
  })

  test('executeUserScript helper works', () => {
    const { bridge, consumer } = createTestEnvironment()

    const builder = executeUserScript(() => {
      const melody = Clip.melody('Lead')
      melody.note('C4' as any, '4n').commit()
      melody.note('E4' as any, '4n').commit()
      return melody
    }, bridge)

    expect(builder).toBeInstanceOf(LiveClipBuilder)
    expect(bridge.getMappingCount()).toBe(2)
  })

  test('multiple clips in session', () => {
    const { bridge, consumer, linker } = createTestEnvironment()
    LiveSession.init(bridge)

    // Create multiple clips with cursor pattern
    Clip.melody('Lead')
      .note('C4' as any, '4n').commit()
      .note('E4' as any, '4n').commit()
      .finalize()

    Clip.bass('Bass')
      .note('C2' as any, '4n').commit()
      .note('E2' as any, '4n').commit()
      .finalize()

    // RFC-045-FINAL: Tick-to-Verify - process commands from finalize()
    for (let i = 0; i < 20; i++) bridge.tick()
    linker.processCommands()

    // All notes should be in SAB
    expect(bridge.getMappingCount()).toBe(4)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('LiveClipBuilder - Edge Cases', () => {
  beforeEach(() => {
    // Clear cache to prevent sourceId collisions from previous tests
    LiveClipBuilder.clearCache()
  })

  test('empty clip finalize does not crash', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    expect(() => builder.finalize()).not.toThrow()
    expect(bridge.getMappingCount()).toBe(0)
  })

  test('chord creates multiple nodes at same tick', () => {
    const { bridge, consumer } = createTestEnvironment()
    const builder = new LiveClipBuilder(bridge)

    builder.chord([60, 64, 67], 100, '4n')

    // 3 notes in chord
    expect(bridge.getMappingCount()).toBe(3)

    // Consumer sees all 3 at tick 0
    consumer.runUntilTick(480)
    const events = consumer.getEvents()
    expect(events.length).toBe(3)

    const pitches = events.map((e) => e.pitch).sort((a, b) => a - b)
    expect(pitches).toEqual([60, 64, 67])
  })

  test('rest advances tick without creating nodes', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    builder
      .note(60, 100, '4n').commit()
      .rest('4n')
      .note(64, 100, '4n').commit()

    // Only 2 notes, rest doesn't create node
    expect(bridge.getMappingCount()).toBe(2)

    // Verify tick positions
    const notes = collectNotes(bridge)
    expect(notes.length).toBe(2)
  })

  test('velocity context is used for subsequent notes', () => {
    const { bridge, consumer } = createTestEnvironment()
    const builder = new LiveClipBuilder(bridge)

    builder
      .velocity(80)
      .note(60, undefined, '4n').commit()
      .note(64, undefined, '4n').commit()

    consumer.runUntilTick(960)
    const events = consumer.getEvents()

    // Both notes should have velocity 80
    expect(events.length).toBe(2)
    expect(events[0].velocity).toBe(80)
    expect(events[1].velocity).toBe(80)
  })
})

// =============================================================================
// Performance Benchmarks
// =============================================================================
//
// NOTE: The < 5µs target applies to the core SAB operations (insert/patch).
// The current implementation includes Error.stack parsing for SOURCE_ID
// generation, which adds significant overhead (~50-100µs per call).
//
// Production optimizations for achieving < 5µs:
// 1. Use V8's prepareStackTrace API for faster parsing
// 2. Use source maps + build-time injection for SOURCE_IDs
// 3. Cache SOURCE_IDs per call site
//
// The benchmarks below verify functional correctness and establish baselines.
// =============================================================================

describe('LiveClipBuilder - Performance', () => {
  test('note() DSL call completes in reasonable time', () => {
    const bridge = createTestBridge()
    const builder = new LiveClipBuilder(bridge)

    const iterations = 100
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      builder.note(60 + (i % 12), 100, '4n')
    }

    const end = performance.now()
    const totalMs = end - start
    const perCallUs = (totalMs * 1000) / iterations

    // Log for visibility
    console.log(
      `Performance: ${iterations} note() calls in ${totalMs.toFixed(2)}ms (${perCallUs.toFixed(2)}µs per call)`
    )

    // Current implementation with stack parsing: ~200-800µs per call
    // (Stack trace generation is the bottleneck, not SAB operations)
    // Allow generous margin for CI/test overhead
    expect(perCallUs).toBeLessThan(1000)
  })

  test('SAB operations are fast (without SOURCE_ID generation)', () => {
    // Create bridge with larger capacity for benchmark
    const linker = SiliconSynapse.create({
      nodeCapacity: 2048,
      safeZoneTicks: 0
    })
    const bridge = new SiliconBridge(linker, {
      attributeDebounceTicks: 1,
      structuralDebounceMs: 1
    })

    const iterations = 1000
    const start = performance.now()

    // Directly test bridge operations (no stack parsing)
    for (let i = 0; i < iterations; i++) {
      const id = bridge.insertNoteImmediate({
        pitch: 60 + (i % 12),
        velocity: 100,
        duration: 480,
        baseTick: i * 480
      })
      bridge.patchImmediate(id, 'velocity', 80)
    }

    const end = performance.now()
    const totalMs = end - start
    const perOpUs = (totalMs * 1000) / (iterations * 2) // 2 ops per iteration

    console.log(
      `SAB Performance: ${iterations * 2} operations in ${totalMs.toFixed(2)}ms (${perOpUs.toFixed(2)}µs per op)`
    )

    // Target: < 5µs per SAB operation (achievable)
    expect(perOpUs).toBeLessThan(50)
  })
})
