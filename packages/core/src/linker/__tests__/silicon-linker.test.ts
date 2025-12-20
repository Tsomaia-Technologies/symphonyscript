// =============================================================================
// SymphonyScript - Silicon Linker Tests (RFC-043)
// =============================================================================

import {
  SiliconLinker,
  createLinkerSAB,
  validateLinkerSAB,
  getLinkerConfig,
  resetLinkerSAB,
  writeGrooveTemplate,
  readGrooveTemplate,
  SL_MAGIC,
  SL_VERSION,
  HDR,
  REG,
  NODE,
  OPCODE,
  FLAG,
  COMMIT,
  ERROR,
  NULL_PTR,
  DEFAULT_PPQ,
  HeapExhaustedError,
  SafeZoneViolationError
} from '../index'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a test linker with small capacity for faster tests.
 */
function createTestLinker(nodeCapacity = 64): SiliconLinker {
  return SiliconLinker.create({ nodeCapacity, safeZoneTicks: 0 })
}

/**
 * Create minimal note data for testing.
 */
function noteData(
  pitch: number,
  baseTick: number,
  duration = 96
): Parameters<SiliconLinker['insertHead']>[0] {
  return {
    opcode: OPCODE.NOTE,
    pitch,
    velocity: 100,
    duration,
    baseTick,
    sourceId: pitch * 1000 + baseTick
  }
}

/**
 * Helper to collect all nodes from traverse into an array for test assertions.
 */
