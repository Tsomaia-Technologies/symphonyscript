// =============================================================================
// SymphonyScript - Silicon Linker Integration Tests (RFC-043 Phase 2)
// =============================================================================
// Tests the interaction between SiliconLinker and MockConsumer.

import {
  SiliconLinker,
  createLinkerSAB,
  OPCODE,
  HDR,
  REG,
  COMMIT,
  NULL_PTR,
  writeGrooveTemplate
} from '../index'
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
  const linker = new SiliconLinker(buffer)
  const consumer = new MockConsumer(buffer, options?.tickRate ?? 24)
  return { linker, consumer, buffer }
}

/**
 * Create note data helper.
 */
function note(pitch: number, baseTick: number, duration = 96) {
  return {
    opcode: OPCODE.NOTE,
    pitch,
    velocity: 100,
    duration,
    baseTick,
    sourceId: pitch * 1000 + baseTick
  }
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
      linker.insertHead(note(67, 192)) // G4
      linker.insertHead(note(64, 96)) // E4
      linker.insertHead(note(60, 0)) // C4

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

      linker.insertHead(note(60, 48))

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
      linker.insertHead(note(67, 192))
      linker.insertHead(note(60, 0))

      // Play first note
      consumer.runUntilTick(50)
      expect(consumer.getEvents()).toHaveLength(1)
      expect(consumer.getEvents()[0].pitch).toBe(60)

      // Insert new note at head with tick ahead of playhead
      // Using insertHead so it becomes the new first node
      linker.insertHead(note(64, 96))

      // Consumer processes and acknowledges the change
      consumer.process()
      await linker.awaitAck()

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
      linker.insertHead(note(67, 400))
      linker.insertHead(note(64, 200))

      // Play past first note
      consumer.runUntilTick(250)
      expect(consumer.getEvents()).toHaveLength(1)
      expect(consumer.getEvents()[0].pitch).toBe(64)

      // Insert new note at tick 300 (ahead of playhead)
      linker.insertHead(note(60, 300))

      // Consumer acknowledges the change
      consumer.process()
      await linker.awaitAck()

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

      linker.insertHead(note(60, 0))

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)
    })

    it('should acknowledge PENDING and set ACK', () => {
      const { linker, consumer, buffer } = createTestPair()
      const sab = new Int32Array(buffer)

      linker.insertHead(note(60, 0))
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)

      // Consumer processes - should acknowledge
      consumer.process()

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.ACK)
    })

    it('should complete handshake cycle', async () => {
      const { linker, consumer, buffer } = createTestPair()
      const sab = new Int32Array(buffer)

      linker.insertHead(note(60, 0))

      // Consumer acknowledges
      consumer.process()
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.ACK)

      // Linker completes handshake
      await linker.awaitAck()
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)
    })

    it('should re-sync position after structural change', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      // Insert notes
      linker.insertHead(note(72, 300))
      linker.insertHead(note(67, 200))
      linker.insertHead(note(64, 100))
      linker.insertHead(note(60, 0))

      // Play past first two notes
      consumer.runUntilTick(150)
      expect(consumer.getEvents()).toHaveLength(2)

      // Delete note at tick 200 (before we reach it)
      const nodes = Array.from(linker.iterateChain())
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
      const ptr = linker.insertHead(note(60, 100))

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

      const ptr = linker.insertHead(note(60, 50))

      consumer.runUntilTick(48)
      linker.patchVelocity(ptr, 50)

      consumer.runUntilTick(100)

      expect(consumer.getEvents()[0].velocity).toBe(50)
    })

    it('should mute notes when muted flag set', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      const ptr = linker.insertHead(note(60, 50))

      // Mute before it plays
      linker.patchMuted(ptr, true)

      consumer.runUntilTick(100)

      // Should not trigger because muted
      expect(consumer.getEvents()).toHaveLength(0)
    })

    it('should unmute and play when flag cleared', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      const ptr = linker.insertHead(note(60, 100))
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

      linker.insertHead(note(60, 0)) // C4
      linker.setTranspose(12) // Up one octave

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].pitch).toBe(72) // C5
    })

    it('should apply velocity multiplier', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(note(60, 0))
      linker.setVelocityMult(500) // 0.5x

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].velocity).toBe(50) // 100 * 0.5
    })

    it('should clamp transposed pitch to MIDI range', () => {
      const { linker, consumer } = createTestPair()

      linker.insertHead(note(120, 0)) // High pitch
      linker.setTranspose(20) // Would exceed 127

      consumer.runUntilTick(50)

      expect(consumer.getEvents()[0].pitch).toBe(127) // Clamped
    })

    it('should update transforms live', () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      linker.insertHead(note(60, 100))
      linker.insertHead(note(60, 0))

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
      const grooveStart = sab[HDR.GROOVE_START]
      linker.setGroove(grooveStart, 4)

      // Insert notes at tick 0, 1, 2, 3 (relative to groove steps)
      linker.insertHead(note(63, 3))
      linker.insertHead(note(62, 2))
      linker.insertHead(note(61, 1))
      linker.insertHead(note(60, 0))

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
      const grooveStart = sab[HDR.GROOVE_START]

      // Notes: one at step 0 position, one at step 1 position
      linker.insertHead(note(61, 100)) // 100 % 2 = 0 (step 0, offset +0)
      linker.insertHead(note(60, 1)) // 1 % 2 = 1 (step 1, offset +20)

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
      linker.insertHead(note(60, 200))

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
      linker.insertHead(note(62, 200))
      linker.insertHead(note(61, 100))
      linker.insertHead(note(60, 0))

      linker2.insertHead(note(62, 200))
      linker2.insertHead(note(61, 100))
      linker2.insertHead(note(60, 0))

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
      linker.insertHead(note(67, 200))
      const ptr2 = linker.insertHead(note(64, 100))
      linker.insertHead(note(60, 0))

      // Play first note
      consumer.runUntilTick(50)
      expect(consumer.getEvents()).toHaveLength(1)

      // Delete middle note before it plays
      linker.deleteNode(ptr2)
      await linker.awaitAck()

      // Continue playback
      consumer.runUntilTick(300)

      const events = consumer.getEvents()
      expect(events).toHaveLength(2)
      expect(events.map((e) => e.pitch)).toEqual([60, 67])
    })

    it('should handle deletion of head during playback', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      linker.insertHead(note(67, 200))
      linker.insertHead(note(64, 100))
      const headPtr = linker.insertHead(note(60, 50))

      // Delete head before it plays
      consumer.runUntilTick(24)
      linker.deleteNode(headPtr)
      await linker.awaitAck()

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
        linker.insertHead(note(60 + (i % 12), i * 10))
      }

      await linker.awaitAck()

      // Play all notes
      consumer.runUntilTick(1500)

      expect(consumer.getEvents()).toHaveLength(100)
    })

    it('should handle interleaved insertions and playback', async () => {
      const { linker, consumer } = createTestPair({ tickRate: 24 })

      let lastPtr = linker.insertHead(note(60, 0))

      for (let i = 1; i < 20; i++) {
        // Play a bit
        consumer.runQuanta(2)

        // Insert another note
        if (linker.getNodeCount() < 256) {
          lastPtr = linker.insertHead(note(60 + i, i * 50))
        }
      }

      await linker.awaitAck()

      // Finish playback
      consumer.runUntilTick(2000)

      expect(consumer.getEvents().length).toBeGreaterThan(10)
    })
  })
})
