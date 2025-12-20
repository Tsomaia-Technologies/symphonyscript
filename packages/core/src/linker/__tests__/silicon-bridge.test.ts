// =============================================================================
// SymphonyScript - Silicon Bridge Tests (RFC-043 Phase 4)
// =============================================================================

import { SiliconBridge, createSiliconBridge } from '../silicon-bridge'
import type { EditorNoteData, PatchType, SourceLocation } from '../silicon-bridge'
import { SiliconLinker } from '../silicon-linker'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestLinker(): SiliconLinker {
  return SiliconLinker.create({
    nodeCapacity: 256,
    safeZoneTicks: 0 // Disable safe zone for testing
  })
}

function createTestBridge(): SiliconBridge {
  const linker = createTestLinker()
  return new SiliconBridge(linker, {
    attributeDebounceMs: 10,
    structuralDebounceMs: 10
  })
}

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

// Helper to wait for debounce
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Helper to collect notes from traverseNotes into an array for test assertions
function collectNotes(bridge: SiliconBridge): Array<{ sourceId: number; note: EditorNoteData }> {
  const notes: Array<{ sourceId: number; note: EditorNoteData }> = []
  bridge.traverseNotes((sourceId, pitch, velocity, duration, baseTick, muted) => {
    notes.push({
      sourceId,
      note: { pitch, velocity, duration, baseTick, muted }
    })
  })
  return notes
}

// =============================================================================
// Source ID Generation Tests
// =============================================================================

describe('SiliconBridge - Source ID Generation', () => {
  test('generates unique source IDs without source location', () => {
    const bridge = createTestBridge()

    const id1 = bridge.generateSourceId()
    const id2 = bridge.generateSourceId()
    const id3 = bridge.generateSourceId()

    expect(id1).not.toBe(id2)
    expect(id2).not.toBe(id3)
    expect(id1).not.toBe(id3)
  })

  test('generates deterministic source IDs from source location', () => {
    const bridge = createTestBridge()

    const source: SourceLocation = { file: 'test.ss', line: 10, column: 5 }

    const id1 = bridge.generateSourceId(source)
    const id2 = bridge.generateSourceId(source)

    // Same source should produce same ID
    expect(id1).toBe(id2)
  })

  test('generates different IDs for different source locations', () => {
    const bridge = createTestBridge()

    const source1: SourceLocation = { file: 'test.ss', line: 10, column: 5 }
    const source2: SourceLocation = { file: 'test.ss', line: 11, column: 5 }
    const source3: SourceLocation = { file: 'other.ss', line: 10, column: 5 }

    const id1 = bridge.generateSourceId(source1)
    const id2 = bridge.generateSourceId(source2)
    const id3 = bridge.generateSourceId(source3)

    expect(id1).not.toBe(id2)
    expect(id2).not.toBe(id3)
  })

  test('stores source location for reverse lookup', () => {
    const bridge = createTestBridge()

    const source: SourceLocation = { file: 'test.ss', line: 10, column: 5 }
    const id = bridge.generateSourceId(source)

    const retrieved = bridge.getSourceLocation(id)

    expect(retrieved).toEqual(source)
  })
})

// =============================================================================
// Bidirectional Mapping Tests
// =============================================================================

