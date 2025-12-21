// =============================================================================
// SymphonyScript - Silicon Linker Free List (RFC-043 Revision B)
// =============================================================================
// Lock-free LIFO stack using 64-bit Tagged Pointers (Version + Pointer) to
// eliminate ABA problem without sequence counters.

import {
  HDR,
  HDR_I64,
  NODE,
  NODE_SIZE_I32,
  NODE_SIZE_BYTES,
  NULL_PTR,
  SEQ,
  FLAG,
  HEAP_START_OFFSET
} from './constants'
import type { NodePtr } from './types'

/**
 * Lock-free free list implementation using 64-bit tagged pointers.
 *
 * The free list is a LIFO stack where:
 * - FREE_LIST_HEAD (64-bit) stores: (version << 32) | (ptr & 0xFFFFFFFF)
 * - Each free node's PACKED_A field (slot 0) stores the next free pointer (32-bit)
 * - Allocation pops from head, deallocation pushes to head
 *
 * Thread safety:
 * - All operations use Atomics.compareExchange on BigInt64Array
 * - Version counter in upper 32 bits provides ABA protection
 * - No per-node sequence counters needed for free list operations
 */
export class FreeList {
  private sab: Int32Array
  private sab64: BigInt64Array
  private heapStartI32: number
  private nodeCapacity: number

  constructor(sab: Int32Array, sab64: BigInt64Array) {
    this.sab = sab
    this.sab64 = sab64
    // Heap starts at byte offset 128, which is i32 index 32
    this.heapStartI32 = HEAP_START_OFFSET / 4
    this.nodeCapacity = sab[HDR.NODE_CAPACITY]
  }

  /**
   * Convert a byte pointer to i32 index within the SAB.
   */
  private ptrToI32Index(ptr: NodePtr): number {
    return ptr / 4
  }

  /**
   * Convert an i32 index to byte pointer.
   */
  private i32IndexToPtr(index: number): NodePtr {
    return index * 4
  }

  /**
   * Get the i32 offset for a node given its byte pointer.
   */
  nodeOffset(ptr: NodePtr): number {
    return this.ptrToI32Index(ptr)
  }

  /**
   * Validate that a pointer is within the heap bounds.
   */
  private isValidPtr(ptr: NodePtr): boolean {
    if (ptr === NULL_PTR) return true // NULL is valid (means end)

    const i32Index = this.ptrToI32Index(ptr)
    const nodeIndex = (i32Index - this.heapStartI32) / NODE_SIZE_I32

    return (
      nodeIndex >= 0 &&
      nodeIndex < this.nodeCapacity &&
      (i32Index - this.heapStartI32) % NODE_SIZE_I32 === 0
    )
  }

  /**
   * Zero out a node's fields (called after allocation).
   */
  private zeroNode(offset: number): void {
    this.sab[offset + NODE.PACKED_A] = 0
    this.sab[offset + NODE.BASE_TICK] = 0
    this.sab[offset + NODE.DURATION] = 0
    this.sab[offset + NODE.NEXT_PTR] = NULL_PTR
    this.sab[offset + NODE.PREV_PTR] = NULL_PTR
    this.sab[offset + NODE.SOURCE_ID] = 0
    // Keep SEQ_FLAGS - we increment SEQ on free, don't reset it
    this.sab[offset + NODE.LAST_PASS_ID] = 0
  }

  /**
   * Allocate a node from the free list.
   *
   * Uses 64-bit tagged pointer CAS to eliminate ABA problem.
   * Tagged pointer format: (version << 32) | (ptr & 0xFFFFFFFF)
   *
   * Returns NULL_PTR if heap is exhausted.
   */
  alloc(): NodePtr {
    // CAS loop - retry until we successfully pop a node
    while (true) {
      // Load current 64-bit tagged head
      const head = Atomics.load(this.sab64, HDR_I64.FREE_LIST_HEAD)

      // Extract pointer from lower 32 bits
      const ptr = Number(head & 0xFFFFFFFFn)

      // Heap exhausted
      if (ptr === NULL_PTR) {
        return NULL_PTR
      }

      // Validate pointer
      if (!this.isValidPtr(ptr)) {
        // Corrupted free list - this shouldn't happen
        console.error('[FreeList] Invalid head pointer:', ptr)
        return NULL_PTR
      }

      const headOffset = this.nodeOffset(ptr)

      // Read the next pointer from the free node
      // In free nodes, PACKED_A stores the next free pointer (32-bit)
      const next = Atomics.load(this.sab, headOffset + NODE.PACKED_A)

      // Extract version from upper 32 bits and increment
      const version = head >> 32n
      const newVersion = version + 1n

      // Construct new tagged head: (newVersion << 32) | next
      const newHead = (newVersion << 32n) | BigInt(next)

      // CAS: try to update FREE_LIST_HEAD from head to newHead
      const result = Atomics.compareExchange(
        this.sab64,
        HDR_I64.FREE_LIST_HEAD,
        head,
        newHead
      )

      if (result === head) {
        // CAS succeeded - we own this node now

        // Zero the node (except SEQ which we preserve)
        this.zeroNode(headOffset)

        // Update counters atomically
        // RFC-045: NODE_COUNT is now incremented by executeInsert (when node is linked)
        Atomics.sub(this.sab, HDR.FREE_COUNT, 1)

        return ptr
      }

      // CAS failed - another thread modified the head, retry
      // This is expected in concurrent scenarios
    }
  }