function collectNodes(linker: SiliconLinker): Array<{
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

describe('RFC-043: Silicon Linker', () => {
  // ===========================================================================
  // 1. SAB Initialization
  // ===========================================================================
  describe('1. SAB Initialization', () => {
    it('should create SAB with correct magic number and version', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })
      const sab = new Int32Array(buffer)

      expect(sab[HDR.MAGIC]).toBe(SL_MAGIC)
      expect(sab[HDR.VERSION]).toBe(SL_VERSION)
    })

    it('should initialize with correct default values', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })
      const sab = new Int32Array(buffer)

      expect(sab[HDR.PPQ]).toBe(DEFAULT_PPQ)
      expect(sab[HDR.BPM]).toBe(120)
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)
      expect(sab[HDR.ERROR_FLAG]).toBe(ERROR.OK)
      expect(sab[HDR.NODE_CAPACITY]).toBe(32)
    })

    it('should initialize free list with all nodes', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })
      const sab = new Int32Array(buffer)

      expect(sab[HDR.FREE_COUNT]).toBe(32)
      expect(sab[HDR.NODE_COUNT]).toBe(0)
      expect(sab[HDR.HEAD_PTR]).toBe(NULL_PTR)
      // Verify 64-bit free list head is initialized (check low word)
      expect(sab[HDR.FREE_LIST_HEAD_LOW]).not.toBe(NULL_PTR)
    })

    it('should validate correct SAB format', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })
      expect(validateLinkerSAB(buffer)).toBe(true)
    })

    it('should reject invalid SAB (wrong magic)', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })
      const sab = new Int32Array(buffer)
      sab[HDR.MAGIC] = 0x12345678

      expect(validateLinkerSAB(buffer)).toBe(false)
    })

    it('should extract config from existing SAB', () => {
      const buffer = createLinkerSAB({
        nodeCapacity: 100,
        ppq: 960,
        bpm: 140,
        safeZoneTicks: 500
      })

      const config = getLinkerConfig(buffer)
      expect(config.nodeCapacity).toBe(100)
      expect(config.ppq).toBe(960)
      expect(config.bpm).toBe(140)
      expect(config.safeZoneTicks).toBe(500)
    })

    it('should reset SAB to initial state', () => {
      const linker = createTestLinker(32)

      // Insert some nodes
      linker.insertHead(noteData(60, 0))
      linker.insertHead(noteData(64, 96))
      expect(linker.getNodeCount()).toBe(2)

      // Reset
      resetLinkerSAB(linker.getSAB())

      // Verify reset state
      const sab = new Int32Array(linker.getSAB())
      expect(sab[HDR.NODE_COUNT]).toBe(0)
      expect(sab[HDR.FREE_COUNT]).toBe(32)
      expect(sab[HDR.HEAD_PTR]).toBe(NULL_PTR)
    })
  })

  // ===========================================================================
  // 2. Free List Operations
  // ===========================================================================
  describe('2. Free List Operations', () => {
    it('should allocate nodes from free list', () => {
      const linker = createTestLinker(8)

      expect(linker.getFreeCount()).toBe(8)
      expect(linker.getNodeCount()).toBe(0)

      const ptr = linker.allocNode()
      expect(ptr).not.toBe(NULL_PTR)
      expect(linker.getFreeCount()).toBe(7)
      expect(linker.getNodeCount()).toBe(1)
    })

    it('should return NULL_PTR when heap exhausted', () => {
      const linker = createTestLinker(2)

      // Allocate all nodes
      linker.allocNode()
      linker.allocNode()
      expect(linker.getFreeCount()).toBe(0)

      // Next allocation should fail
      const ptr = linker.allocNode()
      expect(ptr).toBe(NULL_PTR)
      expect(linker.getError()).toBe(ERROR.HEAP_EXHAUSTED)
    })

    it('should free nodes back to free list', () => {
      const linker = createTestLinker(8)

      const ptr = linker.allocNode()
      expect(linker.getFreeCount()).toBe(7)

      linker.freeNode(ptr)
      expect(linker.getFreeCount()).toBe(8)
      expect(linker.getNodeCount()).toBe(0)
    })

    it('should reuse freed nodes', () => {
      const linker = createTestLinker(2)

      // Allocate both nodes
      const ptr1 = linker.allocNode()
      const ptr2 = linker.allocNode()
      expect(linker.getFreeCount()).toBe(0)

      // Free one
      linker.freeNode(ptr1)
      expect(linker.getFreeCount()).toBe(1)

      // Allocate again - should get a valid pointer
      const ptr3 = linker.allocNode()
      expect(ptr3).not.toBe(NULL_PTR)
      expect(linker.getFreeCount()).toBe(0)
    })
  })

  // ===========================================================================
  // 3. Node Insertion
  // ===========================================================================
  describe('3. Node Insertion', () => {
    it('should insert node at head', () => {
      const linker = createTestLinker()

      const ptr = linker.insertHead(noteData(60, 0))
      expect(ptr).not.toBe(NULL_PTR)
      expect(linker.getHead()).toBe(ptr)
      expect(linker.getNodeCount()).toBe(1)
    })

    it('should insert multiple nodes maintaining chain', () => {
      const linker = createTestLinker()

      // Insert three notes (they'll be in reverse order at head)
      const ptr1 = linker.insertHead(noteData(60, 0))
      const ptr2 = linker.insertHead(noteData(64, 96))
      const ptr3 = linker.insertHead(noteData(67, 192))

      expect(linker.getHead()).toBe(ptr3)
      expect(linker.getNodeCount()).toBe(3)

      // Verify chain order
      const nodes = collectNodes(linker)
      expect(nodes).toHaveLength(3)
      expect(nodes[0].ptr).toBe(ptr3)
      expect(nodes[1].ptr).toBe(ptr2)
      expect(nodes[2].ptr).toBe(ptr1)
    })

    it('should insert node after existing node', () => {
      const linker = createTestLinker()

      // Insert first node
      const ptr1 = linker.insertHead(noteData(60, 0))

      // Insert second node after first
      const ptr2 = linker.insertNode(ptr1, noteData(64, 96))

      expect(linker.getNodeCount()).toBe(2)

      // Verify chain: ptr1 -> ptr2 -> NULL
      const node1 = linker.readNode(ptr1)
      expect(node1.nextPtr).toBe(ptr2)

      const node2 = linker.readNode(ptr2)
      expect(node2.nextPtr).toBe(NULL_PTR)
    })

    it('should set COMMIT_FLAG after structural change', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)

      linker.insertHead(noteData(60, 0))

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)
    })
  })

  // ===========================================================================
  // 4. Node Deletion
  // ===========================================================================
  describe('4. Node Deletion', () => {
    it('should delete head node', () => {
      const linker = createTestLinker()

      const ptr1 = linker.insertHead(noteData(60, 0))
      const ptr2 = linker.insertHead(noteData(64, 96))

      expect(linker.getHead()).toBe(ptr2)

      linker.deleteNode(ptr2)

      expect(linker.getHead()).toBe(ptr1)
      expect(linker.getNodeCount()).toBe(1)
    })

    it('should delete middle node', () => {
      const linker = createTestLinker()

      const ptr1 = linker.insertHead(noteData(60, 0))
      const ptr2 = linker.insertNode(ptr1, noteData(64, 96))
      const ptr3 = linker.insertNode(ptr2, noteData(67, 192))

      // Chain: ptr1 -> ptr2 -> ptr3
      linker.deleteNode(ptr2)

      // Chain should now be: ptr1 -> ptr3
      const node1 = linker.readNode(ptr1)
      expect(node1.nextPtr).toBe(ptr3)
      expect(linker.getNodeCount()).toBe(2)
    })

    it('should delete tail node', () => {
      const linker = createTestLinker()

      const ptr1 = linker.insertHead(noteData(60, 0))
      const ptr2 = linker.insertNode(ptr1, noteData(64, 96))

      linker.deleteNode(ptr2)

      const node1 = linker.readNode(ptr1)
      expect(node1.nextPtr).toBe(NULL_PTR)
      expect(linker.getNodeCount()).toBe(1)
    })
  })

  // ===========================================================================
  // 5. Attribute Patching
  // ===========================================================================
  describe('5. Attribute Patching', () => {
    it('should patch pitch immediately', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      linker.patchPitch(ptr, 72)

      const node = linker.readNode(ptr)
      expect(node.pitch).toBe(72)
    })

    it('should patch velocity immediately', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      linker.patchVelocity(ptr, 50)

      const node = linker.readNode(ptr)
      expect(node.velocity).toBe(50)
    })

    it('should patch duration immediately', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0, 96))

      linker.patchDuration(ptr, 192)

      const node = linker.readNode(ptr)
      expect(node.duration).toBe(192)
    })

    it('should patch baseTick immediately', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      linker.patchBaseTick(ptr, 480)

      const node = linker.readNode(ptr)
      expect(node.baseTick).toBe(480)
    })

    it('should patch muted flag', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      linker.patchMuted(ptr, true)
      let node = linker.readNode(ptr)
      expect(node.flags & FLAG.MUTED).toBe(FLAG.MUTED)

      linker.patchMuted(ptr, false)
      node = linker.readNode(ptr)
      expect(node.flags & FLAG.MUTED).toBe(0)
    })

    it('should clamp pitch to MIDI range', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      linker.patchPitch(ptr, 200) // Over max
      expect(linker.readNode(ptr).pitch).toBe(127)

      linker.patchPitch(ptr, -10) // Under min
      expect(linker.readNode(ptr).pitch).toBe(0)
    })

    it('should NOT set COMMIT_FLAG for attribute patches', () => {
      const linker = createTestLinker()
      const ptr = linker.insertHead(noteData(60, 0))

      // Clear the commit flag set by insertHead
      const sab = new Int32Array(linker.getSAB())
      sab[HDR.COMMIT_FLAG] = COMMIT.IDLE

      linker.patchPitch(ptr, 72)

      // Should still be IDLE (attribute patches don't need commit)
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)
    })
  })

  // ===========================================================================
  // 6. Safe Zone Enforcement
  // ===========================================================================
  describe('6. Safe Zone Enforcement', () => {
    it('should throw SafeZoneViolationError when inserting too close to playhead', () => {
      const buffer = createLinkerSAB({
        nodeCapacity: 64,
        safeZoneTicks: 960 // 2 beats
      })
      const linker = new SiliconLinker(buffer)

      const sab = new Int32Array(buffer)

      // First, insert a node far in the future (outside safe zone)
      // Playhead starts at 0, so tick 2000 is safe (2000 - 0 = 2000 >= 960)
      const ptr1 = linker.insertHead(noteData(60, 2000))

      // Now move playhead closer to that node
      // Set playhead at tick 1500, so target tick 2000 is within safe zone
      // 2000 - 1500 = 500 < 960 AND 2000 >= 1500, so should throw
      sab[HDR.PLAYHEAD_TICK] = 1500

      // Try to insert after ptr1 - target tick is ptr1's tick (2000)
      expect(() => {
        linker.insertNode(ptr1, noteData(67, 2500))
      }).toThrow(SafeZoneViolationError)
    })

    it('should allow insertion outside safe zone', () => {
      const buffer = createLinkerSAB({
        nodeCapacity: 64,
        safeZoneTicks: 960
      })
      const linker = new SiliconLinker(buffer)

      // Set playhead at tick 0
      const sab = new Int32Array(buffer)
      sab[HDR.PLAYHEAD_TICK] = 0

      // Insert node at tick 2000 (well outside safe zone of 960)
      const ptr1 = linker.insertHead(noteData(60, 2000))

      // Should succeed - target tick 2000 - playhead 0 = 2000 >= 960
      const ptr2 = linker.insertNode(ptr1, noteData(64, 2500))
      expect(ptr2).not.toBe(NULL_PTR)
    })

    it('should allow insertion when safe zone is 0', () => {
      const linker = createTestLinker(64) // safeZoneTicks = 0

      const sab = new Int32Array(linker.getSAB())
      sab[HDR.PLAYHEAD_TICK] = 50

      // Should succeed even when close to playhead
      const ptr1 = linker.insertHead(noteData(60, 100))
      const ptr2 = linker.insertNode(ptr1, noteData(64, 150))
      expect(ptr2).not.toBe(NULL_PTR)
    })
  })

  // ===========================================================================
  // 7. Register Operations
  // ===========================================================================
  describe('7. Register Operations', () => {
    it('should set and get BPM', () => {
      const linker = createTestLinker()

      linker.setBpm(140)
      expect(linker.getBpm()).toBe(140)
    })

    it('should set humanization parameters', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.setHumanize(50, 30)

      expect(sab[REG.HUMAN_TIMING_PPT]).toBe(50)
      expect(sab[REG.HUMAN_VEL_PPT]).toBe(30)
    })

    it('should set transpose', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.setTranspose(-5)

      expect(sab[REG.TRANSPOSE]).toBe(-5)
    })

    it('should set velocity multiplier', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.setVelocityMult(800) // 0.8x

      expect(sab[REG.VELOCITY_MULT]).toBe(800)
    })

    it('should set PRNG seed', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.setPrngSeed(42)

      expect(sab[REG.PRNG_SEED]).toBe(42)
    })
  })

  // ===========================================================================
  // 8. Groove Templates
  // ===========================================================================
  describe('8. Groove Templates', () => {
    it('should write and read groove template', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })

      // 16th note swing pattern: [0, 20, 0, 20, ...]
      const swingPattern = [0, 20, 0, 20, 0, 20, 0, 20]
      writeGrooveTemplate(buffer, 0, swingPattern)

      const readPattern = readGrooveTemplate(buffer, 0)
      expect(readPattern).toEqual(swingPattern)
    })

    it('should handle multiple groove templates', () => {
      const buffer = createLinkerSAB({ nodeCapacity: 32 })

      const pattern0 = [0, 10, 0, 10]
      const pattern1 = [5, 0, 5, 0, 5, 0]

      writeGrooveTemplate(buffer, 0, pattern0)
      writeGrooveTemplate(buffer, 1, pattern1)

      expect(readGrooveTemplate(buffer, 0)).toEqual(pattern0)
      expect(readGrooveTemplate(buffer, 1)).toEqual(pattern1)
    })

    it('should set active groove via linker', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())
      // Calculate groove start dynamically: after node heap
      const nodeCapacity = sab[HDR.NODE_CAPACITY]
      const grooveStart = 128 + nodeCapacity * 32 // HEAP_START_OFFSET + nodeCapacity * NODE_SIZE_BYTES

      linker.setGroove(grooveStart, 8)

      expect(sab[REG.GROOVE_PTR]).toBe(grooveStart)
      expect(sab[REG.GROOVE_LEN]).toBe(8)
    })

    it('should clear groove', () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.setGroove(100, 8)
      linker.clearGroove()

      expect(sab[REG.GROOVE_PTR]).toBe(NULL_PTR)
      expect(sab[REG.GROOVE_LEN]).toBe(0)
    })
  })

  // ===========================================================================
  // 9. Error Handling
  // ===========================================================================
  describe('9. Error Handling', () => {
    it('should set error flag on heap exhaustion', () => {
      const linker = createTestLinker(2)

      linker.allocNode()
      linker.allocNode()
      linker.allocNode() // Should fail

      expect(linker.getError()).toBe(ERROR.HEAP_EXHAUSTED)
    })

    it('should clear error flag', () => {
      const linker = createTestLinker(2)

      linker.allocNode()
      linker.allocNode()
      linker.allocNode()

      expect(linker.getError()).toBe(ERROR.HEAP_EXHAUSTED)

      linker.clearError()
      expect(linker.getError()).toBe(ERROR.OK)
    })

    it('should throw HeapExhaustedError on insertHead when full', () => {
      const linker = createTestLinker(2)

      linker.insertHead(noteData(60, 0))
      linker.insertHead(noteData(64, 96))

      expect(() => {
        linker.insertHead(noteData(67, 192))
      }).toThrow(HeapExhaustedError)
    })
  })

  // ===========================================================================
  // 10. Chain Iteration
  // ===========================================================================
  describe('10. Chain Iteration', () => {
    it('should iterate empty chain', () => {
      const linker = createTestLinker()

      const nodes = collectNodes(linker)
      expect(nodes).toHaveLength(0)
    })

    it('should iterate chain in order', () => {
      const linker = createTestLinker()

      // Insert in reverse tick order so chain is tick-ascending
      linker.insertHead(noteData(67, 192))
      linker.insertHead(noteData(64, 96))
      linker.insertHead(noteData(60, 0))

      const nodes = collectNodes(linker)
      expect(nodes).toHaveLength(3)
      expect(nodes[0].baseTick).toBe(0)
      expect(nodes[1].baseTick).toBe(96)
      expect(nodes[2].baseTick).toBe(192)
    })

    it('should read correct node attributes', () => {
      const linker = createTestLinker()

      linker.insertHead({
        opcode: OPCODE.NOTE,
        pitch: 60,
        velocity: 80,
        duration: 96,
        baseTick: 0,
        sourceId: 12345
      })

      const nodes = collectNodes(linker)
      expect(nodes[0].opcode).toBe(OPCODE.NOTE)
      expect(nodes[0].pitch).toBe(60)
      expect(nodes[0].velocity).toBe(80)
      expect(nodes[0].duration).toBe(96)
      expect(nodes[0].baseTick).toBe(0)
      expect(nodes[0].sourceId).toBe(12345)
      expect(nodes[0].flags & FLAG.ACTIVE).toBe(FLAG.ACTIVE)
    })
  })

  // ===========================================================================
  // 11. Commit Protocol
  // ===========================================================================
  describe('11. Commit Protocol', () => {
    it('should await ACK and clear to IDLE', async () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.insertHead(noteData(60, 0))
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.PENDING)

      // Simulate consumer acknowledging
      sab[HDR.COMMIT_FLAG] = COMMIT.ACK

      linker.syncAck()

      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)
    })

    it('should timeout and clear flag if no ACK', async () => {
      const linker = createTestLinker()
      const sab = new Int32Array(linker.getSAB())

      linker.insertHead(noteData(60, 0))

      // Don't simulate ACK - let it timeout
      linker.syncAck()

      // Should still clear to IDLE after timeout
      expect(sab[HDR.COMMIT_FLAG]).toBe(COMMIT.IDLE)
    })
  })
})
