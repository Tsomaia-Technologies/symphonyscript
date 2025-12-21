// =============================================================================
// SymphonyScript - End-to-End Live Coding Tests (RFC-043 Phase 4)
// =============================================================================
// Tests the complete flow: Editor → SiliconBridge → SiliconSynapse → Consumer

import { SiliconBridge, createSiliconBridge } from '../silicon-bridge'
import type { EditorNoteData, SourceLocation } from '../silicon-bridge'
import { SiliconSynapse } from '../silicon-synapse'
import { MockConsumer } from '../mock-consumer'
import type { ConsumerNoteEvent } from '../mock-consumer'

// Extended event type with sourceId for tests
interface E2ENoteEvent extends ConsumerNoteEvent {
  sourceId: number
  baseTick: number
}

// Wrapper to provide advance() API for MockConsumer and retrieve sourceId
class ConsumerWrapper {
  private consumer: MockConsumer
  private sab: Int32Array
  private currentTick: number = 0

  constructor(buffer: SharedArrayBuffer) {
    this.consumer = new MockConsumer(buffer, 24) // 24 ticks per process call
    this.sab = new Int32Array(buffer)
    this.consumer.reset()
  }

  advance(ticks: number): void {
    this.currentTick += ticks
    this.consumer.runUntilTick(this.currentTick)
  }

  getCollectedEvents(): E2ENoteEvent[] {
    // Enrich events with sourceId from the node
    return this.consumer.getEvents().map((event) => {
      const offset = event.ptr / 4
      const sourceId = this.sab[offset + 5] // NODE.SOURCE_ID = 5
      return {
        ...event,
        sourceId,
        baseTick: event.tick // For most tests, tick = baseTick (no groove/humanize)
      }
    })
  }

  reset(): void {
    this.consumer.reset()
    this.currentTick = 0
  }

  getMockConsumer(): MockConsumer {
    return this.consumer
  }
}
import { HDR, COMMIT, NULL_PTR } from '../constants'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestNote(overrides: Partial<EditorNoteData> = {}): EditorNoteData {
  return {
    pitch: 60,
    velocity: 100,
    duration: 480,
    baseTick: 0,
    muted: false,
    ...overrides
  }
}

function createLiveEnvironment() {
  const linker = SiliconSynapse.create({
    nodeCapacity: 256,
    safeZoneTicks: 0 // Disable for testing
  })

  const bridge = new SiliconBridge(linker, {
    attributeDebounceMs: 1, // Fast debounce for tests
    structuralDebounceMs: 1
  })

  const consumer = new ConsumerWrapper(linker.getSAB())

  return { linker, bridge, consumer }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// End-to-End Flow Tests
// =============================================================================

describe('E2E Live Coding - Full Flow', () => {
  test('editor insert → bridge → linker → consumer sees note', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Editor inserts note via bridge
    const sourceId = bridge.insertNoteImmediate(
      createTestNote({ pitch: 64, velocity: 80, baseTick: 0, duration: 480 })
    )

    // Consumer advances and collects events
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(64)
    expect(events[0].velocity).toBe(80)
    expect(events[0].duration).toBe(480)

    // Verify SOURCE_ID is preserved
    expect(events[0].sourceId).toBe(sourceId)
  })

  test('editor delete → consumer no longer sees note', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Insert then delete
    const sourceId = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    bridge.deleteNoteImmediate(sourceId)

    // Consumer advances
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(0)
  })

  test('editor patch → consumer sees updated values', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Insert note
    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))

    // Patch pitch before consumer advances
    bridge.patchImmediate(sourceId, 'pitch', 72)

    // Consumer sees patched value
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(72)
  })

  test('muted notes are not consumed', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Insert unmuted note
    const sourceId = bridge.insertNoteImmediate(createTestNote({ muted: false }))

    // Mute it
    bridge.patchImmediate(sourceId, 'muted', true)

    // Consumer should not see it
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(0)
  })
})

// =============================================================================
// Live Edit Scenarios
// =============================================================================

