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
  CONCURRENCY,
  ID_TABLE,
  SYM_TABLE,
  getSymbolTableOffset,
  CMD,
  SYNAPSE_TABLE,
  SYNAPSE,
  getSynapseTableOffset,
  KNUTH_HASH_CONST
} from './constants'
// Note: PACKED and SEQ are used directly in readNode for zero-alloc versioned reads
import { FreeList } from './free-list'
import { AttributePatcher } from './patch'
import { RingBuffer } from './ring-buffer'
import { createLinkerSAB, resetLinkerSAB } from './init'
import type {
  NodePtr,
  LinkerConfig,
  ISiliconLinker
} from './types'
// RFC-045-04: Error classes no longer thrown - using error codes instead

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
export class SiliconSynapse implements ISiliconLinker {
  private sab: Int32Array
  private sab64: BigInt64Array
  private buffer: SharedArrayBuffer
  private freeList: FreeList
  private patcher: AttributePatcher
  private ringBuffer: RingBuffer
  private heapStartI32: number
  private nodeCapacity: number

  // RFC-044: Command processing state
  private commandBuffer: Int32Array // Pre-allocated buffer for reading commands

  // RFC-045-04: Context-aware mutex behavior
  private isAudioContext: boolean = false

  /**
   * Create a new Silicon Linker.
   *
   * @param buffer - Initialized SharedArrayBuffer (use createLinkerSAB)
   */
  constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer
    this.sab = new Int32Array(buffer)
    this.sab64 = new BigInt64Array(buffer)
    this.heapStartI32 = HEAP_START_OFFSET / 4
    this.nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    this.freeList = new FreeList(this.sab, this.sab64)
    this.patcher = new AttributePatcher(this.sab, this.nodeCapacity)

