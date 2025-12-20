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
  HEAP_START_OFFSET,
  CONCURRENCY
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
  InvalidPointerError,
  KernelPanicError
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
  // Chain Mutex (v1.5) - Concurrency Control
  // ===========================================================================

  /**
   * Zero-allocation CPU yield for worker context.
   *
   * Uses Atomics.wait() with 1ms timeout to sleep without allocating memory.
   * Fallback to setImmediate if Atomics.wait throws (e.g., main thread - rare).
   *
   * @remarks
   * This is a synchronous sleep that doesn't create Promise garbage.
   * The 1ms timeout allows other threads to acquire the mutex.
   */
  private _yieldToCPU(): void {
    try {
      // **ZERO-ALLOC**: Sleep for 1ms using Atomics.wait
      // This relinquishes the time slice without allocating memory
      Atomics.wait(this.sab, HDR.YIELD_SLOT, 0, 1)
    } catch (e) {
      // Atomics.wait may throw if called on main thread or unsupported
      // Fallback: setImmediate (only allocates if actually hit)
      if (typeof setImmediate !== 'undefined') {
        // Note: This creates a microtask but should be rare in production
        setImmediate(() => {})
      }
      // If no setImmediate, just continue spinning
    }
  }

  /**
   * Acquire the Chain Mutex for structural operations.
   *
   * This implements a spin-lock with:
   * - CAS-based locking (0 → 1 transition)
   * - Zero-alloc CPU yield after 100 spins to prevent starvation
   * - Dead-Man's Switch: Throws KernelPanicError after 1M iterations
   *
   * The Dead-Man's Switch prevents permanent system freeze if a worker
   * crashes while holding the lock.
   *
   * @throws KernelPanicError if lock cannot be acquired after 1M iterations
   */
  private _acquireChainMutex(): void {
    let spinCount = 0
    let totalIterations = 0

    // Spin until we successfully CAS 0 → 1
    while (
      Atomics.compareExchange(
        this.sab,
        HDR.CHAIN_MUTEX,
        CONCURRENCY.MUTEX_UNLOCKED, // expected: unlocked
        CONCURRENCY.MUTEX_LOCKED // desired: locked
      ) !== CONCURRENCY.MUTEX_UNLOCKED
    ) {
      // **v1.5 DEAD-MAN'S SWITCH**: Prevent permanent deadlock
      totalIterations++
      if (totalIterations > CONCURRENCY.MUTEX_PANIC_THRESHOLD) {
        // Set ERROR_FLAG to indicate kernel panic
        Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.KERNEL_PANIC)
        throw new KernelPanicError(
          `Chain Mutex deadlock detected: Failed to acquire lock after ${CONCURRENCY.MUTEX_PANIC_THRESHOLD} iterations. ` +
            `A worker may have crashed while holding the lock. System requires warm restart.`
        )
      }

      // **v1.5 ZERO-ALLOC YIELD**: Prevent CPU starvation without garbage
      spinCount++
      if (spinCount > CONCURRENCY.YIELD_AFTER_SPINS) {
        this._yieldToCPU()
        spinCount = 0 // Reset yield counter (NOT totalIterations!)
      }
    }
  }

  /**
   * Release the Chain Mutex.
   *
   * This must ALWAYS be called after acquiring the mutex, even if an error occurs.
   * Use try-finally pattern to ensure release.
   */
  private _releaseChainMutex(): void {
    // Release lock: 1 → 0
    Atomics.store(this.sab, HDR.CHAIN_MUTEX, CONCURRENCY.MUTEX_UNLOCKED)
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
   * 4. Link Future: NoteX.NEXT_PTR = NoteB, NoteX.PREV_PTR = NoteA
   * 5. Update NoteB.PREV_PTR = NoteX (if NoteB exists)
   * 6. Atomic Splice: NoteA.NEXT_PTR = NoteX
   * 7. Signal COMMIT_FLAG
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

    // 4. Link Future: NoteX.NEXT_PTR = NoteB, NoteX.PREV_PTR = NoteA
    const noteBPtr = Atomics.load(this.sab, afterOffset + NODE.NEXT_PTR)
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, noteBPtr)
    Atomics.store(this.sab, newOffset + NODE.PREV_PTR, afterPtr)

    // 5. Update NoteB.PREV_PTR = NoteX (if NoteB exists)
    if (noteBPtr !== NULL_PTR) {
      const noteBOffset = this.nodeOffset(noteBPtr)
      Atomics.store(this.sab, noteBOffset + NODE.PREV_PTR, newPtr)
    }

    // 6. Atomic Splice: NoteA.NEXT_PTR = NoteX
    Atomics.store(this.sab, afterOffset + NODE.NEXT_PTR, newPtr)

    // 7. Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    return newPtr
  }

  /**
   * Insert a new node at the head of the chain.
   *
   * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
   * Implements CAS loop for HEAD_PTR updates as specified in the decree.
   *
   * @param data - New node data
   * @returns Pointer to new node
   * @throws HeapExhaustedError if no free nodes
   * @throws SafeZoneViolationError if too close to playhead
   * @throws KernelPanicError if mutex deadlock detected
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

    // **v1.5 CHAIN MUTEX**: Protect structural mutation
    this._acquireChainMutex()
    try {
      // **v1.5 CAS LOOP**: Atomic HEAD_PTR update
      let currentHead: NodePtr
      do {
        currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)

        // Link to current head
        Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, currentHead)
        Atomics.store(this.sab, newOffset + NODE.PREV_PTR, NULL_PTR) // New head has no prev

        // Update old head's PREV_PTR to point to new head
        if (currentHead !== NULL_PTR) {
          const currentHeadOffset = this.nodeOffset(currentHead)
          Atomics.store(this.sab, currentHeadOffset + NODE.PREV_PTR, newPtr)
        }

        // CAS: Try to become new head
        // If HEAD_PTR changed since we read it, retry
      } while (
        Atomics.compareExchange(this.sab, HDR.HEAD_PTR, currentHead, newPtr) !== currentHead
      )

      // Increment NODE_COUNT
      Atomics.add(this.sab, HDR.NODE_COUNT, 1)

      // Signal structural change
      Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

      return newPtr
    } finally {
      // **CRITICAL**: Always release mutex, even if error occurs
      this._releaseChainMutex()
    }
  }

  /**
   * Delete a node from the chain.
   *
   * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
   * Implements CAS loop for HEAD_PTR updates when deleting the head node.
   *
   * O(1) deletion using PREV_PTR (doubly-linked list).
   *
   * @param ptr - Node to delete
   * @throws SafeZoneViolationError if too close to playhead
   * @throws KernelPanicError if mutex deadlock detected
   */
  deleteNode(ptr: NodePtr): void {
    if (ptr === NULL_PTR) return

    const offset = this.nodeOffset(ptr)
    const targetTick = this.sab[offset + NODE.BASE_TICK]
    this.checkSafeZone(targetTick)

    // **v1.5 CHAIN MUTEX**: Protect structural mutation
    this._acquireChainMutex()
    try {
      // Read prev and next pointers
      const prevPtr = Atomics.load(this.sab, offset + NODE.PREV_PTR)
      const nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)

      // Update prev's NEXT_PTR (or HEAD_PTR if deleting head)
      if (prevPtr === NULL_PTR) {
        // **v1.5 CAS LOOP**: Deleting head - atomic HEAD_PTR update
        let currentHead: NodePtr
        do {
          currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)
          // Verify we're still deleting the head (it might have changed)
          if (currentHead !== ptr) {
            // Head changed - this node is no longer at head, abort
            throw new Error('Node is no longer at head during deletion')
          }
          // CAS: Try to update HEAD_PTR to next node
        } while (
          Atomics.compareExchange(this.sab, HDR.HEAD_PTR, currentHead, nextPtr) !== currentHead
        )
      } else {
        // Update previous node's NEXT_PTR to skip over deleted node
        const prevOffset = this.nodeOffset(prevPtr)
        Atomics.store(this.sab, prevOffset + NODE.NEXT_PTR, nextPtr)
      }

      // Update next's PREV_PTR (if next exists)
      if (nextPtr !== NULL_PTR) {
        const nextOffset = this.nodeOffset(nextPtr)
        Atomics.store(this.sab, nextOffset + NODE.PREV_PTR, prevPtr)
      }

      // Decrement NODE_COUNT
      Atomics.sub(this.sab, HDR.NODE_COUNT, 1)

      // Free the node
      this.freeNode(ptr)

      // Signal structural change
      Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)
    } finally {
      // **CRITICAL**: Always release mutex, even if error occurs
      this._releaseChainMutex()
    }
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
   * Read node data at pointer with versioned read protection.
   *
   * This method uses the versioned read loop (v1.5) implemented in AttributePatcher
   * to prevent torn reads during concurrent attribute mutations.
   *
   * **Zero-Alloc, Audio-Realtime**: Returns null if contention detected (>50 spins).
   * Caller must handle null gracefully by skipping processing for one frame.
   *
   * @param ptr - Node byte pointer
   * @returns Node view or null if contention detected
   * @throws InvalidPointerError if pointer is NULL or invalid
   */
  readNode(ptr: NodePtr): NodeView | null {
    if (ptr === NULL_PTR) {
      throw new InvalidPointerError(ptr)
    }

    const attrs = this.patcher.readAttributes(ptr)

    // Contention detected - caller must skip this node
    if (attrs === null) {
      return null
    }

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
   * Iterate all nodes in chain order with versioned read protection.
   *
   * This generator uses the versioned read loop (v1.5) for each node
   * to prevent torn reads during traversal.
   *
   * **Zero-Alloc, Audio-Realtime**: Skips nodes with contention (null reads).
   *
   * @yields NodeView for each node in chain order (skips nodes with contention)
   */
  *iterateChain(): Generator<NodeView, void, unknown> {
    let ptr = this.getHead()

    while (ptr !== NULL_PTR) {
      const node = this.readNode(ptr)

      // Skip node if contention detected
      if (node === null) {
        // Try to advance to next node using current ptr's NEXT_PTR
        // This is safe because we only read one field
        const offset = this.nodeOffset(ptr)
        ptr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
        continue
      }

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