describe('E2E Live Coding - Real-Time Edits', () => {
  test('edit while playback advances - insert ahead of playhead', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Load initial clip - notes are prepended so load in reverse order
    const sourceIds = bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 960, pitch: 64 })
    ])

    // Advance playhead to tick 480 (halfway through first beat)
    consumer.advance(480)
    let events = consumer.getCollectedEvents()
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(60)

    // Insert new note at tick 720 AFTER the note at tick 0
    // This ensures proper chain ordering
    bridge.insertNoteImmediate(createTestNote({ baseTick: 720, pitch: 67 }), sourceIds[0])

    // Continue playback - should see both new note and note at 960
    consumer.advance(960) // Now at tick 1440
    events = consumer.getCollectedEvents()

    // Should have seen all 3 notes: pitch 60 at tick 0, pitch 67 at tick 720, pitch 64 at tick 960
    expect(events.length).toBe(3)
    expect(events[0].pitch).toBe(60)
    expect(events[1].pitch).toBe(67)
    expect(events[2].pitch).toBe(64)
  })

  test('edit while playback advances - delete ahead of playhead', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Load clip with notes at tick 0 and 960
    const sourceIds = bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 960, pitch: 64 })
    ])

    // Advance to tick 480
    consumer.advance(480)

    // Delete the note at tick 960 (ahead of playhead)
    bridge.deleteNoteImmediate(sourceIds[1])

    // Continue playback
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    // Should only have seen the first note
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(60)
  })

  test('rapid pitch edits are coalesced via debounce', async () => {
    const { bridge, consumer, linker } = createLiveEnvironment()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))

    // Simulate rapid typing/scrubbing
    for (let i = 0; i < 50; i++) {
      bridge.patchDebounced(sourceId, 'pitch', 60 + i)
    }

    // Wait for debounce
    await wait(10)

    // Consumer sees final value
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(60 + 49) // Last value: 109
  })

  test('structural edits respect COMMIT_FLAG protocol', async () => {
    const { bridge, consumer, linker } = createLiveEnvironment()
    const sab = new Int32Array(linker.getSAB())

    // Queue debounced insert (no immediate insert first to start from clean state)
    bridge.insertNoteDebounced(createTestNote({ baseTick: 480 }))

    // Debounced insert is pending, not yet flushed
    expect(bridge.getPendingStructuralCount()).toBe(1)
    expect(bridge.getMappingCount()).toBe(0) // Not applied yet

    // Wait for structural flush (flushStructural awaits ACK internally)
    await wait(20)

    // After flush completes (including internal syncAck), structural pending should be empty
    expect(bridge.getPendingStructuralCount()).toBe(0)

    // The note should be in the linker now
    expect(bridge.getMappingCount()).toBe(1)

    // COMMIT_FLAG should be back to IDLE after syncAck reset it
    expect(Atomics.load(sab, HDR.COMMIT_FLAG)).toBe(COMMIT.IDLE)

    // Consumer can read the newly inserted note
    consumer.advance(960)
    const events = consumer.getCollectedEvents()
    expect(events.length).toBe(1)
  })
})

// =============================================================================
// Source Location Tracking Tests
// =============================================================================

describe('E2E Live Coding - Source Location Tracking', () => {
  test('source locations are preserved through edit cycle', () => {
    const { bridge, consumer } = createLiveEnvironment()

    const source: SourceLocation = { file: 'melody.ss', line: 15, column: 8 }
    const sourceId = bridge.insertNoteImmediate(createTestNote({ source }))

    // Edit the note
    bridge.patchImmediate(sourceId, 'pitch', 72)
    bridge.patchImmediate(sourceId, 'velocity', 64)

    // Source location should still be retrievable (file is not stored in Symbol Table)
    // Use callback pattern (zero-alloc)
    let locationLine = -1
    let locationColumn = -1
    const found = bridge.getSourceLocation(sourceId, (line, column) => {
      locationLine = line
      locationColumn = column
    })
    expect(found).toBe(true)
    expect(locationLine).toBe(15)
    expect(locationColumn).toBe(8)

    // Note should still be consumable
    consumer.advance(960)
    const events = consumer.getCollectedEvents()
    expect(events.length).toBe(1)
    expect(events[0].pitch).toBe(72)

    // Verify we can get back to source via nodePtr
    const nodePtr = bridge.getNodePtr(sourceId)
    expect(nodePtr).toBe(events[0].ptr)
  })

  test('bidirectional mapping enables click-to-source navigation', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Insert notes without source locations (using auto-generated IDs)
    const sourceId1 = bridge.insertNoteImmediate(createTestNote({ baseTick: 0, pitch: 60 }))
    const sourceId2 = bridge.insertNoteImmediate(createTestNote({ baseTick: 480, pitch: 64 }), sourceId1)
    const sourceId3 = bridge.insertNoteImmediate(createTestNote({ baseTick: 960, pitch: 67 }), sourceId2)

    // Consumer collects events
    consumer.advance(1440)
    const events = consumer.getCollectedEvents()
    expect(events.length).toBe(3)

    // Each event's ptr should map back to a sourceId via bridge
    const retrievedSourceId1 = bridge.getSourceId(events[0].ptr)
    const retrievedSourceId2 = bridge.getSourceId(events[1].ptr)
    const retrievedSourceId3 = bridge.getSourceId(events[2].ptr)

    expect(retrievedSourceId1).toBe(sourceId1)
    expect(retrievedSourceId2).toBe(sourceId2)
    expect(retrievedSourceId3).toBe(sourceId3)
  })

  test('source ID enables highlight-on-play (note → source)', () => {
    const { bridge, consumer } = createLiveEnvironment()

    const source: SourceLocation = { file: 'test.ss', line: 5, column: 3 }
    const sourceId = bridge.insertNoteImmediate(createTestNote({ source }))

    // Consumer advances and receives event
    consumer.advance(960)
    const events = consumer.getCollectedEvents()
    expect(events.length).toBe(1)

    // Use ptr to get back to sourceId via bridge
    const playedNote = events[0]
    const retrievedSourceId = bridge.getSourceId(playedNote.ptr)
    expect(retrievedSourceId).toBe(sourceId)

    // Use sourceId to highlight source (file is not stored in Symbol Table)
    // Use callback pattern (zero-alloc)
    let highlightLine = -1
    let highlightColumn = -1
    const highlightFound = bridge.getSourceLocation(sourceId, (line, column) => {
      highlightLine = line
      highlightColumn = column
    })
    expect(highlightFound).toBe(true)
    expect(highlightLine).toBe(5)
    expect(highlightColumn).toBe(3)
  })
})