describe('SiliconBridge - Bidirectional Mapping', () => {
  test('maps SOURCE_ID to NodePtr after insert', () => {
    const bridge = createTestBridge()

    const note = createTestNote()
    const sourceId = bridge.insertNoteImmediate(note)

    const ptr = bridge.getNodePtr(sourceId)

    expect(ptr).toBeDefined()
    expect(ptr).not.toBe(0)
  })

  test('maps NodePtr to SOURCE_ID after insert', () => {
    const bridge = createTestBridge()

    const note = createTestNote()
    const sourceId = bridge.insertNoteImmediate(note)
    const ptr = bridge.getNodePtr(sourceId)!

    const retrievedId = bridge.getSourceId(ptr)

    expect(retrievedId).toBe(sourceId)
  })

  test('removes mapping after delete', () => {
    const bridge = createTestBridge()

    const note = createTestNote()
    const sourceId = bridge.insertNoteImmediate(note)
    const ptr = bridge.getNodePtr(sourceId)!

    bridge.deleteNoteImmediate(sourceId)

    expect(bridge.getNodePtr(sourceId)).toBeUndefined()
    expect(bridge.getSourceId(ptr)).toBeUndefined()
  })

  test('getAllSourceIds returns all registered IDs', () => {
    const bridge = createTestBridge()

    const id1 = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    const id2 = bridge.insertNoteImmediate(createTestNote({ baseTick: 480 }))
    const id3 = bridge.insertNoteImmediate(createTestNote({ baseTick: 960 }))

    const ids = bridge.getAllSourceIds()

    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
    expect(ids).toContain(id3)
    expect(ids.length).toBe(3)
  })

  test('getMappingCount returns correct count', () => {
    const bridge = createTestBridge()

    expect(bridge.getMappingCount()).toBe(0)

    bridge.insertNoteImmediate(createTestNote())
    expect(bridge.getMappingCount()).toBe(1)

    bridge.insertNoteImmediate(createTestNote({ baseTick: 480 }))
    expect(bridge.getMappingCount()).toBe(2)
  })
})

// =============================================================================
// Immediate Operations Tests
// =============================================================================

describe('SiliconBridge - Immediate Operations', () => {
  test('insertNoteImmediate creates node in linker', () => {
    const bridge = createTestBridge()

    const note = createTestNote({ pitch: 64, velocity: 80, duration: 240, baseTick: 100 })
    const sourceId = bridge.insertNoteImmediate(note)

    const readNote = bridge.readNote(sourceId)

    expect(readNote).toBeDefined()
    expect(readNote!.pitch).toBe(64)
    expect(readNote!.velocity).toBe(80)
    expect(readNote!.duration).toBe(240)
    expect(readNote!.baseTick).toBe(100)
  })

  test('insertNoteImmediate with afterSourceId inserts after specified node', () => {
    const bridge = createTestBridge()

    const id1 = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    const id2 = bridge.insertNoteImmediate(createTestNote({ baseTick: 960 }), id1)
    const id3 = bridge.insertNoteImmediate(createTestNote({ baseTick: 480 }), id1)

    // Verify chain order via iteration
    const notes = collectNotes(bridge)
    const ticks = notes.map((n) => n.note.baseTick)

    // insertHead prepends, so order depends on insertion order
    // id1 was inserted first (baseTick 0)
    // id2 was inserted after id1 (baseTick 960)
    // id3 was inserted after id1 (baseTick 480), so between id1 and id2
    expect(ticks).toEqual([0, 480, 960])
  })

  test('insertNoteImmediate with invalid afterSourceId throws', () => {
    const bridge = createTestBridge()

    expect(() => {
      bridge.insertNoteImmediate(createTestNote(), 99999)
    }).toThrow('Unknown afterSourceId')
  })

  test('deleteNoteImmediate removes node from linker', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())
    bridge.deleteNoteImmediate(sourceId)

    expect(bridge.readNote(sourceId)).toBeUndefined()
  })

  test('deleteNoteImmediate with invalid sourceId throws', () => {
    const bridge = createTestBridge()

    expect(() => {
      bridge.deleteNoteImmediate(99999)
    }).toThrow('Unknown sourceId')
  })

  test('patchImmediate updates pitch', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))
    bridge.patchImmediate(sourceId, 'pitch', 72)

    expect(bridge.readNote(sourceId)!.pitch).toBe(72)
  })

  test('patchImmediate updates velocity', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ velocity: 100 }))
    bridge.patchImmediate(sourceId, 'velocity', 64)

    expect(bridge.readNote(sourceId)!.velocity).toBe(64)
  })

  test('patchImmediate updates duration', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ duration: 480 }))
    bridge.patchImmediate(sourceId, 'duration', 240)

    expect(bridge.readNote(sourceId)!.duration).toBe(240)
  })

  test('patchImmediate updates baseTick', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    bridge.patchImmediate(sourceId, 'baseTick', 960)

    expect(bridge.readNote(sourceId)!.baseTick).toBe(960)
  })

  test('patchImmediate updates muted state', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ muted: false }))
    expect(bridge.readNote(sourceId)!.muted).toBe(false)

    bridge.patchImmediate(sourceId, 'muted', true)
    expect(bridge.readNote(sourceId)!.muted).toBe(true)

    bridge.patchImmediate(sourceId, 'muted', false)
    expect(bridge.readNote(sourceId)!.muted).toBe(false)
  })

  test('patchImmediate with invalid sourceId throws', () => {
    const bridge = createTestBridge()

    expect(() => {
      bridge.patchImmediate(99999, 'pitch', 60)
    }).toThrow('Unknown sourceId')
  })
})

