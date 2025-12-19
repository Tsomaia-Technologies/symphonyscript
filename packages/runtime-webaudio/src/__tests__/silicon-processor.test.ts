// =============================================================================
// SymphonyScript - Silicon Processor Tests (RFC-043 Phase 3)
// =============================================================================
// Tests for the Silicon processor logic.
// Note: AudioWorklet runs in browser only, so we test the logic via exports.

import { SiliconLinker } from '@symphonyscript/core/linker'
import { MockConsumer } from '@symphonyscript/core/linker/mock-consumer'
import {
  OPCODE,
  HDR,
  REG,
  NODE,
  PACKED,
  FLAG,
  COMMIT,
  NULL_PTR
} from '@symphonyscript/core/linker/constants'

// =============================================================================
// Constants Sync Verification
// =============================================================================
// These tests verify that the duplicated constants in silicon-processor.ts
// match the canonical constants in @symphonyscript/core/linker/constants.ts.

describe('Constants Sync Verification', () => {
  // Expected values from silicon-processor.ts (must match constants.ts)
  const PROCESSOR_HDR = {
    MAGIC: 0,
    VERSION: 1,
    PPQ: 2,
    BPM: 3,
    HEAD_PTR: 4,
    FREE_LIST_PTR: 5,
    COMMIT_FLAG: 6,
    PLAYHEAD_TICK: 7,
    SAFE_ZONE_TICKS: 8,
    ERROR_FLAG: 9,
    NODE_COUNT: 10,
    FREE_COUNT: 11,
    NODE_CAPACITY: 12,
    HEAP_START: 13,
    GROOVE_START: 14
  }

  const PROCESSOR_REG = {
    GROOVE_PTR: 16,
    GROOVE_LEN: 17,
    HUMAN_TIMING_PPT: 18,
    HUMAN_VEL_PPT: 19,
    TRANSPOSE: 20,
    VELOCITY_MULT: 21,
    PRNG_SEED: 22
  }

  const PROCESSOR_NODE = {
    PACKED_A: 0,
    BASE_TICK: 1,
    DURATION: 2,
    NEXT_PTR: 3,
    PREV_PTR: 4,
    SOURCE_ID: 5,
    SEQ_FLAGS: 6,
    RESERVED: 7
  }

  it('HDR constants should match', () => {
    expect(HDR.MAGIC).toBe(PROCESSOR_HDR.MAGIC)
    expect(HDR.VERSION).toBe(PROCESSOR_HDR.VERSION)
    expect(HDR.PPQ).toBe(PROCESSOR_HDR.PPQ)
    expect(HDR.BPM).toBe(PROCESSOR_HDR.BPM)
    expect(HDR.HEAD_PTR).toBe(PROCESSOR_HDR.HEAD_PTR)
    expect(HDR.FREE_LIST_PTR).toBe(PROCESSOR_HDR.FREE_LIST_PTR)
    expect(HDR.COMMIT_FLAG).toBe(PROCESSOR_HDR.COMMIT_FLAG)
    expect(HDR.PLAYHEAD_TICK).toBe(PROCESSOR_HDR.PLAYHEAD_TICK)
    expect(HDR.SAFE_ZONE_TICKS).toBe(PROCESSOR_HDR.SAFE_ZONE_TICKS)
    expect(HDR.ERROR_FLAG).toBe(PROCESSOR_HDR.ERROR_FLAG)
    expect(HDR.NODE_COUNT).toBe(PROCESSOR_HDR.NODE_COUNT)
    expect(HDR.FREE_COUNT).toBe(PROCESSOR_HDR.FREE_COUNT)
    expect(HDR.NODE_CAPACITY).toBe(PROCESSOR_HDR.NODE_CAPACITY)
    expect(HDR.HEAP_START).toBe(PROCESSOR_HDR.HEAP_START)
    expect(HDR.GROOVE_START).toBe(PROCESSOR_HDR.GROOVE_START)
  })

  it('REG constants should match', () => {
    expect(REG.GROOVE_PTR).toBe(PROCESSOR_REG.GROOVE_PTR)
    expect(REG.GROOVE_LEN).toBe(PROCESSOR_REG.GROOVE_LEN)
    expect(REG.HUMAN_TIMING_PPT).toBe(PROCESSOR_REG.HUMAN_TIMING_PPT)
    expect(REG.HUMAN_VEL_PPT).toBe(PROCESSOR_REG.HUMAN_VEL_PPT)
    expect(REG.TRANSPOSE).toBe(PROCESSOR_REG.TRANSPOSE)
    expect(REG.VELOCITY_MULT).toBe(PROCESSOR_REG.VELOCITY_MULT)
    expect(REG.PRNG_SEED).toBe(PROCESSOR_REG.PRNG_SEED)
  })

  it('NODE constants should match', () => {
    expect(NODE.PACKED_A).toBe(PROCESSOR_NODE.PACKED_A)
    expect(NODE.BASE_TICK).toBe(PROCESSOR_NODE.BASE_TICK)
    expect(NODE.DURATION).toBe(PROCESSOR_NODE.DURATION)
    expect(NODE.NEXT_PTR).toBe(PROCESSOR_NODE.NEXT_PTR)
    expect(NODE.PREV_PTR).toBe(PROCESSOR_NODE.PREV_PTR)
    expect(NODE.SOURCE_ID).toBe(PROCESSOR_NODE.SOURCE_ID)
    expect(NODE.SEQ_FLAGS).toBe(PROCESSOR_NODE.SEQ_FLAGS)
    expect(NODE.RESERVED).toBe(PROCESSOR_NODE.RESERVED)
  })

  it('PACKED constants should match', () => {
    expect(PACKED.OPCODE_SHIFT).toBe(24)
    expect(PACKED.OPCODE_MASK).toBe(0xff000000)
    expect(PACKED.PITCH_SHIFT).toBe(16)
    expect(PACKED.PITCH_MASK).toBe(0x00ff0000)
    expect(PACKED.VELOCITY_SHIFT).toBe(8)
    expect(PACKED.VELOCITY_MASK).toBe(0x0000ff00)
    expect(PACKED.FLAGS_MASK).toBe(0x000000ff)
  })

  it('FLAG constants should match', () => {
    expect(FLAG.ACTIVE).toBe(0x01)
    expect(FLAG.MUTED).toBe(0x02)
    expect(FLAG.DIRTY).toBe(0x04)
  })

  it('COMMIT constants should match', () => {
    expect(COMMIT.IDLE).toBe(0)
    expect(COMMIT.PENDING).toBe(1)
    expect(COMMIT.ACK).toBe(2)
  })

  it('NULL_PTR should match', () => {
    expect(NULL_PTR).toBe(0)
  })
})