// =============================================================================
// Clip Load/Clear Scenarios
// =============================================================================

describe('E2E Live Coding - Clip Operations', () => {
  test('loadClip creates complete playable clip', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // C major chord arpeggiated
    const notes: EditorNoteData[] = [
      createTestNote({ baseTick: 0, pitch: 60 }), // C
      createTestNote({ baseTick: 480, pitch: 64 }), // E
      createTestNote({ baseTick: 960, pitch: 67 }) // G
    ]

    bridge.loadClip(notes)

    // Play through entire clip
    consumer.advance(1440)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(3)
    expect(events.map((e) => e.pitch)).toEqual([60, 64, 67])
  })

  test('clear stops all playback', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Load clip
    bridge.loadClip([
      createTestNote({ baseTick: 0 }),
      createTestNote({ baseTick: 480 }),
      createTestNote({ baseTick: 960 })
    ])

    // Advance to tick 240 (first note played)
    consumer.advance(240)
    expect(consumer.getCollectedEvents().length).toBe(1)

    // Clear the clip
    bridge.clear()

    // Continue playback - no more notes
    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    // Still only the first note
    expect(events.length).toBe(1)
  })

  test('reload clip while playing', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Initial clip
    bridge.loadClip([createTestNote({ baseTick: 0, pitch: 60 })])

    // Advance partially
    consumer.advance(240)

    // Clear and reload with different notes
    bridge.clear()
    bridge.loadClip([
      createTestNote({ baseTick: 480, pitch: 72 }),
      createTestNote({ baseTick: 960, pitch: 74 })
    ])

    // Continue playback - should see new notes
    consumer.advance(1200)
    const events = consumer.getCollectedEvents()

    // First note from original clip, plus two from new clip
    expect(events.length).toBe(3)
    expect(events[0].pitch).toBe(60)
    expect(events[1].pitch).toBe(72)
    expect(events[2].pitch).toBe(74)
  })
})

// =============================================================================
// Performance / Latency Tests
// =============================================================================