// =============================================================================
// Debounced Operations Tests
// =============================================================================

describe('SiliconBridge - Debounced Operations', () => {
  test('patchDebounced queues patch', async () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))
    bridge.patchDebounced(sourceId, 'pitch', 72)

    // Before flush, original value should remain
    expect(bridge.getPendingPatchCount()).toBe(1)
  })

  test('patchDebounced coalesces multiple patches to same field', async () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))

    // Queue multiple patches to same field
    bridge.patchDebounced(sourceId, 'pitch', 72)
    bridge.patchDebounced(sourceId, 'pitch', 80)
    bridge.patchDebounced(sourceId, 'pitch', 64)

    // Should only have one pending patch (the latest)
    expect(bridge.getPendingPatchCount()).toBe(1)

    // Wait for debounce
    await wait(20)

    // Final value should be 64
    expect(bridge.readNote(sourceId)!.pitch).toBe(64)
  })

  test('patchDebounced does not coalesce different fields', async () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())

    bridge.patchDebounced(sourceId, 'pitch', 72)
    bridge.patchDebounced(sourceId, 'velocity', 80)

    // Should have two pending patches
    expect(bridge.getPendingPatchCount()).toBe(2)

    // Wait for debounce
    await wait(20)

    expect(bridge.readNote(sourceId)!.pitch).toBe(72)
    expect(bridge.readNote(sourceId)!.velocity).toBe(80)
  })

  test('flushPatches applies all pending patches', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())

    bridge.patchDebounced(sourceId, 'pitch', 72)
    bridge.patchDebounced(sourceId, 'velocity', 80)

    // Manually flush
    bridge.flushPatches()

    expect(bridge.getPendingPatchCount()).toBe(0)
    expect(bridge.readNote(sourceId)!.pitch).toBe(72)
    expect(bridge.readNote(sourceId)!.velocity).toBe(80)
  })

  test('onPatchApplied callback is called', () => {
    const linker = createTestLinker()
    const patches: { sourceId: number; type: PatchType; value: number | boolean }[] = []

    const bridge = new SiliconBridge(linker, {
      onPatchApplied: (sourceId, type, value) => {
        patches.push({ sourceId, type, value })
      }
    })

    const sourceId = bridge.insertNoteImmediate(createTestNote())
    bridge.patchImmediate(sourceId, 'pitch', 72)

    expect(patches.length).toBe(1)
    expect(patches[0]).toEqual({ sourceId, type: 'pitch', value: 72 })
  })
})

// =============================================================================
// Structural Debounce Tests
// =============================================================================

describe('SiliconBridge - Structural Debounce', () => {
  test('insertNoteDebounced queues insert', () => {
    const bridge = createTestBridge()

    bridge.insertNoteDebounced(createTestNote())

    expect(bridge.getPendingStructuralCount()).toBe(1)
    expect(bridge.getMappingCount()).toBe(0) // Not yet applied
  })

  test('deleteNoteDebounced queues delete', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())
    bridge.deleteNoteDebounced(sourceId)

    expect(bridge.getPendingStructuralCount()).toBe(1)
    expect(bridge.getMappingCount()).toBe(1) // Not yet deleted
  })

  test('flushStructural processes operations in order', async () => {
    const bridge = createTestBridge()

    // Queue multiple operations
    bridge.insertNoteDebounced(createTestNote({ baseTick: 0 }))
    bridge.insertNoteDebounced(createTestNote({ baseTick: 480 }))

    expect(bridge.getPendingStructuralCount()).toBe(2)
    expect(bridge.getMappingCount()).toBe(0)

    // Wait for debounce
    await wait(20)

    expect(bridge.getPendingStructuralCount()).toBe(0)
    expect(bridge.getMappingCount()).toBe(2)
  })

  test('hasPending returns true when operations pending', () => {
    const bridge = createTestBridge()

    expect(bridge.hasPending()).toBe(false)

    bridge.patchDebounced(bridge.insertNoteImmediate(createTestNote()), 'pitch', 72)
    expect(bridge.hasPending()).toBe(true)

    bridge.flushPatches()
    expect(bridge.hasPending()).toBe(false)
  })
})

