// =============================================================================
// SymphonyScript - Silicon Linker (RFC-043)
// =============================================================================
// Main Silicon Linker implementation - Memory Management Unit for the SAB.

import {
  HDR,
  REG,
  NODE,
  COMMIT,
  ERROR,
  NULL_PTR,
  PACKED,
  SEQ,
  FLAG,
  NODE_SIZE_I32,
  HEAP_START_OFFSET
} from './constants'
import { FreeList } from './free-list'
import { AttributePatcher } from './patch'
import { createLinkerSAB } from './init'
import type {
  NodePtr,
  NodeData,
  NodeView,
  LinkerConfig,
  ISiliconLinker
} from './types'
import {
  HeapExhaustedError,
  SafeZoneViolationError,
  InvalidPointerError
} from './types'

/**
 * Silicon Linker - Memory Management Unit for Direct-to-Silicon Mirroring.
 *
 * This class acts as the sole authority for memory allocation and pointer
 * manipulation within the SharedArrayBuffer. It implements:
 *
 * - Lock-free free list for node allocation/deallocation
 * - Immediate attribute patching (<0.001ms)
 * - Structural splicing with safe zone enforcement
 * - COMMIT_FLAG protocol for consumer synchronization
 *
 * Thread safety model:
 * - Silicon Linker runs in a dedicated Web Worker
 * - AudioWorklet consumer reads from SAB
 * - All shared state accessed via Atomics
 */
export class SiliconLinker implements ISiliconLinker {
  private sab: Int32Array
  private buffer: SharedArrayBuffer
  private freeList: FreeList
  private patcher: AttributePatcher
  private heapStartI32: number
  private nodeCapacity: number

