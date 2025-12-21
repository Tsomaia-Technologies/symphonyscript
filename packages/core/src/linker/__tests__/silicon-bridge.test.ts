// =============================================================================
// SymphonyScript - Silicon Bridge Tests (RFC-043 Phase 4)
// =============================================================================

import { SiliconBridge, createSiliconBridge } from '../silicon-bridge'
import type { EditorNoteData, PatchType, SourceLocation } from '../silicon-bridge'
import { SiliconSynapse } from '../silicon-synapse'
import { HDR, NULL_PTR, OPCODE, getZoneSplitIndex, HEAP_START_OFFSET, NODE_SIZE_BYTES, BRIDGE_ERR } from '../constants'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestLinker(): SiliconSynapse {
  return SiliconSynapse.create({
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

// Helper to read a note using the callback pattern and return EditorNoteData for test assertions
function readNoteData(bridge: SiliconBridge, sourceId: number): EditorNoteData | undefined {
  let result: EditorNoteData | undefined
  const success = bridge.readNote(sourceId, (pitch, velocity, duration, baseTick, muted) => {
    result = { pitch, velocity, duration, baseTick, muted }
  })
  return success ? result : undefined
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
    // Insert a note with source location to trigger registerMapping
    const sourceId = bridge.insertNoteImmediate({
      pitch: 60,
      velocity: 100,
      duration: 480,
      baseTick: 0,
      muted: false,
      source
    })

    // Use callback pattern (zero-alloc)
    let retrievedLine = -1
    let retrievedColumn = -1
    const found = bridge.getSourceLocation(sourceId, (line, column) => {
      retrievedLine = line
      retrievedColumn = column
    })

    expect(found).toBe(true)
    expect(retrievedLine).toBe(source.line)
    expect(retrievedColumn).toBe(source.column)
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

  test('traverseSourceIds visits all registered IDs', () => {
    const bridge = createTestBridge()

    const id1 = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    const id2 = bridge.insertNoteImmediate(createTestNote({ baseTick: 480 }))
    const id3 = bridge.insertNoteImmediate(createTestNote({ baseTick: 960 }))

    const ids: number[] = []
    bridge.traverseSourceIds((id) => ids.push(id))

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

    const readNote = readNoteData(bridge, sourceId)

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

  test('insertNoteImmediate with invalid afterSourceId returns error', () => {
    const bridge = createTestBridge()

    // RFC-045-05: insertNoteImmediate now returns BRIDGE_ERR.NOT_FOUND instead of throwing
    const result = bridge.insertNoteImmediate(createTestNote(), 99999)
    expect(result).toBe(BRIDGE_ERR.NOT_FOUND)
  })

  test('deleteNoteImmediate removes node from linker', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())
    bridge.deleteNoteImmediate(sourceId)

    expect(readNoteData(bridge, sourceId)).toBeUndefined()
  })

  test('deleteNoteImmediate with invalid sourceId returns error', () => {
    const bridge = createTestBridge()

    // RFC-045-05: deleteNoteImmediate now returns BRIDGE_ERR.NOT_FOUND instead of throwing
    const result = bridge.deleteNoteImmediate(99999)
    expect(result).toBe(BRIDGE_ERR.NOT_FOUND)
  })

  test('patchImmediate updates pitch', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ pitch: 60 }))
    bridge.patchImmediate(sourceId, 'pitch', 72)

    expect(readNoteData(bridge, sourceId)!.pitch).toBe(72)
  })

  test('patchImmediate updates velocity', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ velocity: 100 }))
    bridge.patchImmediate(sourceId, 'velocity', 64)

    expect(readNoteData(bridge, sourceId)!.velocity).toBe(64)
  })

  test('patchImmediate updates duration', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ duration: 480 }))
    bridge.patchImmediate(sourceId, 'duration', 240)

    expect(readNoteData(bridge, sourceId)!.duration).toBe(240)
  })

  test('patchImmediate updates baseTick', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ baseTick: 0 }))
    bridge.patchImmediate(sourceId, 'baseTick', 960)

    expect(readNoteData(bridge, sourceId)!.baseTick).toBe(960)
  })

  test('patchImmediate updates muted state', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote({ muted: false }))
    expect(readNoteData(bridge, sourceId)!.muted).toBe(false)

    bridge.patchImmediate(sourceId, 'muted', true)
    expect(readNoteData(bridge, sourceId)!.muted).toBe(true)

    bridge.patchImmediate(sourceId, 'muted', false)
    expect(readNoteData(bridge, sourceId)!.muted).toBe(false)
  })

  test('patchImmediate with invalid sourceId returns error', () => {
    const bridge = createTestBridge()

    // RFC-045-05: patchImmediate now returns BRIDGE_ERR.NOT_FOUND instead of throwing
    const result = bridge.patchImmediate(99999, 'pitch', 60)
    expect(result).toBe(BRIDGE_ERR.NOT_FOUND)
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
    expect(readNoteData(bridge, sourceId)!.pitch).toBe(64)
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

    expect(readNoteData(bridge, sourceId)!.pitch).toBe(72)
    expect(readNoteData(bridge, sourceId)!.velocity).toBe(80)
  })

  test('flushPatches applies all pending patches', () => {
    const bridge = createTestBridge()

    const sourceId = bridge.insertNoteImmediate(createTestNote())

    bridge.patchDebounced(sourceId, 'pitch', 72)
    bridge.patchDebounced(sourceId, 'velocity', 80)

    // Manually flush
    bridge.flushPatches()

    expect(bridge.getPendingPatchCount()).toBe(0)
    expect(readNoteData(bridge, sourceId)!.pitch).toBe(72)
    expect(readNoteData(bridge, sourceId)!.velocity).toBe(80)
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
    expect(readNoteData(bridge, sourceIds[0])!.pitch).toBe(60)
    expect(readNoteData(bridge, sourceIds[1])!.pitch).toBe(64)
    expect(readNoteData(bridge, sourceIds[2])!.pitch).toBe(67)
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
    let idCount = 0
    bridge.traverseSourceIds(() => idCount++)
    expect(idCount).toBe(0)
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
  test('readNote returns false for invalid sourceId', () => {
    const bridge = createTestBridge()

    expect(readNoteData(bridge, 99999)).toBeUndefined()
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

    const readNote = readNoteData(bridge, sourceId)

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
    expect(bridge.getLinker()).toBeInstanceOf(SiliconSynapse)
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

    expect(readNoteData(bridge, sourceId)!.pitch).toBe(72)
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

    expect(readNoteData(bridge, sourceIds[1])!.pitch).toBe(65)

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
    const note = readNoteData(bridge, sourceId)!
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

    // Read back and verify note data is correct
    const readNote = readNoteData(bridge, sourceId)
    expect(readNote?.pitch).toBe(72)

    // Source location is stored in Symbol Table (file string not preserved)
    // Use callback pattern (zero-alloc)
    let retrievedLine = -1
    let retrievedColumn = -1
    const found = bridge.getSourceLocation(sourceId, (line, column) => {
      retrievedLine = line
      retrievedColumn = column
    })
    expect(found).toBe(true)
    expect(retrievedLine).toBe(10)
    expect(retrievedColumn).toBe(5)
  })
})