    // RFC-044: Initialize Command Ring Buffer infrastructure
    this.ringBuffer = new RingBuffer(this.sab)
    this.commandBuffer = new Int32Array(4) // Pre-allocate for zero-alloc reads
  }

  /**
   * Create a Silicon Linker with a new SAB.
   *
   * @param config - Optional configuration
   * @returns New SiliconSynapse instance
   */
  static create(config?: LinkerConfig): SiliconSynapse {
    const buffer = createLinkerSAB(config)
    return new SiliconSynapse(buffer)
  }

  // ===========================================================================
  // RFC-045-04: Context-Aware Execution
  // ===========================================================================

  /**
   * Set execution context for mutex behavior (RFC-045-04).
   *
   * **CRITICAL:** Call `setAudioContext(true)` from AudioWorklet.process() entry
   * to enable audio-safe try-lock behavior. Call `setAudioContext(false)` on exit.
   *
   * **Audio Context Behavior:**
   * - Maximum 3 CAS attempts (~300ns)
   * - Immediate return false on contention (no blocking)
   * - No kernel panic (contention is acceptable, retry next block)
   *
   * **Main Thread Behavior:**
   * - Full spin-wait with yield (up to 200 iterations with 1ms yields)
   * - Kernel panic on exhaustion (deadlock detected)
   *
   * @param isAudio - true if called from AudioWorklet context
   */
  setAudioContext(isAudio: boolean): void {
    this.isAudioContext = isAudio
  }

  /**
   * Get current execution context.
   */
  getAudioContext(): boolean {
    return this.isAudioContext
  }

  // ===========================================================================
  // Chain Mutex (v1.5) - Concurrency Control
  // ===========================================================================

  /**
   * Zero-allocation CPU yield for worker context.
   *
   * Uses Atomics.wait() with 1ms timeout to sleep without allocating memory.
   * RFC-045-04: No try/catch - we detect Worker context via typeof check.
   *
   * @remarks
   * This is a synchronous sleep that doesn't create Promise garbage.
   * The 1ms timeout allows other threads to acquire the mutex.
   * On main thread (rare), Atomics.wait returns "not-equal" - no throw.
   */
  private _yieldToCPU(): void {
    // **ZERO-ALLOC**: Sleep for 1ms using Atomics.wait
    // This relinquishes the time slice without allocating memory.
    // Atomics.wait returns "timed-out" on timeout, "not-equal" if value differs,
    // or throws TypeError on main thread - but we catch that in isWorkerContext check.
    // Using a simple timeout approach that works in all contexts.
    Atomics.wait(this.sab, HDR.YIELD_SLOT, 0, 1)
  }

  /**
   * Increment 64-bit telemetry counter with proper carry handling (RFC-044 Decree 044-09).
   *
   * Atomically increments the 64-bit operation counter stored across
   * TELEMETRY_OPS_LOW and TELEMETRY_OPS_HIGH registers.
   *
   * **Carry Protocol**:
   * 1. Increment LOW register atomically
   * 2. If LOW register wrapped to 0, increment HIGH register
   * 3. Race condition on wrap is acceptable (undercounting by 1 is tolerable)
   *
   * **Performance**: Single-threaded increment is ~2ns, contended case is ~50ns.
   */
  private _incrementTelemetry(): void {
    // Atomically increment LOW register and get the new value
    const newLow = Atomics.add(this.sab, HDR.TELEMETRY_OPS_LOW, 1) + 1

    // If LOW wrapped around to 0, increment HIGH register (carry bit)
    // NOTE: There's a race condition where multiple threads could detect wrap
    // simultaneously, causing HIGH to increment multiple times. However,
    // this is acceptable for telemetry - we prioritize lock-free performance
    // over perfect accuracy at the 2^32 boundary.
    if (newLow === 0) {
      Atomics.add(this.sab, HDR.TELEMETRY_OPS_HIGH, 1)
    }
  }

  /**
   * Context-aware mutex acquisition (RFC-045-04 ISSUE-001).
   *
   * **Audio Context** (isAudioContext = true):
   * - Maximum AUDIO_SAFE_MAX_SPINS (3) CAS attempts (~300ns total)
   * - Immediate return false on contention (no blocking)
   * - No kernel panic (contention is acceptable, retry next audio block)
   *
   * **Main Thread Context** (isAudioContext = false):
   * - Full spin-wait with yield (up to MUTEX_PANIC_THRESHOLD × YIELD_AFTER_SPINS)
   * - Kernel panic on exhaustion (deadlock detected, sets ERROR_FLAG)
   *
   * @returns true if acquired, false if contention (audio) or deadlock (main)
   */
  private _acquireChainMutex(): boolean {
    // Determine max spins based on execution context
    const maxSpins = this.isAudioContext
      ? CONCURRENCY.AUDIO_SAFE_MAX_SPINS
      : CONCURRENCY.MUTEX_PANIC_THRESHOLD * (CONCURRENCY.YIELD_AFTER_SPINS + 1)

    let spins = 0
    let yieldCounter = 0

    while (spins < maxSpins) {
      // Attempt CAS: 0 → 1
      const prev = Atomics.compareExchange(
        this.sab,
        HDR.CHAIN_MUTEX,
        CONCURRENCY.MUTEX_UNLOCKED,
        CONCURRENCY.MUTEX_LOCKED
      )

      if (prev === CONCURRENCY.MUTEX_UNLOCKED) {
        return true // Successfully acquired
      }

      spins = spins + 1

      // Only yield in non-audio context (blocking is forbidden in audio thread)
      if (!this.isAudioContext) {
        yieldCounter = yieldCounter + 1
        if (yieldCounter > CONCURRENCY.YIELD_AFTER_SPINS) {
          this._yieldToCPU()
          yieldCounter = 0
        }
      }
    }

    // Contention handling:
    // - Audio context: Return false (acceptable, retry next block)
    // - Main context: Kernel panic (deadlock detected)
    if (!this.isAudioContext) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.KERNEL_PANIC)
    }

    return false
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
  // RFC-044: Low-Level Linking Helpers
  // ===========================================================================

  /**
   * Link an existing node into the chain after a given node (RFC-044).
   *
   * **CRITICAL:** This method assumes:
   * - Chain Mutex is already acquired by caller
   * - Node data is already written to SAB
   * - newPtr points to a valid, initialized node
   * - afterPtr points to a valid node in the chain
   *
   * This is the extracted linking logic from insertNode(), used by both
   * the old insertNode() method and the new RFC-044 executeInsert().
   *
   * @param newPtr - Pointer to node to link (already allocated and written)
   * @param afterPtr - Pointer to node to insert after
   */
  private _linkNode(newPtr: NodePtr, afterPtr: NodePtr): void {
    const newOffset = this.nodeOffset(newPtr)
    const afterOffset = this.nodeOffset(afterPtr)

    // 1. Link Future: newNode.NEXT_PTR = afterNode.NEXT_PTR, newNode.PREV_PTR = afterPtr
    const nextPtr = Atomics.load(this.sab, afterOffset + NODE.NEXT_PTR)
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, nextPtr)
    Atomics.store(this.sab, newOffset + NODE.PREV_PTR, afterPtr)

    // 2. Update nextNode.PREV_PTR = newPtr (if nextNode exists)
    if (nextPtr !== NULL_PTR) {
      const nextOffset = this.nodeOffset(nextPtr)
      Atomics.store(this.sab, nextOffset + NODE.PREV_PTR, newPtr)
    }

    // 3. Atomic Splice: afterNode.NEXT_PTR = newPtr
    Atomics.store(this.sab, afterOffset + NODE.NEXT_PTR, newPtr)

    // 4. Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)
  }

  /**
   * Link an existing node at the head of the chain (RFC-044).
   *
   * **CRITICAL:** This method assumes:
   * - Chain Mutex is already acquired by caller
   * - Node data is already written to SAB
   * - newPtr points to a valid, initialized node
   *
   * This is the extracted linking logic from insertHead(), used by both
   * the old insertHead() method and the new RFC-044 executeInsert().
   *
   * @param newPtr - Pointer to node to link (already allocated and written)
   */
  private _linkHead(newPtr: NodePtr): void {
    const newOffset = this.nodeOffset(newPtr)

    // 1. Load current head
    const currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)

    // 2. Link new node to current head
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, currentHead)
    Atomics.store(this.sab, newOffset + NODE.PREV_PTR, NULL_PTR) // New head has no prev

    // 3. Update old head's PREV_PTR to point to new head
    if (currentHead !== NULL_PTR) {
      const currentHeadOffset = this.nodeOffset(currentHead)
      Atomics.store(this.sab, currentHeadOffset + NODE.PREV_PTR, newPtr)
    }

    // 4. Update HEAD_PTR
    Atomics.store(this.sab, HDR.HEAD_PTR, newPtr)

    // 5. Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)
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
   * RFC-045-04: Returns false if violation, true if safe (no throw).
   */
  private checkSafeZone(targetTick: number): boolean {
    const playhead = Atomics.load(this.sab, HDR.PLAYHEAD_TICK)
    const safeZone = this.sab[HDR.SAFE_ZONE_TICKS]

    if (targetTick - playhead < safeZone && targetTick >= playhead) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.SAFE_ZONE)
      return false
    }
    return true
  }

  /**
   * Write node data to a node offset.
   */
  private writeNodeData(
    offset: number,
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): void {
    // Pack opcode, pitch, velocity, flags into PACKED_A
    const activeFlags = flags | FLAG.ACTIVE
    const packed =
      (opcode << PACKED.OPCODE_SHIFT) |
      ((pitch & 0xff) << PACKED.PITCH_SHIFT) |
      ((velocity & 0xff) << PACKED.VELOCITY_SHIFT) |
      (activeFlags & PACKED.FLAGS_MASK)

    this.sab[offset + NODE.PACKED_A] = packed
    this.sab[offset + NODE.BASE_TICK] = baseTick | 0
    this.sab[offset + NODE.DURATION] = duration | 0
    // NEXT_PTR set separately during linking
    this.sab[offset + NODE.SOURCE_ID] = sourceId | 0
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
   * RFC-045-04: Returns NULL_PTR on error (check ERROR_FLAG for details).
   *
   * @param afterPtr - Node to insert after
   * @param opcode - Node opcode
   * @param pitch - MIDI pitch
   * @param velocity - MIDI velocity
   * @param duration - Duration in ticks
   * @param baseTick - Base tick
   * @param sourceId - Source ID
   * @param flags - Initial flags
   * @returns Pointer to new node, or NULL_PTR on error
   */
  private _insertNode(
    afterPtr: NodePtr,
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr {
    // Allocate new node first (before acquiring mutex)
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      // ERROR_FLAG already set by allocNode
      return NULL_PTR
    }
    const newOffset = this.nodeOffset(newPtr)

    // Write all attributes (before acquiring mutex)
    this.writeNodeData(newOffset, opcode, pitch, velocity, duration, baseTick, sourceId, flags)

    // **v1.5 CHAIN MUTEX**: Protect structural mutation
    if (!this._acquireChainMutex()) {
      // Deadlock detected - free the node and return error
      this.freeNode(newPtr)
      return NULL_PTR
    }

    // 1. Check safe zone INSIDE mutex (playhead may have moved during wait)
    const afterOffset = this.nodeOffset(afterPtr)
    const targetTick = this.sab[afterOffset + NODE.BASE_TICK]
    if (!this.checkSafeZone(targetTick)) {
      // Safe zone violation - free node and release mutex
      this.freeNode(newPtr)
      this._releaseChainMutex()
      return NULL_PTR
    }

    // 2. Link Future: NoteX.NEXT_PTR = NoteB, NoteX.PREV_PTR = NoteA
    const noteBPtr = Atomics.load(this.sab, afterOffset + NODE.NEXT_PTR)
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, noteBPtr)
    Atomics.store(this.sab, newOffset + NODE.PREV_PTR, afterPtr)

    // 3. Update NoteB.PREV_PTR = NoteX (if NoteB exists)
    if (noteBPtr !== NULL_PTR) {
      const noteBOffset = this.nodeOffset(noteBPtr)
      Atomics.store(this.sab, noteBOffset + NODE.PREV_PTR, newPtr)
    }

    // 4. Atomic Splice: NoteA.NEXT_PTR = NoteX
    Atomics.store(this.sab, afterOffset + NODE.NEXT_PTR, newPtr)

    // 5. Increment NODE_COUNT (node is now linked)
    const currentCount = Atomics.load(this.sab, HDR.NODE_COUNT)
    Atomics.store(this.sab, HDR.NODE_COUNT, currentCount + 1)

    // 6. Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    // Release mutex and return success
    this._releaseChainMutex()
    return newPtr
  }

  /**
   * Insert a new node at the head of the chain.
   *
   * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
   *
   * RFC-045-04: Returns NULL_PTR on error (check ERROR_FLAG for details).
   *
   * @param opcode - Node opcode
   * @param pitch - MIDI pitch
   * @param velocity - MIDI velocity
   * @param duration - Duration in ticks
   * @param baseTick - Base tick
   * @param sourceId - Source ID
   * @param flags - Initial flags
   * @returns Pointer to new node, or NULL_PTR on error
   */
  private _insertHead(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr {
    // Allocate new node first (before acquiring mutex)
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      // ERROR_FLAG already set by allocNode
      return NULL_PTR
    }
    const newOffset = this.nodeOffset(newPtr)

    // Write attributes (before acquiring mutex)
    this.writeNodeData(newOffset, opcode, pitch, velocity, duration, baseTick, sourceId, flags)

    // **v1.5 CHAIN MUTEX**: Protect structural mutation
    if (!this._acquireChainMutex()) {
      // Deadlock detected - free the node and return error
      this.freeNode(newPtr)
      return NULL_PTR
    }

    // Check safe zone INSIDE mutex (playhead may have moved during wait)
    if (!this.checkSafeZone(baseTick)) {
      // Safe zone violation - free node and release mutex
      this.freeNode(newPtr)
      this._releaseChainMutex()
      return NULL_PTR
    }

    // Load current head (mutex guarantees exclusive access - no CAS needed)
    const currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)

    // Link new node to current head
    Atomics.store(this.sab, newOffset + NODE.NEXT_PTR, currentHead)
    Atomics.store(this.sab, newOffset + NODE.PREV_PTR, NULL_PTR) // New head has no prev

    // Update old head's PREV_PTR to point to new head
    if (currentHead !== NULL_PTR) {
      const currentHeadOffset = this.nodeOffset(currentHead)
      Atomics.store(this.sab, currentHeadOffset + NODE.PREV_PTR, newPtr)
    }

    // Update HEAD_PTR (simple store - mutex guarantees no concurrent modification)
    Atomics.store(this.sab, HDR.HEAD_PTR, newPtr)

    // Increment NODE_COUNT (node is now linked)
    const currentCount = Atomics.load(this.sab, HDR.NODE_COUNT)
    Atomics.store(this.sab, HDR.NODE_COUNT, currentCount + 1)

    // Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    // Track operation for telemetry
    this._incrementTelemetry()

    // Release mutex and return success
    this._releaseChainMutex()
    return newPtr
  }

  /**
   * Delete a node from the chain.
   *
   * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
   * O(1) deletion using PREV_PTR (doubly-linked list).
   *
   * RFC-045-04: Returns boolean instead of throwing (check ERROR_FLAG for details).
   *
   * @param ptr - Node to delete
   * @returns true if deleted, false on error
   */
  private _deleteNode(ptr: NodePtr): boolean {
    if (ptr === NULL_PTR) return true // No-op is success

    const offset = this.nodeOffset(ptr)

    // **v1.5 CHAIN MUTEX**: Protect structural mutation
    if (!this._acquireChainMutex()) {
      // Deadlock detected - ERROR_FLAG already set
      return false
    }

    // Check safe zone INSIDE mutex (playhead may have moved during wait)
    const targetTick = this.sab[offset + NODE.BASE_TICK]
    if (!this.checkSafeZone(targetTick)) {
      // Safe zone violation - release mutex and return error
      this._releaseChainMutex()
      return false
    }

    // Read prev and next pointers
    const prevPtr = Atomics.load(this.sab, offset + NODE.PREV_PTR)
    const nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)

    // Update prev's NEXT_PTR (or HEAD_PTR if deleting head)
    if (prevPtr === NULL_PTR) {
      // Deleting head - update HEAD_PTR (mutex guarantees exclusive access - no CAS needed)
      // Verify we're still deleting the head (sanity check)
      const currentHead = Atomics.load(this.sab, HDR.HEAD_PTR)
      if (currentHead !== ptr) {
        // Head changed - this shouldn't happen with mutex, set error and abort
        Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.INVALID_PTR)
        this._releaseChainMutex()
        return false
      }
      // Update HEAD_PTR to next node (simple store - mutex guarantees no concurrent modification)
      Atomics.store(this.sab, HDR.HEAD_PTR, nextPtr)
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

    // Decrement NODE_COUNT (RFC-045: now done at unlink time, not at free time)
    const currentCount = Atomics.load(this.sab, HDR.NODE_COUNT)
    Atomics.store(this.sab, HDR.NODE_COUNT, currentCount - 1)

    // Free the node
    this.freeNode(ptr)

    // Signal structural change
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    // Track operation for telemetry
    this._incrementTelemetry()

    // Release mutex and return success
    this._releaseChainMutex()
    return true
  }

  // ===========================================================================
  // Commit Protocol
  // ===========================================================================


  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Read node data at pointer with zero-allocation callback pattern.
   *
   * This method implements the versioned-read loop (v1.5) INTERNALLY using
   * local stack variables to prevent torn reads during concurrent attribute
   * mutations. NO object allocations occur during this read.
   *
   * **Zero-Alloc, Audio-Realtime**: Returns false if contention detected (>50 spins).
   * Caller must handle false return gracefully by skipping processing for one frame.
   *
   * CRITICAL: Callback function must be pre-bound/hoisted to avoid allocations.
   * DO NOT pass inline arrow functions - they allocate objects.
   *
   * RFC-045-04: Returns false instead of throwing for NULL_PTR.
   *
   * @param ptr - Node byte pointer
   * @param cb - Callback receiving node data as primitive arguments
   * @returns true if read succeeded, false if NULL_PTR or contention detected
   */
  readNode(
    ptr: NodePtr,
    cb: (
      ptr: number,
      opcode: number,
      pitch: number,
      velocity: number,
      duration: number,
      baseTick: number,
      nextPtr: number,
      sourceId: number,
      flags: number,
      seq: number
    ) => void
  ): boolean {
    if (ptr === NULL_PTR) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.INVALID_PTR)
      return false // RFC-045-04: Return error instead of throwing
    }

    const offset = this.nodeOffset(ptr)

    // Local stack variables for versioned read (ZERO ALLOCATION)
    let seq1: number, seq2: number
    let packed: number, duration: number, baseTick: number, nextPtr: number, sourceId: number
    let retries = 0

    // **AUDIO-REALTIME CONSTRAINT**: Max 50 spins, no yield
    const MAX_SPINS = 50

    do {
      // Contention exceeded threshold - return false to skip this node
      if (retries >= MAX_SPINS) {
        return false
      }

      // Read SEQ before reading fields (version number)
      seq1 = (Atomics.load(this.sab, offset + NODE.SEQ_FLAGS) & SEQ.SEQ_MASK) >>> SEQ.SEQ_SHIFT

      // Read all fields atomically
      packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
      duration = Atomics.load(this.sab, offset + NODE.DURATION)
      baseTick = Atomics.load(this.sab, offset + NODE.BASE_TICK)
      nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
      sourceId = Atomics.load(this.sab, offset + NODE.SOURCE_ID)

      // Read SEQ after reading fields
      seq2 = (Atomics.load(this.sab, offset + NODE.SEQ_FLAGS) & SEQ.SEQ_MASK) >>> SEQ.SEQ_SHIFT

      // If SEQ changed, writer was mutating during our read - retry
      if (seq1 !== seq2) {
        retries = retries + 1
      }
    } while (seq1 !== seq2)

    // SEQ is stable - extract fields from packed and invoke callback
    const opcode = (packed & PACKED.OPCODE_MASK) >>> PACKED.OPCODE_SHIFT
    const pitch = (packed & PACKED.PITCH_MASK) >>> PACKED.PITCH_SHIFT
    const velocity = (packed & PACKED.VELOCITY_MASK) >>> PACKED.VELOCITY_SHIFT
    const flags = packed & PACKED.FLAGS_MASK

    // Invoke callback with stack variables (zero allocation)
    cb(ptr, opcode, pitch, velocity, duration, baseTick, nextPtr, sourceId, flags, seq1)

    return true
  }

  /**
   * Get head of chain.
   */
  getHead(): NodePtr {
    return Atomics.load(this.sab, HDR.HEAD_PTR)
  }

  /**
   * Traverse all nodes in chain order with zero-allocation callback pattern.
   *
   * Uses versioned read loop (v1.5) to prevent torn reads during traversal.
   * All node data is passed directly to callback as stack variables - no objects created.
   *
   * **CRITICAL PERFORMANCE NOTE:** Consumers MUST hoist/pre-bind their callback function.
   * Passing inline arrow functions will allocate objects and defeat the Zero-Alloc purpose.
   *
   * **Contention Handling:** If a node read experiences contention, this method will retry
   * until a consistent read is obtained. Data integrity is prioritized over performance.
   * Safety bailout after 1,000 retries sets ERROR_FLAG and skips the node.
   *
   * RFC-045-04: Returns boolean - false if severe contention occurred.
   *
   * @param cb - Callback function receiving node data as primitive arguments
   * @returns true if all nodes traversed, false if contention bailout occurred
   */
  traverse(
    cb: (
      ptr: number,
      opcode: number,
      pitch: number,
      velocity: number,
      duration: number,
      baseTick: number,
      flags: number,
      sourceId: number,
      seq: number
    ) => void
  ): boolean {
    let ptr = this.getHead()
    let hadContention = false

    while (ptr !== NULL_PTR) {
      const offset = this.nodeOffset(ptr)

      // Versioned read loop - retry until we get a consistent snapshot
      let seq1: number, seq2: number
      let packed: number,
        duration: number,
        baseTick: number,
        nextPtr: number,
        sourceId: number
      let retries = 0
      let bailedOut = false

      do {
        // Read SEQ before reading fields (version number)
        seq1 =
          (Atomics.load(this.sab, offset + NODE.SEQ_FLAGS) & SEQ.SEQ_MASK) >>> SEQ.SEQ_SHIFT

        // Read all fields atomically
        packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
        duration = Atomics.load(this.sab, offset + NODE.DURATION)
        baseTick = Atomics.load(this.sab, offset + NODE.BASE_TICK)
        nextPtr = Atomics.load(this.sab, offset + NODE.NEXT_PTR)
        sourceId = Atomics.load(this.sab, offset + NODE.SOURCE_ID)

        // Read SEQ after reading fields
        seq2 =
          (Atomics.load(this.sab, offset + NODE.SEQ_FLAGS) & SEQ.SEQ_MASK) >>> SEQ.SEQ_SHIFT

        // If SEQ changed, writer was mutating during our read - retry
        if (seq1 !== seq2) {
          // Safety bailout: prevent infinite loop on severe contention
          if (retries >= 1000) {
            // RFC-045-04: Set error flag and skip node instead of throwing
            Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.KERNEL_PANIC)
            hadContention = true
            bailedOut = true
            // Skip to next node using NEXT_PTR from last read
            ptr = nextPtr
            break
          }
          retries = retries + 1
        }
      } while (seq1 !== seq2)

      // If we bailed out due to contention, continue to next iteration
      if (bailedOut) {
        continue
      }

      // SEQ is stable - extract opcode/pitch/velocity/flags from packed field
      const opcode = (packed & PACKED.OPCODE_MASK) >>> PACKED.OPCODE_SHIFT
      const pitch = (packed & PACKED.PITCH_MASK) >>> PACKED.PITCH_SHIFT
      const velocity = (packed & PACKED.VELOCITY_MASK) >>> PACKED.VELOCITY_SHIFT
      const flags = packed & PACKED.FLAGS_MASK

      // Invoke callback with stack variables (zero allocation)
      cb(ptr, opcode, pitch, velocity, duration, baseTick, flags, sourceId, seq1)

      // Advance to next node
      ptr = nextPtr
    }

    return !hadContention
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
   * Reset the entire Linker state (RFC-044 Resilience).
   *
   * **DANGER:** This nukes all memory state:
   * - Clears all nodes and resets chain to empty
   * - Reinitializes Zone A free list (Zone B left untouched)
   * - Clears Identity and Symbol tables
   * - Resets Ring Buffer headers
   * - Clears error flags
   * - Wakes blocked Worker threads via Atomics.notify
   *
   * **Thread Safety:**
   * NOT thread-safe. Only call when no other threads are accessing the SAB.
   * Typically used during app initialization or after detecting a stale SAB.
   *
   * **Use Cases:**
   * - Page reload detected (SAB persists but app state is fresh)
   * - Zone B exhaustion recovery
   * - Error recovery after KERNEL_PANIC
   *
   * After calling reset(), the SiliconBridge must also call
   * `localAllocator.reset()` to reset Zone B bump pointer.
   */
  reset(): void {
    resetLinkerSAB(this.buffer)

    // Wake any Worker threads blocked on Atomics.wait(YIELD_SLOT)
    // This ensures Workers immediately see the reset state (HEAD_PTR = NULL, etc.)
    Atomics.notify(this.sab, HDR.YIELD_SLOT, 1)
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

  // ===========================================================================
  // Identity Table Operations (v1.5)
  // ===========================================================================

  /**
   * Compute hash slot for a sourceId using Knuth's multiplicative hash.
   *
   * **Bitwise Optimization**: Uses `& (capacity - 1)` instead of `% capacity`
   * since DEFAULT_CAPACITY is 4096 (power of 2). This eliminates expensive
   * modulo division on the hot path.
   *
   * @param sourceId - The source ID to hash
   * @returns Slot index in the Identity Table
   */
  private idTableHash(sourceId: number): number {
    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    // Knuth's multiplicative hash with bitwise modulo (capacity must be power of 2)
    const hash = Math.imul(sourceId >>> 0, KNUTH_HASH_CONST) >>> 0
    return hash & (capacity - 1)
  }

  /**
   * Get the i32 offset for a slot in the Identity Table.
   * Each slot is 2 × i32: [TID, NodePtr]
   */
  private idTableSlotOffset(slot: number): number {
    const tablePtr = Atomics.load(this.sab, HDR.ID_TABLE_PTR)
    return (tablePtr / 4) + slot * ID_TABLE.ENTRY_SIZE_I32
  }

  /**
   * Insert a sourceId → NodePtr mapping into the Identity Table.
   * Uses linear probing for collision resolution.
   *
   * **Atomic Strictness**: All slot reads/writes use Atomics for thread safety.
   * **Load Factor Enforcement**: Sets ERROR_FLAG if load factor exceeds 75%.
   *
   * @param sourceId - Source ID (must be > 0)
   * @param ptr - Node pointer
   * @returns true if inserted, false if table full
   */
  idTableInsert(sourceId: number, ptr: NodePtr): boolean {
    if (sourceId <= 0) return false

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    let i = 0
    while (i < capacity) {
      const offset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, offset)

      if (tid === ID_TABLE.EMPTY_TID || tid === ID_TABLE.TOMBSTONE_TID) {
        // Empty or tombstone slot - insert here
        Atomics.store(this.sab, offset, sourceId)
        Atomics.store(this.sab, offset + 1, ptr)
        const newUsed = Atomics.add(this.sab, HDR.ID_TABLE_USED, 1) + 1

        // Load factor enforcement: warn if > 75% full
        if (newUsed / capacity > ID_TABLE.LOAD_FACTOR_WARNING) {
          Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.LOAD_FACTOR_WARNING)
        }

        return true
      }

      if (tid === sourceId) {
        // Already exists - update ptr
        Atomics.store(this.sab, offset + 1, ptr)
        return true
      }

      // Linear probe to next slot (bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Table full
    return false
  }

  /**
   * Lookup a NodePtr by sourceId in the Identity Table.
   * Uses linear probing for collision resolution.
   *
   * **Atomic Strictness**: All slot reads use Atomics for thread safety.
   *
   * @param sourceId - Source ID to lookup
   * @returns NodePtr if found, NULL_PTR if not found
   */
  idTableLookup(sourceId: number): NodePtr {
    if (sourceId <= 0) return NULL_PTR

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    let i = 0
    while (i < capacity) {
      const offset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, offset)

      if (tid === ID_TABLE.EMPTY_TID) {
        // Empty slot - not found
        return NULL_PTR
      }

      if (tid === sourceId) {
        // Found
        return Atomics.load(this.sab, offset + 1)
      }

      // Linear probe (skip tombstones, bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Not found after full scan
    return NULL_PTR
  }

  /**
   * Remove a sourceId from the Identity Table.
   * Marks the slot as a tombstone (TID = -1).
   *
   * **Atomic Strictness**: All slot reads/writes use Atomics for thread safety.
   *
   * NOTE: Tombstones accumulate over time and degrade lookup performance.
   * Call idTableRepack() during bridge.clear() to eliminate tombstones.
   *
   * @param sourceId - Source ID to remove
   * @returns true if removed, false if not found
   */
  idTableRemove(sourceId: number): boolean {
    if (sourceId <= 0) return false

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    let i = 0
    while (i < capacity) {
      const offset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, offset)

      if (tid === ID_TABLE.EMPTY_TID) {
        // Empty slot - not found
        return false
      }

      if (tid === sourceId) {
        // Found - mark as tombstone
        Atomics.store(this.sab, offset, ID_TABLE.TOMBSTONE_TID)
        Atomics.store(this.sab, offset + 1, NULL_PTR)
        return true
      }

      // Linear probe (bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Not found
    return false
  }

  /**
   * Clear the entire Identity Table (memset-style).
   * Sets all slots to EMPTY_TID (0).
   *
   * **Atomic Strictness**: All writes use Atomics for thread safety.
   * This also eliminates all tombstones (effective re-pack).
   */
  idTableClear(): void {
    const tablePtr = Atomics.load(this.sab, HDR.ID_TABLE_PTR)
    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    const tableOffsetI32 = tablePtr / 4
    const totalI32 = capacity * ID_TABLE.ENTRY_SIZE_I32

    // Zero out entire table using Atomics
    let i = 0
    while (i < totalI32) {
      Atomics.store(this.sab, tableOffsetI32 + i, 0)
      i = i + 1
    }

    // Reset used count and clear load factor warning
    Atomics.store(this.sab, HDR.ID_TABLE_USED, 0)
    // Clear ERROR_FLAG only if it was LOAD_FACTOR_WARNING
    const currentError = Atomics.load(this.sab, HDR.ERROR_FLAG)
    if (currentError === ERROR.LOAD_FACTOR_WARNING) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.OK)
    }
  }

  // ===========================================================================
  // Symbol Table Operations (v1.5) - SourceId → Packed SourceLocation
  // ===========================================================================

  /**
   * Get the i32 offset for a slot in the Symbol Table.
   * Each slot is 2 × i32: [fileHash, lineCol]
   */
  private symTableSlotOffset(slot: number): number {
    // Read capacity atomically to prevent desync in multi-worker environments
    const nodeCapacity = Atomics.load(this.sab, HDR.NODE_CAPACITY)
    const tableOffset = getSymbolTableOffset(nodeCapacity)
    return (tableOffset / 4) + slot * SYM_TABLE.ENTRY_SIZE_I32
  }

  /**
   * Store a packed SourceLocation in the Symbol Table for a sourceId.
   * Uses the same linear probing as Identity Table to find the slot.
   *
   * **Race-Free Write Order**: This method can be called BEFORE idTableInsert
   * to prevent transient states where Identity Table has an entry but Symbol
   * Table doesn't. It finds the slot independently using the same hash/probe logic.
   *
   * @param sourceId - Source ID
   * @param fileHash - Hash of the file path
   * @param line - Line number (0-65535)
   * @param column - Column number (0-65535)
   * @returns true if stored, false if table full
   */
  symTableStore(sourceId: number, fileHash: number, line: number, column: number): boolean {
    if (sourceId <= 0) return false

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    // Probe to find the slot where sourceId will be/is stored
    // Uses same logic as idTableInsert for consistency
    let i = 0
    while (i < capacity) {
      const idOffset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, idOffset)

      // Empty slot or matching sourceId - this is where we write
      if (tid === ID_TABLE.EMPTY_TID || tid === ID_TABLE.TOMBSTONE_TID || tid === sourceId) {
        // Store location in Symbol Table at this slot
        const symOffset = this.symTableSlotOffset(slot)
        const lineCol = ((line & SYM_TABLE.MAX_LINE) << SYM_TABLE.LINE_SHIFT) |
                        (column & SYM_TABLE.COLUMN_MASK)
        Atomics.store(this.sab, symOffset, fileHash | 0)
        Atomics.store(this.sab, symOffset + 1, lineCol)
        return true
      }

      // Collision - linear probe to next slot (bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Table full
    return false
  }

  /**
   * Lookup a packed SourceLocation by sourceId with zero-allocation callback.
   * Uses the same linear probing as Identity Table.
   *
   * @param sourceId - Source ID to lookup
   * @param cb - Callback receiving (fileHash, line, column) if found
   * @returns true if found and callback invoked, false if not found
   */
  symTableLookup(
    sourceId: number,
    cb: (fileHash: number, line: number, column: number) => void
  ): boolean {
    if (sourceId <= 0) return false

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    // Probe to find the slot where sourceId is stored in Identity Table
    let i = 0
    while (i < capacity) {
      const idOffset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, idOffset)

      if (tid === ID_TABLE.EMPTY_TID) {
        // Empty slot - sourceId not found
        return false
      }

      if (tid === sourceId) {
        // Found the slot - read from Symbol Table at same slot
        const symOffset = this.symTableSlotOffset(slot)
        const fileHash = Atomics.load(this.sab, symOffset)
        const lineCol = Atomics.load(this.sab, symOffset + 1)

        // Check if location was stored (fileHash != 0)
        if (fileHash === SYM_TABLE.EMPTY_ENTRY) {
          return false
        }

        // Unpack and invoke callback
        const line = (lineCol >>> SYM_TABLE.LINE_SHIFT) & SYM_TABLE.MAX_LINE
        const column = lineCol & SYM_TABLE.COLUMN_MASK
        cb(fileHash, line, column)
        return true
      }

      // Linear probe (continue past tombstones, bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Not found after full scan
    return false
  }

  /**
   * Remove a SourceLocation from the Symbol Table.
   * Clears the entry at the slot corresponding to sourceId.
   *
   * @param sourceId - Source ID whose location should be removed
   * @returns true if removed, false if not found
   */
  symTableRemove(sourceId: number): boolean {
    if (sourceId <= 0) return false

    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    let slot = this.idTableHash(sourceId)

    // Probe to find the slot where sourceId is stored in Identity Table
    let i = 0
    while (i < capacity) {
      const idOffset = this.idTableSlotOffset(slot)
      const tid = Atomics.load(this.sab, idOffset)

      if (tid === ID_TABLE.EMPTY_TID) {
        // Empty slot - sourceId not found
        return false
      }

      if (tid === sourceId) {
        // Found the slot - clear Symbol Table entry at same slot
        const symOffset = this.symTableSlotOffset(slot)
        Atomics.store(this.sab, symOffset, SYM_TABLE.EMPTY_ENTRY)
        Atomics.store(this.sab, symOffset + 1, 0)
        return true
      }

      // Linear probe (bitwise for power-of-2 capacity)
      slot = (slot + 1) & (capacity - 1)
      i = i + 1
    }

    // Not found
    return false
  }

  /**
   * Clear the entire Symbol Table (memset-style).
   * Sets all entries to EMPTY_ENTRY (0).
   */
  symTableClear(): void {
    // Read node capacity atomically to prevent desync in multi-worker environments
    const nodeCapacity = Atomics.load(this.sab, HDR.NODE_CAPACITY)
    const tableOffset = getSymbolTableOffset(nodeCapacity)
    const capacity = Atomics.load(this.sab, HDR.ID_TABLE_CAPACITY)
    const tableOffsetI32 = tableOffset / 4
    const totalI32 = capacity * SYM_TABLE.ENTRY_SIZE_I32

    // Zero out entire table using Atomics
    let i = 0
    while (i < totalI32) {
      Atomics.store(this.sab, tableOffsetI32 + i, 0)
      i = i + 1
    }
  }

  // ===========================================================================
  // RFC-045: Synapse Table Operations
  // ===========================================================================

  /**
   * Clear the entire Synapse Table (memset-style).
   * Sets all SOURCE_PTR fields to NULL_PTR, effectively tombstoning all synapses.
   *
   * **Performance:** O(n) where n = SYNAPSE_TABLE.MAX_CAPACITY (65536).
   * Approximately 260KB of memory touched. ~1ms on modern hardware.
   *
   * **Thread Safety:** Must be called with Chain Mutex held.
   */
  private synapseTableClear(): void {
    const nodeCapacity = Atomics.load(this.sab, HDR.NODE_CAPACITY)
    const tableOffsetI32 = getSynapseTableOffset(nodeCapacity) / 4

    let slot = 0
    while (slot < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = tableOffsetI32 + slot * SYNAPSE_TABLE.STRIDE_I32
      // Zero all 4 words of each synapse entry
      Atomics.store(this.sab, offset + SYNAPSE.SOURCE_PTR, NULL_PTR)
      Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, NULL_PTR)
      Atomics.store(this.sab, offset + SYNAPSE.WEIGHT_DATA, 0)
      Atomics.store(this.sab, offset + SYNAPSE.META_NEXT, 0)
      slot = slot + 1
    }
  }

  // ===========================================================================
  // RFC-044: Command Ring Processing (Worker/Consumer Side)
  // ===========================================================================

  /**
   * Process pending commands from the Ring Buffer (RFC-044).
   *
   * This is the "Read Path" of the RFC-044 protocol. The Worker dequeues
   * commands written by the Main Thread and executes them asynchronously.
   *
   * **Hybrid Trigger:**
   * - Passive: Called by AudioWorklet at start of process() (polling)
   * - Active: Worker wakes via Atomics.wait() on YIELD_SLOT
   *
   * **Performance:**
   * - Processes max 256 commands per call to prevent audio starvation
   * - Each command: ~1-2µs (linking only, allocation already done)
   *
   * @returns Number of commands processed
   */
  processCommands(): number {
    const MAX_COMMANDS_PER_CYCLE = 256
    let commandsProcessed = 0

    // Process commands until ring is empty or limit reached
    while (commandsProcessed < MAX_COMMANDS_PER_CYCLE) {
      // Read next command (zero-alloc: reuses this.commandBuffer)
      const hasCommand = this.ringBuffer.read(this.commandBuffer)
      if (!hasCommand) {
        break // Ring buffer is empty
      }

      // Decode command
      const opcode = this.commandBuffer[0]
      const param1 = this.commandBuffer[1]
      const param2 = this.commandBuffer[2]
      // param3 (commandBuffer[3]) is RESERVED

      // Execute command based on opcode
      switch (opcode) {
        case CMD.INSERT:
          this.executeInsert(param1, param2)
          break
        case CMD.DELETE:
          this.executeDelete(param1)
          break
        case CMD.CLEAR:
          this.executeClear()
          break
        case CMD.PATCH:
          // PATCH not implemented in MVP (direct patches are immediate)
          // Could be used for batched/deferred patches in future
          break
        default:
          // Unknown opcode - set error flag (zero-allocation)
          Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.UNKNOWN_OPCODE)
      }

      commandsProcessed = commandsProcessed + 1
    }

    return commandsProcessed
  }

  /**
   * Execute INSERT command: Link a floating node into the chain (RFC-044).
   *
   * **Protocol:**
   * - ptr: Byte offset to node (already allocated in Zone B and written)
   * - prevPtr: Byte offset to insert after (NULL_PTR = head insert)
   *
   * **Steps:**
   * 1. Acquire Chain Mutex
   * 2. Validate pointers
   * 3. Link node using _linkNode or _linkHead
   * 4. Update Identity Table
   * 5. Release mutex
   *
   * RFC-045-04: Returns boolean instead of throwing.
   *
   * @param ptr - Pointer to node to link (Zone B)
   * @param prevPtr - Pointer to insert after (or NULL_PTR for head)
   * @returns true on success, false on error (ERROR_FLAG set)
   */
  private executeInsert(ptr: NodePtr, prevPtr: NodePtr): boolean {
    // Acquire mutex for structural operation
    if (!this._acquireChainMutex()) {
      return false // Deadlock - ERROR_FLAG already set
    }

    // Validate ptr is in valid range
    const ptrOffset = ptr / 4
    if (ptrOffset < this.heapStartI32 || ptr >= this.buffer.byteLength) {
      Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.INVALID_PTR)
      this._releaseChainMutex()
      return false
    }

    // Read sourceId from the node (already written by Main Thread)
    const nodeOffset = this.nodeOffset(ptr)
    const sourceId = Atomics.load(this.sab, nodeOffset + NODE.SOURCE_ID)

    // Link the node into the chain
    if (prevPtr === NULL_PTR) {
      // Head insert
      this._linkHead(ptr)
    } else {
      // Insert after prevPtr
      // Validate prevPtr is in valid range
      const prevPtrOffset = prevPtr / 4
      if (prevPtrOffset < this.heapStartI32 || prevPtr >= this.buffer.byteLength) {
        Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.INVALID_PTR)
        this._releaseChainMutex()
        return false
      }
      this._linkNode(ptr, prevPtr)
    }

    // Update Identity Table (sourceId → ptr mapping)
    if (sourceId > 0) {
      this.idTableInsert(sourceId, ptr)
    }

    // Increment NODE_COUNT (node is now linked)
    const currentCount = Atomics.load(this.sab, HDR.NODE_COUNT)
    Atomics.store(this.sab, HDR.NODE_COUNT, currentCount + 1)

    // Track operation for telemetry
    this._incrementTelemetry()

    this._releaseChainMutex()
    return true
  }

  /**
   * Execute DELETE command: Remove a node from the chain (RFC-044).
   *
   * **Note:** This uses the existing _deleteNode() method which already
   * handles mutex acquisition and Identity Table cleanup.
   *
   * RFC-045-04: Returns boolean (no try/catch).
   *
   * @param ptr - Pointer to node to delete
   * @returns true on success, false on error
   */
  private executeDelete(ptr: NodePtr): boolean {
    // RFC-045-04: _deleteNode now returns boolean instead of throwing
    return this._deleteNode(ptr)
  }

  /**
   * Execute CLEAR command: Remove all nodes from the chain (RFC-044).
   *
   * RFC-045-04: Returns boolean instead of using try/finally.
   *
   * **Implementation:** Uses while-head deletion loop (zero-alloc).
   *
   * @returns true on success, false on mutex error
   */
  private executeClear(): boolean {
    if (!this._acquireChainMutex()) {
      return false // Deadlock - ERROR_FLAG already set
    }

    // While-head deletion loop (zero-alloc)
    let headPtr = Atomics.load(this.sab, HDR.HEAD_PTR)
    while (headPtr !== NULL_PTR) {
      const headOffset = this.nodeOffset(headPtr)
      const nextPtr = Atomics.load(this.sab, headOffset + NODE.NEXT_PTR)

      // Return node to free list
      this.freeList.free(headPtr)

      // Move to next
      headPtr = nextPtr
    }

    // Update header
    Atomics.store(this.sab, HDR.HEAD_PTR, NULL_PTR)
    Atomics.store(this.sab, HDR.NODE_COUNT, 0)
    Atomics.store(this.sab, HDR.COMMIT_FLAG, COMMIT.PENDING)

    // Clear Identity, Symbol, and Synapse tables
    this.idTableClear()
    this.symTableClear()
    this.synapseTableClear()

    // Track operation for telemetry
    this._incrementTelemetry()

    this._releaseChainMutex()
    return true
  }

  /**
   * Poll for pending commands (passive trigger for AudioWorklet).
   *
   * This method should be called at the start of the AudioWorklet's
   * process() method to consume any pending commands from the Ring Buffer.
   *
   * **Usage:**
   * ```typescript
   * process(inputs, outputs, parameters) {
   *   this.linker.poll() // Process pending structural edits
   *   // ... then render audio
   * }
   * ```
   *
   * @returns Number of commands processed
   */
  poll(): number {
    // RFC-045-04 ISSUE-001: Set audio context for safe mutex behavior
    this.isAudioContext = true
    const result = this.processCommands()
    this.isAudioContext = false
    return result
  }

  // ===========================================================================
  // Test Helper Methods (RFC-045-FINAL)
  // ===========================================================================

  /**
   * Insert a node at head (test helper - routes through command ring).
   *
   * @internal This method is for test compatibility only. Production code
   * should use the Bridge's insertAsync() method.
   */
  insertHead(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr {
    // Check safe zone before allocating
    if (!this.checkSafeZone(baseTick)) {
      return NULL_PTR
    }

    // Allocate node first
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      return NULL_PTR
    }

    // Write node data directly (Zone A allocation)
    const offset = this.nodeOffset(newPtr)
    this.writeNodeData(offset, opcode, pitch, velocity, duration, baseTick, sourceId, flags)

    // Queue INSERT command
    this.ringBuffer.write(CMD.INSERT, newPtr, NULL_PTR) // NULL_PTR = head insert

    // Process immediately
    this.processCommands()

    return newPtr
  }

  /**
   * Insert a node after another (test helper - routes through command ring).
   *
   * @internal This method is for test compatibility only.
   */
  insertNode(
    afterPtr: NodePtr,
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr {
    // Check safe zone using afterPtr's baseTick (insertion point)
    const afterOffset = this.nodeOffset(afterPtr)
    const targetTick = this.sab[afterOffset + NODE.BASE_TICK]
    if (!this.checkSafeZone(targetTick)) {
      return NULL_PTR
    }

    // Allocate node first
    const newPtr = this.allocNode()
    if (newPtr === NULL_PTR) {
      return NULL_PTR
    }

    // Write node data directly (Zone A allocation)
    const offset = this.nodeOffset(newPtr)
    this.writeNodeData(offset, opcode, pitch, velocity, duration, baseTick, sourceId, flags)

    // Queue INSERT command
    this.ringBuffer.write(CMD.INSERT, newPtr, afterPtr)

    // Process immediately
    this.processCommands()

    return newPtr
  }

  /**
   * Delete a node (test helper - routes through command ring).
   *
   * @internal This method is for test compatibility only.
   */
  deleteNode(ptr: NodePtr): boolean {
    if (ptr === NULL_PTR) return true

    // Check safe zone before deleting
    const offset = this.nodeOffset(ptr)
    const targetTick = this.sab[offset + NODE.BASE_TICK]
    if (!this.checkSafeZone(targetTick)) {
      return false
    }

    // Queue DELETE command
    this.ringBuffer.write(CMD.DELETE, ptr, 0)

    // Process immediately
    this.processCommands()

    return true
  }
}
