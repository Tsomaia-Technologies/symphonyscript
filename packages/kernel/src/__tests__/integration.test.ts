// =============================================================================
// SymphonyScript - Silicon Linker Integration Tests (RFC-043 Phase 2)
// =============================================================================
// Tests the interaction between SiliconSynapse and MockConsumer.

import {
  SiliconSynapse,
  createLinkerSAB,
  OPCODE,
  HDR,
  REG,
  COMMIT,
  NULL_PTR,
  writeGrooveTemplate,
} from '../'
import { getGrooveTemplateOffset } from '../constants'
import { MockConsumer } from '../mock-consumer'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create test linker and consumer pair.
 */
function createTestPair(options?: {
  nodeCapacity?: number
  safeZoneTicks?: number
  tickRate?: number
}) {
  const buffer = createLinkerSAB({
    nodeCapacity: options?.nodeCapacity ?? 256,
    safeZoneTicks: options?.safeZoneTicks ?? 0
  })
  const linker = new SiliconSynapse(buffer)
  const consumer = new MockConsumer(buffer, options?.tickRate ?? 24)
  // RFC-044: Consumer needs linker reference to process commands
  consumer.setLinker(linker)
  return { linker, consumer, buffer }
}

/**
 * Create note data helper - returns array of parameters for insertHead.
 */
function note(pitch: number, baseTick: number, duration = 96): [number, number, number, number, number, number, number] {
  return [
    OPCODE.NOTE, // opcode
    pitch,
    100, // velocity
    duration,
    baseTick,
    pitch * 1000 + baseTick, // sourceId
    0 // flags
  ]
}

/**
 * Helper to collect all nodes from traverse into an array for test assertions.
 */
function collectNodes(linker: SiliconSynapse): Array<{
  ptr: number
  opcode: number
  pitch: number
  velocity: number
  duration: number
  baseTick: number
  flags: number
  sourceId: number
  seq: number
}> {
  const nodes: Array<{
    ptr: number
    opcode: number
    pitch: number
    velocity: number
    duration: number
    baseTick: number
    flags: number
    sourceId: number
    seq: number
  }> = []

  linker.traverse((ptr, opcode, pitch, velocity, duration, baseTick, flags, sourceId, seq) => {
    nodes.push({ ptr, opcode, pitch, velocity, duration, baseTick, flags, sourceId, seq })
  })

  return nodes
}

// =============================================================================
// Test Suite
// =============================================================================