  /**
   * Return a node to the free list.
   *
   * Uses 64-bit tagged pointer CAS to eliminate ABA problem.
   * Version counter is incremented on every free operation.
   */
  free(ptr: NodePtr): void {
    if (ptr === NULL_PTR) {
      return // Ignore null frees
    }

    if (!this.isValidPtr(ptr)) {
      console.error('[FreeList] Attempt to free invalid pointer:', ptr)
      return
    }

    const offset = this.nodeOffset(ptr)

    // Increment SEQ counter to invalidate any stale references (for versioned reads)
    // SEQ is in upper 24 bits of SEQ_FLAGS
    Atomics.add(this.sab, offset + NODE.SEQ_FLAGS, 1 << SEQ.SEQ_SHIFT)

    // CAS loop to push onto free list head
    while (true) {
      // Load current 64-bit tagged head
      const head = Atomics.load(this.sab64, HDR_I64.FREE_LIST_HEAD)

      // Extract pointer from lower 32 bits
      const headPtr = Number(head & 0xFFFFFFFFn)

      // Store current head ptr as our next pointer (using PACKED_A slot)
      Atomics.store(this.sab, offset + NODE.PACKED_A, headPtr)

      // Extract version and increment
      const version = head >> 32n
      const newVersion = version + 1n

      // Construct new tagged head: (newVersion << 32) | ptr
      const newHead = (newVersion << 32n) | BigInt(ptr)

      // CAS: try to become the new head
      const result = Atomics.compareExchange(
        this.sab64,
        HDR_I64.FREE_LIST_HEAD,
        head,
        newHead
      )

      if (result === head) {
        // CAS succeeded - node is now on the free list

        // Update counters atomically
        // RFC-045: NODE_COUNT is now decremented by executeDelete (when node is unlinked)
        Atomics.add(this.sab, HDR.FREE_COUNT, 1)

        return
      }

      // CAS failed - another thread modified the head, retry
    }
  }

  /**
   * Get the current count of free nodes.
   */
  getFreeCount(): number {
    return Atomics.load(this.sab, HDR.FREE_COUNT)
  }

  /**
   * Get the current count of allocated nodes.
   */
  getNodeCount(): number {
    return Atomics.load(this.sab, HDR.NODE_COUNT)
  }

  /**
   * Check if the free list is empty.
   */
  isEmpty(): boolean {
    const head = Atomics.load(this.sab64, HDR_I64.FREE_LIST_HEAD)
    const ptr = Number(head & 0xFFFFFFFFn)
    return ptr === NULL_PTR
  }

  /**
   * Initialize the free list with all nodes.
   * Called once during SAB initialization.
   *
   * Links all nodes in the heap into a free list chain.
   * Initializes FREE_LIST_HEAD as 64-bit tagged pointer with version 0.
   */
  /**
   * Initialize the free list with Zone A nodes only (RFC-044).
   *
   * @param sab - Int32Array view of SharedArrayBuffer
   * @param sab64 - BigInt64Array view for atomic 64-bit operations
   * @param zoneASize - Number of nodes in Zone A (Worker-owned)
   * @param totalCapacity - Total node capacity of heap (Zone A + Zone B)
   *
   * @remarks
   * RFC-044 partitions the heap into Zone A (Worker) and Zone B (Main Thread).
   * The free list only contains Zone A nodes. Zone B nodes are managed by LocalAllocator.
   */
  static initialize(
    sab: Int32Array,
    sab64: BigInt64Array,
    zoneASize: number,
    totalCapacity: number
  ): void {
    const heapStartI32 = HEAP_START_OFFSET / 4

    // Link Zone A nodes into free list: node[i].PACKED_A = ptr to node[i+1]
    // Last node points to NULL_PTR
    // Zone B nodes (from zoneASize to totalCapacity - 1) are left uninitialized
    for (let i = 0; i < zoneASize; i++) {
      const offset = heapStartI32 + i * NODE_SIZE_I32
      const ptr = offset * 4 // Convert i32 index to byte pointer

      // Initialize SEQ_FLAGS with initial sequence number 0
      sab[offset + NODE.SEQ_FLAGS] = 0

      if (i < zoneASize - 1) {
        // Point to next node in Zone A
        const nextOffset = heapStartI32 + (i + 1) * NODE_SIZE_I32
        const nextPtr = nextOffset * 4
        sab[offset + NODE.PACKED_A] = nextPtr
      } else {
        // Last Zone A node points to null
        sab[offset + NODE.PACKED_A] = NULL_PTR
      }

      // Zero out other fields
      sab[offset + NODE.BASE_TICK] = 0
      sab[offset + NODE.DURATION] = 0
      sab[offset + NODE.NEXT_PTR] = NULL_PTR
      sab[offset + NODE.PREV_PTR] = NULL_PTR
      sab[offset + NODE.SOURCE_ID] = 0
      sab[offset + NODE.LAST_PASS_ID] = 0
    }

    // Set header pointers
    const firstNodePtr = heapStartI32 * 4

    // Initialize 64-bit tagged FREE_LIST_HEAD: version 0, pointer to first node
    // Format: (version << 32) | ptr = (0 << 32) | firstNodePtr
    sab64[HDR_I64.FREE_LIST_HEAD] = BigInt(firstNodePtr)

    sab[HDR.HEAD_PTR] = NULL_PTR // Empty chain initially
    sab[HDR.FREE_COUNT] = zoneASize // Only Zone A nodes in free list
    sab[HDR.NODE_COUNT] = 0
    sab[HDR.NODE_CAPACITY] = totalCapacity // Total capacity (Zone A + Zone B)
    sab[HDR.HEAP_START] = HEAP_START_OFFSET
  }
}
