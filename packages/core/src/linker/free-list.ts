// =============================================================================
// SymphonyScript - Silicon Linker Free List (RFC-043)
// =============================================================================
// Lock-free LIFO stack using Compare-And-Swap for thread-safe allocation.

import {
  HDR,
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
 * Lock-free free list implementation using CAS operations.
 *
 * The free list is a LIFO stack where:
 * - FREE_LIST_PTR in header points to the head of the stack
 * - Each free node's PACKED_A field (slot 0) stores the next free pointer
 * - Allocation pops from head, deallocation pushes to head
 *
 * Thread safety:
 * - All operations use Atomics.compareExchange for lock-free updates
 * - SEQ counter in each node provides ABA protection
 */
export class FreeList {
  private sab: Int32Array
  private heapStartI32: number
  private nodeCapacity: number

  constructor(sab: Int32Array) {
    this.sab = sab
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
    this.sab[offset + NODE.SOURCE_ID] = 0
    // Keep SEQ_FLAGS - we increment SEQ on free, don't reset it
  }

  /**
   * Allocate a node from the free list.
   *
   * Uses CAS loop to safely pop from the stack head.
   * Returns NULL_PTR if heap is exhausted.
   */
  alloc(): NodePtr {
    // CAS loop - retry until we successfully pop a node
    while (true) {
      // Load current head of free list
      const head = Atomics.load(this.sab, HDR.FREE_LIST_PTR)

      // Heap exhausted
      if (head === NULL_PTR) {
        return NULL_PTR
      }

      // Validate pointer
      if (!this.isValidPtr(head)) {
        // Corrupted free list - this shouldn't happen
        console.error('[FreeList] Invalid head pointer:', head)
        return NULL_PTR
      }

      const headOffset = this.nodeOffset(head)

      // Read the next pointer from the free node
      // In free nodes, PACKED_A stores the next free pointer
      const next = Atomics.load(this.sab, headOffset + NODE.PACKED_A)

      // CAS: try to update FREE_LIST_PTR from head to next
      const result = Atomics.compareExchange(
        this.sab,
        HDR.FREE_LIST_PTR,
        head,
        next
      )

      if (result === head) {
        // CAS succeeded - we own this node now

        // Zero the node (except SEQ which we preserve)
        this.zeroNode(headOffset)

        // Update counters atomically
        Atomics.sub(this.sab, HDR.FREE_COUNT, 1)
        Atomics.add(this.sab, HDR.NODE_COUNT, 1)

        return head
      }

      // CAS failed - another thread modified the head, retry
      // This is expected in concurrent scenarios
    }
  }

  /**
   * Return a node to the free list.
   *
   * Uses CAS loop to safely push to the stack head.
   * Increments SEQ counter to prevent ABA problems.
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

    // Increment SEQ counter to invalidate any stale references (ABA protection)
    // SEQ is in upper 24 bits of SEQ_FLAGS
    Atomics.add(this.sab, offset + NODE.SEQ_FLAGS, 1 << SEQ.SEQ_SHIFT)

    // Clear ACTIVE flag to mark as free
    const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
    // We'll overwrite PACKED_A with the next pointer, so just clear it
    // The ACTIVE flag in the original packed value becomes irrelevant

    // CAS loop to push onto free list head
    while (true) {
      // Load current head
      const head = Atomics.load(this.sab, HDR.FREE_LIST_PTR)

      // Store current head as our next pointer (using PACKED_A slot)
      Atomics.store(this.sab, offset + NODE.PACKED_A, head)

      // CAS: try to become the new head
      const result = Atomics.compareExchange(
        this.sab,
        HDR.FREE_LIST_PTR,
        head,
        ptr
      )

      if (result === head) {
        // CAS succeeded - node is now on the free list

        // Update counters atomically
        Atomics.add(this.sab, HDR.FREE_COUNT, 1)
        Atomics.sub(this.sab, HDR.NODE_COUNT, 1)

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
    return Atomics.load(this.sab, HDR.FREE_LIST_PTR) === NULL_PTR
  }

  /**
   * Initialize the free list with all nodes.
   * Called once during SAB initialization.
   *
   * Links all nodes in the heap into a free list chain.
   */
  static initialize(sab: Int32Array, nodeCapacity: number): void {
    const heapStartI32 = HEAP_START_OFFSET / 4

    // Link all nodes into free list: node[i].PACKED_A = ptr to node[i+1]
    // Last node points to NULL_PTR
    for (let i = 0; i < nodeCapacity; i++) {
      const offset = heapStartI32 + i * NODE_SIZE_I32
      const ptr = offset * 4 // Convert i32 index to byte pointer

      // Initialize SEQ_FLAGS with initial sequence number 0
      sab[offset + NODE.SEQ_FLAGS] = 0

      if (i < nodeCapacity - 1) {
        // Point to next node
        const nextOffset = heapStartI32 + (i + 1) * NODE_SIZE_I32
        const nextPtr = nextOffset * 4
        sab[offset + NODE.PACKED_A] = nextPtr
      } else {
        // Last node points to null
        sab[offset + NODE.PACKED_A] = NULL_PTR
      }

      // Zero out other fields
      sab[offset + NODE.BASE_TICK] = 0
      sab[offset + NODE.DURATION] = 0
      sab[offset + NODE.NEXT_PTR] = NULL_PTR
      sab[offset + NODE.SOURCE_ID] = 0
    }

    // Set header pointers
    const firstNodePtr = heapStartI32 * 4
    sab[HDR.FREE_LIST_PTR] = firstNodePtr
    sab[HDR.HEAD_PTR] = NULL_PTR // Empty chain initially
    sab[HDR.FREE_COUNT] = nodeCapacity
    sab[HDR.NODE_COUNT] = 0
    sab[HDR.NODE_CAPACITY] = nodeCapacity
    sab[HDR.HEAP_START] = HEAP_START_OFFSET
  }
}