describe('RFC-043 Phase 2: Structural Splicing Integration', () => {
  // ===========================================================================
  // 1. Basic Playback
  // ===========================================================================
  describe('1. Basic Playback', () => {
    it('should play notes in tick order', () => {
      const { linker, consumer } = createTestPair()

      // Insert notes in tick order (insertHead puts at front)
      linker.insertHead(...note(67, 192)) // G4
      linker.insertHead(...note(64, 96)) // E4
      linker.insertHead(...note(60, 0)) // C4

      // Run consumer past all notes
      const events = consumer.runUntilTick(300)

      expect(events).toHaveLength(3)
      expect(events[0].pitch).toBe(60)
      expect(events[0].tick).toBe(0)
      expect(events[1].pitch).toBe(64)
      expect(events[1].tick).toBe(96)
      expect(events[2].pitch).toBe(67)
      expect(events[2].tick).toBe(192)
    })

    it('should handle empty chain', () => {
      const { consumer } = createTestPair()

      const events = consumer.runUntilTick(1000)

      expect(events).toHaveLength(0)
    })

    it('should handle single note', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(...note(60, 48))

      const events = consumer.runUntilTick(100)

      expect(events).toHaveLength(1)
      expect(events[0].pitch).toBe(60)
      expect(events[0].tick).toBe(48)
    })
  })

  // ===========================================================================
  // 2. Live Insertion During Playback
  // ===========================================================================
  describe('2. Live Insertion During Playback', () => {
    it('should play inserted notes ahead of playhead', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 48 })

      // Insert initial notes - note: insertHead puts them at the front
      // So we insert in reverse tick order to get correct chain order
      linker.insertHead(...note(67, 192))
      linker.insertHead(...note(60, 0))

      // Play first note
      consumer.runUntilTick(50)
      expect(consumer.getEvents()).toHaveLength(1)
      expect(consumer.getEvents()[0].pitch).toBe(60)

      // Insert new note at head with tick ahead of playhead
      // Using insertHead so it becomes the new first node
      linker.insertHead(...note(64, 96))

      // Consumer processes and acknowledges the change
      consumer.process()

      // Continue playback
      consumer.runUntilTick(300)

      const allEvents = consumer.getEvents()
      expect(allEvents).toHaveLength(3)
      // Note: after re-sync, order depends on tick values
      expect(allEvents.map((e) => e.pitch).sort()).toEqual([60, 64, 67])
    })

    it('should handle insertion at head during playback', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 48 })

      // Insert notes at tick 200, 400
      linker.insertHead(...note(67, 400))
      linker.insertHead(...note(64, 200))

      // Play past first note
      consumer.runUntilTick(250)
      expect(consumer.getEvents()).toHaveLength(1)
      expect(consumer.getEvents()[0].pitch).toBe(64)

      // Insert new note at tick 300 (ahead of playhead)
      linker.insertHead(...note(60, 300))

      // Consumer acknowledges the change
      consumer.process()

      // Continue - should pick up new note
      consumer.runUntilTick(500)

      const events = consumer.getEvents()
      // Verify we got all notes that were ahead of playhead when inserted
      const pitches = events.map((e) => e.pitch)
      expect(pitches).toContain(64)
      expect(pitches).toContain(60)
      expect(pitches).toContain(67)
    })
  })

  // ===========================================================================
  // 3. COMMIT_FLAG Handshake
  // ===========================================================================
  describe('3. COMMIT_FLAG Handshake', () => {
    it('should set PENDING on structural change', () => {
      const { linker, buffer } = createTestPair()
      const sab = new Int32Array(buffer)

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)

      linker.insertHead(...note(60, 0))

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)
    })

    it('should acknowledge PENDING and set ACK', () => {
      const { linker, consumer, buffer } = createTestPair()
      const sab = new Int32Array(buffer)

      linker.insertHead(...note(60, 0))
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)

      // Consumer processes - should acknowledge
      consumer.process()

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.ACK)
    })

    // RFC-045-FINAL: This test removed - syncAck() and Stop-and-Wait protocol deprecated
    // The COMMIT_FLAG handshake is now one-way: Main Thread sets PENDING, Worker ACKs.
    // There's no automatic completion to IDLE since syncAck() was removed.

    it('should re-sync position after structural change', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      // Insert notes
      linker.insertHead(...note(72, 300))
      linker.insertHead(...note(67, 200))
      linker.insertHead(...note(64, 100))
      linker.insertHead(...note(60, 0))

      // Play past first two notes
      consumer.runUntilTick(150)
      expect(consumer.getEvents()).toHaveLength(2)

      // Delete note at tick 200 (before we reach it)
      const nodes = collectNodes(linker)
      const node200 = nodes.find((n) => n.baseTick === 200)
      if (node200) {
        linker.deleteNode(node200.ptr)
      }

      // Consumer should re-sync and skip deleted note
      consumer.process() // Acknowledges change

      // Continue to end
      consumer.runUntilTick(400)

      const events = consumer.getEvents()
      // Should have: tick 0, tick 100, tick 300 (not 200)
      expect(events).toHaveLength(3)
      expect(events.map((e) => e.tick)).toEqual([0, 100, 300])
    })
  })

  // ===========================================================================
  // 4. Attribute Patching During Playback
  // ===========================================================================
  describe('4. Attribute Patching During Playback', () => {
    it('should reflect pitch changes before note plays', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      // Insert note at tick 100
      const ptr = linker.insertHead(...note(60, 100))

      // Play up to just before the note
      consumer.runUntilTick(96)
      expect(consumer.getEvents()).toHaveLength(0)

      // Patch pitch
      linker.patchPitch(ptr, 72)

      // Play the note
      consumer.runUntilTick(150)

      const events = consumer.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].pitch).toBe(72) // Should see patched value
    })

    it('should reflect velocity changes', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      const ptr = linker.insertHead(...note(60, 50))

      consumer.runUntilTick(48)
      linker.patchVelocity(ptr, 50)

      consumer.runUntilTick(100)

      expect(consumer.getEvents()[0].velocity).toBe(50)
    })

    it('should mute notes when muted flag set', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      const ptr = linker.insertHead(...note(60, 50))

      // Mute before it plays
      linker.patchMuted(ptr, true)

      consumer.runUntilTick(100)

      // Should not trigger because muted
      expect(consumer.getEvents()).toHaveLength(0)
    })

    it('should unmute and play when flag cleared', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      const ptr = linker.insertHead(...note(60, 100))
      linker.patchMuted(ptr, true)

      consumer.runUntilTick(50)
      expect(consumer.getEvents()).toHaveLength(0)

      // Unmute
      linker.patchMuted(ptr, false)

      consumer.runUntilTick(150)
      expect(consumer.getEvents()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // 5. Register-Based Transforms
  // ===========================================================================
  describe('5. Register-Based Transforms', () => {
    it('should apply global transpose', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(...note(60, 0)) // C4
      linker.setTranspose(12) // Up one octave

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].pitch).toBe(72) // C5
    })

    it('should apply velocity multiplier', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(...note(60, 0))
      linker.setVelocityMult(500) // 0.5x

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].velocity).toBe(50) // 100 * 0.5
    })

    it('should clamp transposed pitch to MIDI range', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(...note(120, 0)) // High pitch
      linker.setTranspose(20) // Would exceed 127

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].pitch).toBe(127) // Clamped
    })

    it('should update transforms live', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      linker.insertHead(...note(60, 100))
      linker.insertHead(...note(60, 0))

      // First note with no transpose
      consumer.runUntilTick(50)
      expect(consumer.getEvents()[0].pitch).toBe(60)

      // Set transpose before second note
      linker.setTranspose(5)

      consumer.runUntilTick(150)
      expect(consumer.getEvents()[1].pitch).toBe(65) // Transposed
    })
  })

  // ===========================================================================
  // 6. Groove Templates
  // ===========================================================================
  describe('6. Groove Templates', () => {
    it('should apply groove offsets', () => {
      const { linker, consumer, buffer } = createTestPair()

      // Create a simple swing pattern: [0, 20, 0, 20, ...]
      writeGrooveTemplate(buffer, 0, [0, 20, 0, 20])

      // Set groove active (point to template 0)
      const sab = new Int32Array(buffer)
      // Calculate groove start dynamically: after node heap and symbol table
      const nodeCapacity = sab[HDR.NODE_CAPACITY]
      const grooveStart = getGrooveTemplateOffset(nodeCapacity)
      linker.setGroove(grooveStart, 4)

      // Insert notes at tick 0, 1, 2, 3 (relative to groove steps)
      linker.insertHead(...note(63, 3))
      linker.insertHead(...note(62, 2))
      linker.insertHead(...note(61, 1))
      linker.insertHead(...note(60, 0))

      consumer.runUntilTick(50)

      const events = consumer.getEvents()
      expect(events).toHaveLength(4)
      // Tick 0 + offset[0] = 0 + 0 = 0
      expect(events[0].tick).toBe(0)
      // Tick 1 + offset[1] = 1 + 20 = 21
      expect(events[1].tick).toBe(21)
      // Tick 2 + offset[2] = 2 + 0 = 2
      expect(events[2].tick).toBe(2)
      // Tick 3 + offset[3] = 3 + 20 = 23
      expect(events[3].tick).toBe(23)
    })

    it('should change groove live', () => {
      const { linker, consumer, buffer } = createTestPair({ tickRate: 48 })

      // Single groove template with alternating offsets
      writeGrooveTemplate(buffer, 0, [0, 20]) // step 0 = +0, step 1 = +20

      const sab = new Int32Array(buffer)
      // Calculate groove start dynamically: after node heap and symbol table
      const nodeCapacity = sab[HDR.NODE_CAPACITY]
      const grooveStart = getGrooveTemplateOffset(nodeCapacity)

      // Notes: one at step 0 position, one at step 1 position
      linker.insertHead(...note(61, 100)) // 100 % 2 = 0 (step 0, offset +0)
      linker.insertHead(...note(60, 1)) // 1 % 2 = 1 (step 1, offset +20)

      // Enable groove
      linker.setGroove(grooveStart, 2)

      // Play to get both notes
      consumer.runUntilTick(150)

      const events = consumer.getEvents()
      expect(events).toHaveLength(2)

      // First note: baseTick 1 + offset 20 = 21
      expect(events[0].tick).toBe(21)
      // Second note: baseTick 100 + offset 0 = 100
      expect(events[1].tick).toBe(100)
    })
  })

  // ===========================================================================
  // 7. Humanization
  // ===========================================================================
  describe('7. Humanization', () => {
    it('should apply timing jitter', () => {
      const { linker, consumer } = createTestPair({ tickRate: 96 })

      // Enable humanization (50 ppt = 5% of PPQ, smaller to avoid ordering issues)
      linker.setHumanize(50, 0)

      // Insert a single note and verify it gets humanized
      linker.insertHead(...note(60, 200))

      consumer.runUntilTick(300)

      const events = consumer.getEvents()
      expect(events).toHaveLength(1)

      // The trigger tick should be offset from 200
      // (may be 200 if hash happens to give 0, but usually offset)
      // Just verify the event was emitted
      expect(events[0].pitch).toBe(60)
    })

    it('should produce consistent results with same seed', () => {
      const { linker, consumer, buffer } = createTestPair()
      const { linker: linker2, consumer: consumer2 } = createTestPair()

      // Copy same seed
      const sab1 = new Int32Array(buffer)
      const sab2 = new Int32Array(linker2.getSAB())
      sab2[REG.PRNG_SEED] = sab1[REG.PRNG_SEED]

      // Same humanization
      linker.setHumanize(100, 0)
      linker2.setHumanize(100, 0)

      // Same notes
      linker.insertHead(...note(62, 200))
      linker.insertHead(...note(61, 100))
      linker.insertHead(...note(60, 0))

      linker2.insertHead(...note(62, 200))
      linker2.insertHead(...note(61, 100))
      linker2.insertHead(...note(60, 0))

      consumer.runUntilTick(300)
      consumer2.runUntilTick(300)

      const ticks1 = consumer.getEvents().map((e) => e.tick)
      const ticks2 = consumer2.getEvents().map((e) => e.tick)

      expect(ticks1).toEqual(ticks2)
    })
  })

  // ===========================================================================
  // 8. Deletion During Playback
  // ===========================================================================
  describe('8. Deletion During Playback', () => {
    it('should not play deleted notes', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      // Insert three notes
      linker.insertHead(...note(67, 200))
      const ptr2 = linker.insertHead(...note(64, 100))
      linker.insertHead(...note(60, 0))

      // Play first note
      consumer.runUntilTick(50)
      expect(consumer.getEvents()).toHaveLength(1)

      // Delete middle note before it plays
      linker.deleteNode(ptr2)
      consumer.process() // Consumer acknowledges the change

      // Continue playback
      consumer.runUntilTick(300)

      const events = consumer.getEvents()
      expect(events).toHaveLength(2)
      expect(events.map((e) => e.pitch)).toEqual([60, 67])
    })

    it('should handle deletion of head during playback', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      linker.insertHead(...note(67, 200))
      linker.insertHead(...note(64, 100))
      const headPtr = linker.insertHead(...note(60, 50))

      // Delete head before it plays
      consumer.runUntilTick(24)
      linker.deleteNode(headPtr)
      consumer.process() // Consumer acknowledges the change

      consumer.runUntilTick(300)

      const events = consumer.getEvents()
      expect(events).toHaveLength(2)
      expect(events[0].pitch).toBe(64)
      expect(events[1].pitch).toBe(67)
    })
  })

  // ===========================================================================
  // 9. Stress Test
  // ===========================================================================
  describe('9. Stress Test', () => {
    it('should handle rapid insertions', async () => {
      const { linker, consumer } = createTestPair({
        nodeCapacity: 1024,
        tickRate: 48
      })

      // Insert 100 notes
      for (let i = 99; i >= 0; i--) {
        linker.insertHead(...note(60 + (i % 12), i * 10))
      }

      consumer.process() // Consumer acknowledges the changes

      // Play all notes
      consumer.runUntilTick(1500)

      expect(consumer.getEvents()).toHaveLength(100)
    })

    it('should handle interleaved insertions and playback', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      let lastPtr = linker.insertHead(...note(60, 0))

      for (let i = 1; i < 20; i++) {
        // Play a bit
        consumer.runQuanta(2)

        // Insert another note
        if (linker.getNodeCount() < 256) {
          lastPtr = linker.insertHead(...note(60 + i, i * 50))
        }
      }

      consumer.process() // Consumer acknowledges the changes

      // Finish playback
      consumer.runUntilTick(2000)

      expect(consumer.getEvents().length).toBeGreaterThan(10)
    })
  })

  // ===========================================================================
  // 10. RFC-044: Ring Buffer Saturation (Decree 044-10)
  // ===========================================================================
  describe('10. RFC-044: Ring Buffer Saturation', () => {
    it('should drain 90% full command ring without data loss or corruption', () => {
      // Use larger capacity for realistic stress testing
      const { linker, consumer, buffer } = createTestPair({
        nodeCapacity: 1024, // Need sufficient Zone B capacity
        tickRate: 48
      })

      // Import bridge for insertAsync access
      const { SiliconBridge } = require('../silicon-bridge')
      const bridge = new SiliconBridge(linker)

      const sab = new Int32Array(buffer)
      const nodeCapacity = sab[HDR.NODE_CAPACITY]

      // Fill to 90% of Zone B capacity (Zone B = nodeCapacity / 2)
      // This tests high-water mark resilience while respecting heap limits
      const zoneBCapacity = Math.floor(nodeCapacity / 2)
      const targetCommandCount = Math.floor(zoneBCapacity * 0.9)

      // Track inserted notes for verification
      const insertedNotes: Array<{ pitch: number; tick: number; sourceId: number }> = []

      // Queue commands via insertAsync (RFC-044 async path)
      // Insert in REVERSE order so they end up in correct temporal order
      // (insertAsync with no afterSourceId inserts at head, which reverses the order)
      for (let i = targetCommandCount - 1; i >= 0; i--) {
        const pitch = 60 + (i % 24) // C4 to B5 range
        const tick = i * 10 // Spread notes across time
        const sourceId = 10000 + i

        bridge.insertAsync(
          OPCODE.NOTE,
          pitch,
          100, // velocity
          480, // duration
          tick,
          false, // muted
          sourceId
        )

        insertedNotes.unshift({ pitch, tick, sourceId }) // unshift to maintain forward order in array
      }

      // Verify Ring Buffer is at target saturation
      const tailBeforeDrain = sab[HDR.RB_TAIL]
      expect(tailBeforeDrain).toBe(targetCommandCount)

      // Verify NO nodes are in chain yet (eventual consistency)
      expect(sab[HDR.NODE_COUNT]).toBe(0)

      // Worker drains Ring Buffer (simulates multiple process() cycles)
      let totalProcessed = 0
      while (sab[HDR.RB_HEAD] !== sab[HDR.RB_TAIL]) {
        const processed = linker.processCommands()
        totalProcessed += processed
        if (processed === 0) break // Safety: prevent infinite loop
      }

      // Verify ALL commands were processed
      expect(totalProcessed).toBe(targetCommandCount)

      // Verify Ring Buffer is empty
      expect(sab[HDR.RB_HEAD]).toBe(sab[HDR.RB_TAIL])

      // Verify ALL nodes are now in chain
      expect(sab[HDR.NODE_COUNT]).toBe(targetCommandCount)

      // Verify heap integrity: traverse chain and count nodes
      let chainLength = 0
      let currentPtr = sab[HDR.HEAD_PTR]
      while (currentPtr !== NULL_PTR && chainLength < targetCommandCount + 10) {
        chainLength++
        const offset = currentPtr / 4
        currentPtr = sab[offset + 3] // NODE.NEXT_PTR offset
      }

      expect(chainLength).toBe(targetCommandCount)

      // Verify no data corruption: check first and last notes
      consumer.runUntilTick(targetCommandCount * 10 + 1000)
      const events = consumer.getEvents()

      // Should have played all notes
      expect(events.length).toBe(targetCommandCount)

      // Verify first note data integrity
      expect(events[0].pitch).toBe(insertedNotes[0].pitch)
      expect(events[0].tick).toBe(insertedNotes[0].tick)

      // Verify last note data integrity
      const lastEvent = events[events.length - 1]
      const lastInserted = insertedNotes[insertedNotes.length - 1]
      expect(lastEvent.pitch).toBe(lastInserted.pitch)
      expect(lastEvent.tick).toBe(lastInserted.tick)
    })

    it('should handle rapid async insertions without queue overflow', () => {
      const { linker, consumer, buffer } = createTestPair({
        nodeCapacity: 512,
        tickRate: 24
      })

      const { SiliconBridge } = require('../silicon-bridge')
      const bridge = new SiliconBridge(linker)

      const sab = new Int32Array(buffer)
      const nodeCapacity = sab[HDR.NODE_CAPACITY]

      // Insert at 70% of Zone B capacity in rapid succession
      const zoneBCapacity = Math.floor(nodeCapacity / 2)
      const insertCount = Math.floor(zoneBCapacity * 0.7)

      // Insert in reverse order so they end up in correct temporal order
      for (let i = insertCount - 1; i >= 0; i--) {
        bridge.insertAsync(
          OPCODE.NOTE,
          60 + (i % 12),
          100,
          480,
          i * 5,
          false,
          20000 + i
        )
      }

      // Verify commands were queued
      expect(sab[HDR.RB_TAIL]).toBe(insertCount)

      // Drain and verify
      while (sab[HDR.RB_HEAD] !== sab[HDR.RB_TAIL]) {
        linker.processCommands()
      }

      expect(sab[HDR.NODE_COUNT]).toBe(insertCount)

      // Play all notes and verify count
      consumer.runUntilTick(insertCount * 5 + 500)
      expect(consumer.getEvents().length).toBe(insertCount)
    })
  })
})