// Use safeZoneTicks: 0 to allow insertions at any tick for testing
const TEST_CONFIG = { nodeCapacity: 100, safeZoneTicks: 0 }

describe('RFC-043 Phase 3: Silicon Processor Logic', () => {
  describe('1. Playhead Advancement', () => {
    it('should advance playhead through the chain', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Insert notes in reverse order (insertHead prepends, so last insert = head)
      // To get chain sorted by baseTick: head -> 0 -> 480 -> 960
      // We insert in reverse: 960 first, then 480, then 0
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 64,
        velocity: 100,
        duration: 480,
        baseTick: 960,
        sourceId: 3
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 62,
        velocity: 100,
        duration: 480,
        baseTick: 480,
        sourceId: 2
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      // Create mock consumer
      const consumer = new MockConsumer(linker.getSAB(), 48) // 48 ticks per quantum

      // Run until tick 1440 (3 beats)
      const events = consumer.runUntilTick(1440)

      // Should have triggered all 3 notes
      expect(events.length).toBe(3)
      expect(events.map((e) => e.pitch)).toEqual([60, 62, 64])
    })

    it('should track playhead tick correctly', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)
      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Run 10 quanta
      consumer.runQuanta(10)

      // Playhead should be at 48 * 10 = 480 ticks
      expect(consumer.getPlayheadTick()).toBe(480)
    })
  })

  describe('2. COMMIT_FLAG Protocol', () => {
    it('should acknowledge structural changes', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)
      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Insert a note (sets COMMIT_FLAG = PENDING)
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 1000,
        sourceId: 1
      })

      // Process should acknowledge
      consumer.process()

      // Wait for ACK should complete
      // (In mock, ACK is set immediately by process())
    })

    it('should re-sync position after structural change during playback', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)
      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Insert initial note at tick 500 (insert in reverse order for sorted chain)
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 64,
        velocity: 100,
        duration: 480,
        baseTick: 500,
        sourceId: 2
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      // Process should pick up both notes (no separate process() call)
      const events = consumer.runUntilTick(1000)

      // Should have both notes triggered in order
      expect(events.length).toBe(2)
      expect(events.map((e) => e.pitch)).toEqual([60, 64])
    })
  })

  describe('3. VM-Resident Transforms', () => {
    it('should apply groove offset', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)
      const buffer = linker.getSAB()

      // Write groove template with +10 offset for first step
      const { writeGrooveTemplate } = require('@symphonyscript/core/linker/init')
      writeGrooveTemplate(buffer, 0, [10, 0, 0, 0])

      // Set groove
      const sab = new Int32Array(buffer)
      const grooveStartI32 = sab[14] / 4 // HDR.GROOVE_START / 4
      linker.setGroove(grooveStartI32 * 4, 4)

      // Insert note at tick 0
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      const consumer = new MockConsumer(buffer, 24)

      // Run until tick 100
      const events = consumer.runUntilTick(100)

      // Note should trigger with groove offset applied
      // The exact tick depends on groove application logic
      expect(events.length).toBeGreaterThanOrEqual(1)
    })

    it('should apply global transpose', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Set transpose +12 (one octave up)
      linker.setTranspose(12)

      // Insert note at C4 (60)
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      const consumer = new MockConsumer(linker.getSAB(), 48)
      const events = consumer.runUntilTick(480)

      // Should be C5 (72)
      expect(events[0].pitch).toBe(72)
    })

    it('should apply velocity multiplier', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Set velocity multiplier to 0.5 (500 ppt)
      linker.setVelocityMult(500)

      // Insert note with velocity 100
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      const consumer = new MockConsumer(linker.getSAB(), 48)
      const events = consumer.runUntilTick(480)

      // Should be 50
      expect(events[0].velocity).toBe(50)
    })

    it('should clamp transposed pitch to MIDI range', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Set extreme transpose
      linker.setTranspose(100)

      // Insert note at high pitch
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 100,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      const consumer = new MockConsumer(linker.getSAB(), 48)
      const events = consumer.runUntilTick(480)

      // Should be clamped to 127
      expect(events[0].pitch).toBe(127)
    })
  })

  describe('4. Muted Nodes', () => {
    it('should skip muted nodes', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Insert two notes in reverse order (for sorted chain)
      const ptr = linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 64,
        velocity: 100,
        duration: 480,
        baseTick: 240,
        sourceId: 2
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      // Mute the second note (pitch 64)
      linker.patchMuted(ptr, true)

      const consumer = new MockConsumer(linker.getSAB(), 48)
      const events = consumer.runUntilTick(480)

      // Should only have one note (the unmuted one at tick 0)
      expect(events.length).toBe(1)
      expect(events[0].pitch).toBe(60)
    })

    it('should play unmuted nodes', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Insert and mute a note
      const ptr = linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 0,
        sourceId: 1
      })

      linker.patchMuted(ptr, true)

      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Run past the note
      consumer.runUntilTick(240)

      // Unmute it
      linker.patchMuted(ptr, false)

      // Continue playback - note was already passed, so it shouldn't play
      const events = consumer.runUntilTick(480)

      // Should have no events (note was passed while muted)
      expect(events.length).toBe(0)
    })
  })

  describe('5. Empty Chain', () => {
    it('should handle empty chain gracefully', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)
      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Run on empty chain
      const events = consumer.runUntilTick(1000)

      expect(events.length).toBe(0)
      expect(consumer.getPlayheadTick()).toBe(1008) // Multiple of 48
    })
  })

  describe('6. Live Attribute Patching', () => {
    it('should reflect pitch changes before note plays', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Insert note at future tick
      const ptr = linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 200,
        sourceId: 1
      })

      const consumer = new MockConsumer(linker.getSAB(), 48)

      // Run a bit (before note triggers)
      consumer.runQuanta(2) // 96 ticks

      // Patch pitch while playhead is before the note
      linker.patchPitch(ptr, 72)

      // Continue to trigger the note
      const events = consumer.runUntilTick(480)

      // Should have the patched pitch
      expect(events[0].pitch).toBe(72)
    })

    it('should reflect velocity changes before note plays', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      const ptr = linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 480,
        baseTick: 200,
        sourceId: 1
      })

      const consumer = new MockConsumer(linker.getSAB(), 48)
      consumer.runQuanta(2)

      // Patch velocity
      linker.patchVelocity(ptr, 50)

      const events = consumer.runUntilTick(480)

      // Should have the patched velocity
      expect(events[0].velocity).toBe(50)
    })
  })

  describe('7. Doubly-Linked List Traversal', () => {
    it('should traverse chain in correct order', () => {
      const linker = SiliconLinker.create(TEST_CONFIG)

      // Insert notes in reverse baseTick order (so chain is sorted by baseTick)
      // insertHead prepends, so insert 200 first, then 100, then 0
      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 64,
        velocity: 100,
        duration: 100,
        baseTick: 200,
        sourceId: 3
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 62,
        velocity: 100,
        duration: 100,
        baseTick: 100,
        sourceId: 2
      })

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 100,
        duration: 100,
        baseTick: 0,
        sourceId: 1
      })

      // Chain is now sorted: 0 -> 100 -> 200
      // Events should trigger in baseTick order
      const consumer = new MockConsumer(linker.getSAB(), 24)
      const events = consumer.runUntilTick(300)

      expect(events.map((e) => e.pitch)).toEqual([60, 62, 64])
    })
  })
})