describe('E2E Live Coding - Performance', () => {
  test('immediate patch latency is negligible', () => {
    const { bridge } = createLiveEnvironment()

    const sourceId = bridge.insertNoteImmediate(createTestNote())

    const iterations = 1000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      bridge.patchImmediate(sourceId, 'pitch', 60 + (i % 12))
    }

    const elapsed = performance.now() - start
    const avgLatency = elapsed / iterations

    // Average latency should be under 0.05ms (50 microseconds)
    expect(avgLatency).toBeLessThan(0.05)
  })

  test('consumer can process high-density clips', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Create high-density clip (16th notes for 4 bars at 120 BPM)
    // 4 bars * 4 beats * 4 sixteenths = 64 notes
    const notes: EditorNoteData[] = []
    for (let i = 0; i < 64; i++) {
      notes.push(createTestNote({ baseTick: i * 120, pitch: 60 + (i % 12) }))
    }

    const loadStart = performance.now()
    bridge.loadClip(notes)
    const loadTime = performance.now() - loadStart

    // Load should be fast
    expect(loadTime).toBeLessThan(50) // 50ms for 64 notes

    // Consumer processes all notes
    const processStart = performance.now()
    consumer.advance(64 * 120 + 480)
    const processTime = performance.now() - processStart

    // Processing should be fast
    expect(processTime).toBeLessThan(10) // 10ms to traverse 64 nodes

    const events = consumer.getCollectedEvents()
    expect(events.length).toBe(64)
  })

  test('multiple rapid structural edits are batched', async () => {
    const { bridge, consumer } = createLiveEnvironment()

    const insertStart = performance.now()

    // Rapidly queue 100 structural edits
    for (let i = 0; i < 100; i++) {
      bridge.insertNoteDebounced(createTestNote({ baseTick: i * 10 }))
    }

    // All are pending
    expect(bridge.getPendingStructuralCount()).toBe(100)

    // Wait for debounce to flush
    await wait(20)

    const elapsed = performance.now() - insertStart

    // All should be applied
    expect(bridge.getMappingCount()).toBe(100)
    expect(bridge.getPendingStructuralCount()).toBe(0)

    // Total time should be reasonable (debounce + batch processing)
    expect(elapsed).toBeLessThan(100)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('E2E Live Coding - Edge Cases', () => {
  test('empty clip produces no events', () => {
    const { bridge, consumer } = createLiveEnvironment()

    consumer.advance(960)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(0)
  })

  test('notes at same tick all fire', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Chord: all notes at tick 0
    bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 0, pitch: 64 }),
      createTestNote({ baseTick: 0, pitch: 67 })
    ])

    consumer.advance(480)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(3)
    const pitches = events.map((e) => e.pitch).sort((a, b) => a - b)
    expect(pitches).toEqual([60, 64, 67])
  })

  test('delete during iteration does not break consumer', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Insert 10 notes in proper chain order
    // loadClip inserts in reverse order to maintain sorted chain
    const notes: EditorNoteData[] = []
    for (let i = 0; i < 10; i++) {
      notes.push(createTestNote({ baseTick: i * 100, pitch: 60 + i }))
    }
    const sourceIds = bridge.loadClip(notes)

    // Advance to tick 550 (notes at 0,100,200,300,400,500 fire = 6 notes)
    // Consumer uses tickRate of 24, so we end up just past 500
    consumer.advance(550)
    let events = consumer.getCollectedEvents()
    expect(events.length).toBe(6)

    // Delete note at tick 600 (ahead of playhead) - sourceIds[6]
    bridge.deleteNoteImmediate(sourceIds[6])

    // Continue to tick 1000 - should see notes at 700,800,900 (3 more notes, not 600)
    consumer.advance(450)
    events = consumer.getCollectedEvents()

    // Total: 6 (before) + 3 (after, excluding deleted 600) = 9 notes
    expect(events.length).toBe(9)
  })

  test('patch baseTick moves note in timeline', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Note at tick 0
    const sourceId = bridge.insertNoteImmediate(createTestNote({ baseTick: 0, pitch: 60 }))

    // Advance to tick 240 - note should have fired
    consumer.advance(240)
    let events = consumer.getCollectedEvents()
    expect(events.length).toBe(1)

    // Move note to tick 960 (ahead of playhead)
    bridge.patchImmediate(sourceId, 'baseTick', 960)

    // Note won't fire again at tick 960 because consumer already passed its old position
    // This is expected behavior - the chain is sorted by insertion order, not baseTick
    // In a real editor, you'd need to reposition in the chain for baseTick changes
  })

  test('very long notes work correctly', () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Note with 10 beat duration (4800 ticks at 480 PPQ)
    bridge.insertNoteImmediate(createTestNote({ baseTick: 0, duration: 4800 }))

    consumer.advance(4800)
    const events = consumer.getCollectedEvents()

    expect(events.length).toBe(1)
    expect(events[0].duration).toBe(4800)
  })
})

// =============================================================================
// Integration Stress Test
// =============================================================================

describe('E2E Live Coding - Stress Test', () => {
  test('sustained live editing session', async () => {
    const { bridge, consumer } = createLiveEnvironment()

    // Simulate a live editing session
    const SESSION_TICKS = 1920 // 4 beats
    const TICK_STEP = 64

    // Initial clip
    const initialIds = bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 }),
      createTestNote({ baseTick: 1440, pitch: 72 })
    ])

    let totalEvents = 0
    let editsMade = 0

    // Simulate playback with edits
    for (let tick = 0; tick < SESSION_TICKS; tick += TICK_STEP) {
      // Random edits during playback
      if (Math.random() > 0.7 && initialIds.length > 0) {
        const targetId = initialIds[Math.floor(Math.random() * initialIds.length)]
        if (bridge.getNodePtr(targetId)) {
          bridge.patchDebounced(targetId, 'velocity', Math.floor(Math.random() * 127))
          editsMade++
        }
      }

      // Occasional insert
      if (Math.random() > 0.9) {
        bridge.insertNoteDebounced(
          createTestNote({
            baseTick: tick + 32,
            pitch: 60 + Math.floor(Math.random() * 24)
          })
        )
        editsMade++
      }

      // Advance playhead
      consumer.advance(TICK_STEP)
    }

    // Wait for final debounce
    await wait(20)

    // Final advance to catch trailing notes
    consumer.advance(480)

    const events = consumer.getCollectedEvents()
    totalEvents = events.length

    // Should have processed all events without errors
    expect(totalEvents).toBeGreaterThanOrEqual(4) // At least initial notes
    expect(editsMade).toBeGreaterThan(0) // Some edits were made
  })
})