// =============================================================================
// RFC-044: Zero-Blocking Command Ring Architecture
// =============================================================================
describe('RFC-044: Async Path & Resilience', () => {
  describe('insertAsync', () => {
    it('should return pointer from Zone B', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())
      const nodeCapacity = sab[HDR.NODE_CAPACITY]

      // Calculate Zone B start boundary
      const zoneSplitIndex = getZoneSplitIndex(nodeCapacity)
      const zoneBStartOffset = HEAP_START_OFFSET + zoneSplitIndex * NODE_SIZE_BYTES

      const ptr = bridge.insertAsync(
        OPCODE.NOTE,
        60, // pitch
        100, // velocity
        480, // duration
        0, // baseTick
        false, // muted
        1001 // sourceId
      )

      // Verify pointer is from Zone B
      expect(ptr).toBeGreaterThanOrEqual(zoneBStartOffset)
      expect(ptr).toBeLessThan(HEAP_START_OFFSET + nodeCapacity * NODE_SIZE_BYTES)
    })

    it('should advance RB_TAIL in Ring Buffer', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())

      const initialTail = sab[HDR.RB_TAIL]
      expect(initialTail).toBe(0)

      bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)

      const newTail = sab[HDR.RB_TAIL]
      expect(newTail).toBe(1)
    })

    it('should NOT link node until processCommands', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())

      // Call insertAsync
      const ptr = bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)
      expect(ptr).not.toBe(NULL_PTR)

      // Verify node is NOT in chain yet (eventual consistency)
      expect(sab[HDR.NODE_COUNT]).toBe(0)
      expect(sab[HDR.HEAD_PTR]).toBe(NULL_PTR)

      // Process commands (simulate Worker)
      linker.processCommands()

      // NOW verify node is in chain
      expect(sab[HDR.NODE_COUNT]).toBe(1)
      expect(sab[HDR.HEAD_PTR]).toBe(ptr)
    })

    it('should queue multiple async inserts correctly', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())

      // Queue 3 async inserts
      const ptr1 = bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)
      const ptr2 = bridge.insertAsync(OPCODE.NOTE, 64, 100, 480, 480, false, 1002)
      const ptr3 = bridge.insertAsync(OPCODE.NOTE, 67, 100, 480, 960, false, 1003)

      // All should be unique Zone B pointers
      expect(ptr1).not.toBe(ptr2)
      expect(ptr2).not.toBe(ptr3)
      expect(ptr1).not.toBe(ptr3)

      // Tail should advance by 3
      expect(sab[HDR.RB_TAIL]).toBe(3)

      // No nodes in chain yet
      expect(sab[HDR.NODE_COUNT]).toBe(0)

      // Process commands
      linker.processCommands()

      // All 3 nodes should now be in chain
      expect(sab[HDR.NODE_COUNT]).toBe(3)
    })
  })

  describe('hardReset', () => {
    it('should reset LocalAllocator utilization to 0.0', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse

      // Allocate several nodes via insertAsync
      bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)
      bridge.insertAsync(OPCODE.NOTE, 64, 100, 480, 480, false, 1002)
      bridge.insertAsync(OPCODE.NOTE, 67, 100, 480, 960, false, 1003)

      // Process to link them
      linker.processCommands()

      // Utilization should be > 0
      const statsBeforeReset = bridge.getZoneBStats()
      expect(statsBeforeReset.usage).toBeGreaterThan(0)

      // Hard reset
      bridge.hardReset()

      // Utilization should be 0.0
      const statsAfterReset = bridge.getZoneBStats()
      expect(statsAfterReset.usage).toBe(0)
      expect(statsAfterReset.freeNodes).toBeGreaterThan(0)
    })

    it('should clear all pending structural edits', () => {
      const bridge = createTestBridge()

      // Queue several async inserts (not yet processed)
      bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)
      bridge.insertAsync(OPCODE.NOTE, 64, 100, 480, 480, false, 1002)

      // Hard reset before processing
      bridge.hardReset()

      // Ring buffer should be empty
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())
      expect(sab[HDR.RB_HEAD]).toBe(0)
      expect(sab[HDR.RB_TAIL]).toBe(0)

      // No nodes should be in chain
      expect(sab[HDR.NODE_COUNT]).toBe(0)
      expect(sab[HDR.HEAD_PTR]).toBe(NULL_PTR)
    })

    it('should clear debounce timers', async () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse

      // Insert a note and queue a patch (which triggers debounce)
      const ptr = bridge.insertAsync(OPCODE.NOTE, 60, 100, 480, 0, false, 1001)
      linker.processCommands()

      // Queue a patch (triggers debounce timer)
      bridge.patchImmediate(1001, 'pitch', 72)

      // Hard reset should clear timers
      bridge.hardReset()

      // Wait for what would have been the debounce period
      await wait(20)

      // Node should not exist (was cleared by reset)
      const sab = new Int32Array(linker.getSAB())
      expect(sab[HDR.NODE_COUNT]).toBe(0)
    })

    it('should coordinate reset between Linker (Zone A) and LocalAllocator (Zone B)', () => {
      const bridge = createTestBridge()
      const linker = bridge['linker'] as SiliconSynapse
      const sab = new Int32Array(linker.getSAB())

      // Allocate in Zone A (via immediate path)
      bridge.insertImmediate(
        OPCODE.NOTE,
        60, // pitch
        100, // velocity
        480, // duration
        0, // baseTick
        false, // muted
        undefined, // source
        undefined, // afterSourceId
        2001 // explicitSourceId
      )

      // Allocate in Zone B (via async path)
      bridge.insertAsync(OPCODE.NOTE, 64, 100, 480, 480, false, 3001)
      linker.processCommands()

      // Both zones should have allocations
      expect(sab[HDR.NODE_COUNT]).toBe(2)
      const zoneBStats = bridge.getZoneBStats()
      expect(zoneBStats.usage).toBeGreaterThan(0)

      // Hard reset
      bridge.hardReset()

      // Zone A should be cleared
      expect(sab[HDR.NODE_COUNT]).toBe(0)
      expect(sab[HDR.HEAD_PTR]).toBe(NULL_PTR)

      // Zone B should be reset
      const zoneBStatsAfter = bridge.getZoneBStats()
      expect(zoneBStatsAfter.usage).toBe(0)
    })
  })
})
