// =============================================================================
// SymphonyScript - Local Allocator (RFC-044)
// =============================================================================
// Zone B bump-pointer allocator for Main Thread lock-free allocation.

import { HEAP_START_OFFSET, NODE_SIZE_BYTES, getZoneSplitIndex, ALLOC_ERR } from './constants'

/**
 * Local Allocator for Zone B (UI-Owned Heap).
 *
 * This allocator provides lock-free allocation for the Main Thread by using
 * a simple bump-pointer strategy within the upper half of the node heap.
 *
 * **Architecture (RFC-044):**
 * - **Zone A (0 to splitIndex - 1):** Worker/Audio Thread uses CAS-based free list
 * - **Zone B (splitIndex to capacity - 1):** Main Thread uses this bump allocator
 *
 * **Safety:**
 * - No atomic operations required (single-threaded access)
 * - No contention with Worker's allocator (disjoint memory regions)
 * - Crash if exhausted (no reclamation in MVP)
 *
 * @remarks
 * This is a critical component of the "Local-Write, Remote-Link" protocol.
 * Nodes allocated here are "floating" until linked by the Worker via Command Ring.
 */
export class LocalAllocator {
  private readonly sab: Int32Array
  private nextPtr: number // Byte offset to next free node
  private readonly limitPtr: number // Byte offset to end of heap
  private readonly startPtr: number // Byte offset where Zone B begins (for telemetry)

  /**
   * Create a Local Allocator for Zone B.
   *
   * @param sab - SharedArrayBuffer as Int32Array view
   * @param nodeCapacity - Total node capacity of the heap
   */
  constructor(sab: Int32Array, nodeCapacity: number) {
    this.sab = sab

    // Calculate Zone B boundaries
    const zoneSplitIndex = getZoneSplitIndex(nodeCapacity)
    const zoneBStartOffset = HEAP_START_OFFSET + zoneSplitIndex * NODE_SIZE_BYTES
    const heapEndOffset = HEAP_START_OFFSET + nodeCapacity * NODE_SIZE_BYTES

    this.startPtr = zoneBStartOffset
    this.nextPtr = zoneBStartOffset
    this.limitPtr = heapEndOffset
  }

  /**
   * Allocate a node from Zone B (bump pointer).
   *
   * RFC-045-04: Zero-allocation error handling via return codes.
   *
   * @returns Byte offset to the allocated node on success, or ALLOC_ERR.EXHAUSTED (-1) if Zone B is exhausted
   *
   * @remarks
   * This is an O(1) operation with zero contention. No atomic operations required.
   * The allocated node is "floating" (not in the linked list) until the Worker
   * processes the corresponding INSERT command from the Ring Buffer.
   */
  alloc(): number {
    if (this.nextPtr >= this.limitPtr) {
      return ALLOC_ERR.EXHAUSTED
    }

    const ptr = this.nextPtr
    this.nextPtr = this.nextPtr + NODE_SIZE_BYTES
    return ptr
  }

  /**
   * Get the number of remaining free nodes in Zone B.
   *
   * @returns Number of nodes that can still be allocated
   */
  getFreeCount(): number {
    const remainingBytes = this.limitPtr - this.nextPtr
    return Math.floor(remainingBytes / NODE_SIZE_BYTES)
  }

  /**
   * Get Zone B utilization (RFC-044 Telemetry).
   *
   * @returns Utilization ratio from 0.0 (empty) to 1.0 (full)
   *
   * @remarks
   * **Fuel Gauge:** Monitor this to detect approaching Zone B exhaustion.
   * - < 0.5: Healthy
   * - 0.5 - 0.75: Monitor
   * - 0.75 - 0.9: Warning
   * - > 0.9: Critical (consider hardReset or defragmentation)
   */
  getUtilization(): number {
    const used = this.nextPtr - this.startPtr
    const total = this.limitPtr - this.startPtr
    return total === 0 ? 0 : used / total
  }

  /**
   * Reset the allocator (for testing/defragmentation).
   *
   * @remarks
   * DANGER: Only call this when you know the Worker has no references to Zone B nodes.
   * Typically only used during initialization or after full GC/defrag cycle.
   */
  reset(nodeCapacity: number): void {
    const zoneSplitIndex = getZoneSplitIndex(nodeCapacity)
    const zoneBStartOffset = HEAP_START_OFFSET + zoneSplitIndex * NODE_SIZE_BYTES
    this.nextPtr = zoneBStartOffset
  }
}