  /**
   * Create a new Silicon Linker.
   *
   * @param buffer - Initialized SharedArrayBuffer (use createLinkerSAB)
   */
  constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer
    this.sab = new Int32Array(buffer)
    this.heapStartI32 = HEAP_START_OFFSET / 4
    this.nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    this.freeList = new FreeList(this.sab)
    this.patcher = new AttributePatcher(this.sab, this.nodeCapacity)
  }

  /**
   * Create a Silicon Linker with a new SAB.
   *
   * @param config - Optional configuration
   * @returns New SiliconLinker instance
   */
  static create(config?: LinkerConfig): SiliconLinker {
    const buffer = createLinkerSAB(config)
    return new SiliconLinker(buffer)
  }

  // ===========================================================================
  // Memory Management
  // ===========================================================================

  /**
   * Allocate a node from the free list.
   *
   * @returns Node pointer, or NULL_PTR if heap exhausted
   */
  allocNode(): NodePtr {
    const ptr = this.freeList.alloc()
    if (ptr === NULL_PTR) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.HEAP_EXHAUSTED)
    }
    return ptr
  }

  /**
   * Return a node to the free list.
   *
   * @param ptr - Node to free
   */
  freeNode(ptr: NodePtr): void {
    this.freeList.free(ptr)
  }

  // ===========================================================================
  // Attribute Patching (Immediate)
  // ===========================================================================

  patchPitch(ptr: NodePtr, pitch: number): void {
    this.patcher.patchPitch(ptr, pitch)
  }

  patchVelocity(ptr: NodePtr, velocity: number): void {
    this.patcher.patchVelocity(ptr, velocity)
  }

  patchDuration(ptr: NodePtr, duration: number): void {
    this.patcher.patchDuration(ptr, duration)
  }

  patchBaseTick(ptr: NodePtr, baseTick: number): void {
    this.patcher.patchBaseTick(ptr, baseTick)
  }

  patchMuted(ptr: NodePtr, muted: boolean): void {
    this.patcher.patchMuted(ptr, muted)
  }

  // ===========================================================================
  // Structural Operations
  // ===========================================================================

  /**
   * Convert byte pointer to i32 index.
   */
  private nodeOffset(ptr: NodePtr): number {
    return ptr / 4
  }

  /**
   * Check if a pointer is within safe zone of playhead.
   */
  private checkSafeZone(targetTick: number): void {
    const playhead = Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
    const safeZone = this.sab[HDR.SAFE_ZONE_TICKS]

    if (targetTick - playhead < safeZone && targetTick >= playhead) {
      throw new SafeZoneViolationError(targetTick, playhead, safeZone)
    }
  }

  /**
   * Write node data to a node offset.
   */
  private writeNodeData(offset: number, data: NodeData): void {
    // Pack opcode, pitch, velocity, flags into PACKED_A
    const flags = (data.flags ?? 0) | FLAG.ACTIVE
    const packed =
      (data.opcode << PACKED.OPCODE_SHIFT) |
      ((data.pitch & 0xff) << PACKED.PITCH_SHIFT) |
      ((data.velocity & 0xff) << PACKED.VELOCITY_SHIFT) |
      (flags & PACKED.FLAGS_MASK)

    this.sab[offset + NODE.PACKED_A] = packed
    this.sab[offset + NODE.BASE_TICK] = data.baseTick | 0
    this.sab[offset + NODE.DURATION] = data.duration | 0
    // NEXT_PTR set separately during linking
    this.sab[offset + NODE.SOURCE_ID] = data.sourceId | 0
    // SEQ_FLAGS preserved from allocation (SEQ already set)
  }

  /**
   * Insert a new node after the given node.
   *
   * The Atomic Order of Operations (RFC-043 §7.4.2):
   * 1. Check safe zone
   * 2. Allocate NoteX from Free List
   * 3. Write all attributes to NoteX
   * 4. Link Future: NoteX.NEXT_PTR = NoteB
   * 5. Atomic Splice: NoteA.NEXT_PTR = NoteX
   * 6. Signal COMMIT_FLAG
   *
   * @param afterPtr - Node to insert after
   * @param data - New node data
   * @returns Pointer to new node
   * @throws SafeZoneViolationError if too close to playhead
   * @throws HeapExhaustedError if no free nodes
   */
  insertNode(afterPtr: NodePtr, data: NodeData): NodePtr {
    // 1. Check safe zone
    const afterOffset = this.nodeOffset(afterPtr)
    const targetTick = this.sab[afterOffset + NODE.BASE_TICK]
    this.checkSafeZone(targetTick)

    // 2. Allocate new node
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      throw new HeapExhaustedError()
    }
    const newOffset = this.nodeOffset(newPtr)

    // 3. Write all attributes
    this.writeNodeData(newOffset, data)

    // 4. Link Future: NoteX.NEXT_PTR = NoteB
    const noteBPtr = Atomics.load(this.sab, afterOffset + NODE.NEXT_PTR)
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, noteBPtr)

    // 5. Atomic Splice: NoteA.NEXT_PTR = NoteX
    Atomics.store(this.sab, afterOffset + NODE.NEXT_PTR, newPtr)

    // 6. Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    return newPtr
  }

  /**
   * Insert a new node at the head of the chain.
   *
   * @param data - New node data
   * @returns Pointer to new node
   */
  insertHead(data: NodeData): NodePtr {
    // Check safe zone against new node's tick
    this.checkSafeZone(data.baseTick)

    // Allocate new node
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      throw new HeapExhaustedError()
    }
    const newOffset = this.nodeOffset(newPtr)

    // Write attributes
    this.writeNodeData(newOffset, data)

    // Link to current head
    const currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, currentHead)

    // Atomic: become new head
    Atomics.store(this.sab, HDR.HEAD_PTR, newPtr)

    // Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    return newPtr
  }

  /**
   * Delete a node from the chain.
   *
   * Note: This requires knowing the previous node to update its NEXT_PTR.
   * For efficiency, consider using a doubly-linked list in future versions.
   *
   * @param ptr - Node to delete
   * @throws SafeZoneViolationError if too close to playhead
   */
  deleteNode(ptr: NodePtr): void {
    if (ptr === NULL_PTR) return

    const offset = this.nodeOffset(ptr)
    const targetTick = this.sab[offset + NODE.BASE_TICK]
    this.checkSafeZone(targetTick)

    // Find the previous node
    const head = Atomics.load(this.sab, HDR.HEAD_PTR)

    if (head === ptr) {
      // Deleting head - update HEAD_PTR
      const next = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
      Atomics.store(this.sab, HDR.HEAD_PTR, next)
    } else {
      // Find previous node
      let prevPtr = head
      while (prevPtr !== NULL_PTR) {
        const prevOffset = this.nodeOffset(prevPtr)
        const prevNext = Atomics.load(this.sab, prevOffset + NODE.NEXT_PTR)

        if (prevNext === ptr) {
          // Found it - update previous node's NEXT_PTR
          const targetNext = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
          Atomics.store(this.sab, prevOffset + NODE.NEXT_PTR, targetNext)
          break
        }

        prevPtr = prevNext
      }
    }

    // Free the node
    this.freeNode(ptr)

    // Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)
  }

  // ===========================================================================
  // Commit Protocol
  // ===========================================================================

  /**
   * Wait for consumer to acknowledge structural change.
   *
   * Spins on COMMIT_FLAG until consumer sets ACK, then clears to IDLE.
   * Timeout after ~3ms (one audio quantum) to prevent deadlock.
   */
  async awaitAck(): Promise<void> {
    const maxSpins = 1000

    for (let i = 0; i < maxSpins; i++) {
      const flag = Atomics.load(this.sab, HDR.COMMIT_FLAG)

      if (flag === COMMIT.ACK) {
        Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.IDLE)
        return
      }

      if (flag === COMMIT.IDLE) {
        // Already idle (no pending change)
        return
      }

      // Yield occasionally to prevent blocking
      if (i % 100 === 0) {
        await Promise.resolve()
      }
    }

    // Timeout - clear flag anyway to prevent stuck state
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.IDLE)
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Read node data at pointer.
   */
  readNode(ptr: NodePtr): NodeView {
    if (ptr === NULL_PTR) {
      throw new InvalidPointerError(ptr)
    }

    const attrs = this.patcher.readAttributes(ptr)

    return {
      ptr,
      opcode: attrs.opcode as NodeView['opcode'],
      pitch: attrs.pitch,
      velocity: attrs.velocity,
      duration: attrs.duration,
      baseTick: attrs.baseTick,
      nextPtr: attrs.nextPtr,
      sourceId: attrs.sourceId,
      flags: attrs.flags,
      seq: attrs.seq
    }
  }

  /**
   * Get head of chain.
   */
  getHead(): NodePtr {
    return Atomics.load(this.sab, HDR.HEAD_PTR)
  }

  /**
   * Iterate all nodes in chain order.
   */
  *iterateChain(): Generator<NodeView, void, unknown> {
    let ptr = this.getHead()

    while (ptr !== NULL_PTR) {
      const node = this.readNode(ptr)
      yield node
      ptr = node.nextPtr
    }
  }

  // ===========================================================================
  // Register Operations
  // ===========================================================================

  /**
   * Set active groove template.
   */
  setGroove(ptr: NodePtr, length: number): void {
    Atomics.store(this.sab, REG.GROOVE_PTR, ptr)
    Atomics.store(this.sab, REG.GROOVE_LEN, length)
  }

  /**
   * Disable groove.
   */
  clearGroove(): void {
    Atomics.store(this.sab, REG.GROOVE_PTR, NULL_PTR)
    Atomics.store(this.sab, REG.GROOVE_LEN, 0)
  }

  /**
   * Set humanization parameters.
   */
  setHumanize(timingPpt: number, velocityPpt: number): void {
    Atomics.store(this.sab, REG.HUMAN_TIMING_PPT, timingPpt | 0)
    Atomics.store(this.sab, REG.HUMAN_VEL_PPT, velocityPpt | 0)
  }

  /**
   * Set global transposition.
   */
  setTranspose(semitones: number): void {
    Atomics.store(this.sab, REG.TRANSPOSE, semitones | 0)
  }

  /**
   * Set global velocity multiplier.
   */
  setVelocityMult(ppt: number): void {
    Atomics.store(this.sab, REG.VELOCITY_MULT, ppt | 0)
  }

  /**
   * Set PRNG seed for humanization.
   */
  setPrngSeed(seed: number): void {
    Atomics.store(this.sab, REG.PRNG_SEED, seed | 0)
  }

  /**
   * Set BPM (can be updated live).
   */
  setBpm(bpm: number): void {
    Atomics.store(this.sab, HDR.BPM, bpm | 0)
  }

  /**
   * Get current BPM.
   */
  getBpm(): number {
    return Atomics.load(this.sab, HDR.BPM)
  }

  /**
   * Get PPQ.
   */
  getPpq(): number {
    return this.sab[HDR.PPQ]
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get current error flag.
   */
  getError(): number {
    return Atomics.load(this.sab, HDR.ERROR_FLAG)
  }

  /**
   * Clear error flag.
   */
  clearError(): void {
    Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.OK)
  }

  /**
   * Get allocated node count.
   */
  getNodeCount(): number {
    return Atomics.load(this.sab, HDR.NODE_COUNT)
  }

  /**
   * Get free node count.
   */
  getFreeCount(): number {
    return Atomics.load(this.sab, HDR.FREE_COUNT)
  }

  /**
   * Get total node capacity.
   */
  getNodeCapacity(): number {
    return this.nodeCapacity
  }

  /**
   * Get underlying SharedArrayBuffer.
   */
  getSAB(): SharedArrayBuffer {
    return this.buffer
  }

  /**
   * Get current playhead tick (set by AudioWorklet).
   */
  getPlayheadTick(): number {
    return Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
  }

  /**
   * Get safe zone size in ticks.
   */
  getSafeZoneTicks(): number {
    return this.sab[HDR.SAFE_ZONE_TICKS]
  }
}