// =============================================================================
// Batch Operations Tests
// =============================================================================

describe('SiliconBridge - Batch Operations', () => {
  test('loadClip inserts all notes', () => {
    const bridge = createTestBridge()

    const notes: EditorNoteData[] = [
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 })
    ]

    const sourceIds = bridge.loadClip(notes)

    expect(sourceIds.length).toBe(3)
    expect(bridge.getMappingCount()).toBe(3)
  })

  test('loadClip returns SOURCE_IDs in insertion order', () => {
    const bridge = createTestBridge()

    const notes: EditorNoteData[] = [
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 })
    ]

    const sourceIds = bridge.loadClip(notes)

    // Verify each sourceId maps to correct note
    expect(bridge.readNote(sourceIds[0])!.pitch).toBe(60)
    expect(bridge.readNote(sourceIds[1])!.pitch).toBe(64)
    expect(bridge.readNote(sourceIds[2])!.pitch).toBe(67)
  })

  test('loadClip creates sorted chain', () => {
    const bridge = createTestBridge()

    const notes: EditorNoteData[] = [
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 })
    ]

    bridge.loadClip(notes)

    // Iterate and verify order
    const iterated = collectNotes(bridge)
    const ticks = iterated.map((n) => n.note.baseTick)

    expect(ticks).toEqual([0, 480, 960])
  })

  test('clear removes all notes and mappings', () => {
    const bridge = createTestBridge()

    bridge.loadClip([
      createTestNote({ baseTick: 0 }),
      createTestNote({ baseTick: 480 }),
      createTestNote({ baseTick: 960 })
    ])

    expect(bridge.getMappingCount()).toBe(3)

    bridge.clear()

    expect(bridge.getMappingCount()).toBe(0)
    expect(bridge.getAllSourceIds().length).toBe(0)
  })

  test('clear cancels pending operations', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())
    bridge.patchDebounced(sourceId, 'pitch', 72)
    bridge.insertNoteDebounced(createTestNote())

    expect(bridge.hasPending()).toBe(true)

    bridge.clear()

    expect(bridge.hasPending()).toBe(false)
  })
})

// =============================================================================
// Read Operations Tests
// =============================================================================

describe('SiliconBridge - Read Operations', () => {
  test('readNote returns undefined for invalid sourceId', () => {
    const bridge = createTestBridge()

    expect(bridge.readNote(99999)).toBeUndefined()
  })

  test('readNote returns complete note data', () => {
    const bridge = createTestBridge()

    const note = createTestNote({
      pitch: 64,
      velocity: 80,
      duration: 240,
      baseTick: 100,
      muted: true
    })
    const sourceId = bridge.insertNoteImmediate(note)

    const readNote = bridge.readNote(sourceId)

    expect(readNote).toBeDefined()
    expect(readNote!.pitch).toBe(64)
    expect(readNote!.velocity).toBe(80)
    expect(readNote!.duration).toBe(240)
    expect(readNote!.baseTick).toBe(100)
    expect(readNote!.muted).toBe(true)
  })

  test('traverseNotes yields all notes in chain order', () => {
    const bridge = createTestBridge()

    bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 })
    ])

    const notes = collectNotes(bridge)

    expect(notes.length).toBe(3)
    expect(notes[0].note.pitch).toBe(60)
    expect(notes[1].note.pitch).toBe(64)
    expect(notes[2].note.pitch).toBe(67)
  })

  test('traverseNotes includes sourceId with each note', () => {
    const bridge = createTestBridge()

    const sourceIds = bridge.loadClip([createTestNote({ baseTick: 0 })])

    const notes = collectNotes(bridge)

    expect(notes[0].sourceId).toBe(sourceIds[0])
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('SiliconBridge - Error Handling', () => {
  test('onError callback receives errors during flush', async () => {
    const linker = createTestLinker()
    const errors: Error[] = []

    const bridge = new SiliconBridge(linker, {
      onError: (error) => errors.push(error)
    })

    // Queue patch for non-existent sourceId (will fail during flush)
    ;(bridge as unknown as { pendingPatches: Map<string, unknown> }).pendingPatches.set('99999:pitch', {
      sourceId: 99999,
      type: 'pitch',
      value: 72,
      timestamp: Date.now()
    })

    bridge.flushPatches()

    expect(errors.length).toBe(1)
    expect(errors[0].message).toContain('Unknown sourceId')
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('SiliconBridge - Factory Function', () => {
  test('createSiliconBridge creates bridge with defaults', () => {
    const bridge = createSiliconBridge()

    expect(bridge).toBeInstanceOf(SiliconBridge)
    expect(bridge.getLinker()).toBeInstanceOf(SiliconLinker)
  })

  test('createSiliconBridge accepts node capacity option', () => {
    const bridge = createSiliconBridge({ nodeCapacity: 1024 })

    // Verify linker was created with capacity
    const linker = bridge.getLinker()
    expect(linker).toBeDefined()
  })

  test('createSiliconBridge accepts debounce options', async () => {
    const bridge = createSiliconBridge({
      nodeCapacity: 256,
      safeZoneTicks: 0,
      attributeDebounceMs: 5
    })

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))
    bridge.patchDebounced(sourceId, 'pitch', 72)

    // Wait shorter than default but longer than custom
    await wait(10)

    expect(bridge.readNote(sourceId)!.pitch).toBe(72)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('SiliconBridge - Integration', () => {
  test('full edit cycle: load, patch, delete', async () => {
    const bridge = createSiliconBridge({
      nodeCapacity: 256,
      safeZoneTicks: 0,
      attributeDebounceMs: 5,
      structuralDebounceMs: 5
    })

    // Load clip
    const sourceIds = bridge.loadClip([
      createTestNote({ baseTick: 0, pitch: 60 }),
      createTestNote({ baseTick: 480, pitch: 64 }),
      createTestNote({ baseTick: 960, pitch: 67 })
    ])

    expect(bridge.getMappingCount()).toBe(3)

    // Debounced patch
    bridge.patchDebounced(sourceIds[1], 'pitch', 65)
    await wait(10)

    expect(bridge.readNote(sourceIds[1])!.pitch).toBe(65)

    // Delete
    bridge.deleteNoteImmediate(sourceIds[0])
    expect(bridge.getMappingCount()).toBe(2)

    // Verify remaining notes
    const notes = collectNotes(bridge)
    expect(notes.length).toBe(2)
    expect(notes[0].note.baseTick).toBe(480)
    expect(notes[1].note.baseTick).toBe(960)
  })

  test('concurrent debounced operations', async () => {
    const bridge = createSiliconBridge({
      nodeCapacity: 256,
      safeZoneTicks: 0,
      attributeDebounceMs: 5
    })

    const sourceId = bridge.insertNoteImmediate(createTestNote())

    // Rapid-fire patches
    for (let i = 0; i < 100; i++) {
      bridge.patchDebounced(sourceId, 'pitch', 60 + (i % 12))
      bridge.patchDebounced(sourceId, 'velocity', 50 + (i % 50))
    }

    // Should have coalesced
    expect(bridge.getPendingPatchCount()).toBe(2) // One for pitch, one for velocity

    await wait(10)

    // Final values
    const note = bridge.readNote(sourceId)!
    expect(note.pitch).toBe(60 + (99 % 12)) // 60 + 3 = 63
    expect(note.velocity).toBe(50 + (99 % 50)) // 50 + 49 = 99
  })

  test('source location preservation through edit cycle', () => {
    const bridge = createSiliconBridge({
      nodeCapacity: 256,
      safeZoneTicks: 0
    })

    const source: SourceLocation = { file: 'test.ss', line: 10, column: 5 }
    const note = createTestNote({ source })

    const sourceId = bridge.insertNoteImmediate(note)

    // Patch the note
    bridge.patchImmediate(sourceId, 'pitch', 72)

    // Read back and verify source is preserved
    const readNote = bridge.readNote(sourceId)
    expect(readNote?.source).toEqual(source)
  })
})
