// =============================================================================
// SymphonyScript - Synapse Allocator (RFC-045)
// =============================================================================

import {
  HDR,
  SYNAPSE,
  SYN_PACK,
  SYNAPSE_TABLE,
  NULL_PTR,
  getSynapseTableOffset,
  SYNAPSE_ERR,
  KNUTH_HASH_CONST
} from './constants'
import type { SynapsePtr } from './types'

/**
 * Synapse Allocator - The "Dendrite" Manager for the Silicon Brain.
 *
 * Manages the 1MB Synapse Table in the SharedArrayBuffer. This class implements
 * a high-performance Linear Probe Hash Table to map Axons (Source Nodes) to
 * Synapses (Connections).
 *
 * Topology:
 * - Table Size: 65,536 entries (1MB)
 * - Hash: Knuth's Multiplicative Hash on SOURCE_PTR
 * - Collision Strategy: Linear Probing for "Head" slots
 * - Fan-Out: Linked List (NEXT_SYNAPSE_PTR) for multiple targets from one source
 *
 * Thread Safety:
 * - Designed for single-writer (Worker/Kernel) access via Command Ring.
 * - Uses Atomics for all writes to ensure the Audio Thread never sees torn data.
 */
export class SynapseAllocator {
  private readonly sab: Int32Array
  private readonly tableOffsetI32: number
  private readonly capacity: number

  /** Tracks number of used slots for load factor monitoring (RFC-045-02 directive) */
  private usedSlots: number = 0

  constructor(buffer: SharedArrayBuffer) {
    this.sab = new Int32Array(buffer)

    // Calculate table offset dynamically based on layout
    const nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    const byteOffset = getSynapseTableOffset(nodeCapacity)
    this.tableOffsetI32 = byteOffset / 4

    // Capacity is fixed by RFC-045 at 65536
    this.capacity = SYNAPSE_TABLE.MAX_CAPACITY
  }

  /**
   * Get the current load factor of the Synapse Table.
   * @returns Load factor as a ratio (0.0 to 1.0)
   */
  getLoadFactor(): number {
    return this.usedSlots / this.capacity
  }

  /**
   * Get the number of used slots in the Synapse Table.
   * @returns Number of slots currently in use
   */
  getUsedSlots(): number {
    return this.usedSlots
  }

  /**
   * Reset allocator state after table clear.
   *
   * **Note:** Actual memory clearing is done by SiliconSynapse.synapseTableClear().
   * This method resets the allocator's internal tracking counters.
   */
  clear(): void {
    this.usedSlots = 0
  }

  /**
   * Create a synaptic connection between two Axons.
   *
   * This is an O(1) operation (amortized) that writes a "Dendrite" into the
   * shared memory. If the source already has connections, this appends to
   * the fan-out chain.
   *
   * Thread Safety (RFC-045-02 CORRECTION-01):
   * For append operations, data writes MUST complete before linking to prevent
   * the Audio Thread from following a valid link to uninitialized memory.
   *
   * RFC-045-04: Zero-allocation error handling via return codes.
   *
   * @param sourcePtr - The Trigger Node (End of Clip)
   * @param targetPtr - The Destination Node (Start of Next Clip)
   * @param weight - Probability/Intensity (0-1000)
   * @param jitter - Micro-timing deviation in ticks (0-65535)
   * @returns The SynapsePtr to the new entry on success, or negative error code
   */
  connect(sourcePtr: number, targetPtr: number, weight: number, jitter: number): SynapsePtr {
    if (sourcePtr === NULL_PTR || targetPtr === NULL_PTR) {
      return SYNAPSE_ERR.INVALID_PTR
    }

    // 1. Pack data values according to SYN_PACK
    // WEIGHT_DATA: [Jitter (16b) | Weight (16b)]
    const weightData =
      ((weight & SYN_PACK.WEIGHT_MASK) << SYN_PACK.WEIGHT_SHIFT) |
      ((jitter & SYN_PACK.JITTER_MASK) << SYN_PACK.JITTER_SHIFT)

    // 2. Find the "Head" slot for this Source ID
    const headSlot = this.findHeadSlot(sourcePtr)
    let entrySlot = -1
    let tailSlot = -1
    let tailOffset = -1

    if (headSlot === -1) {
      // No existing chain for this source. Find a fresh empty slot.
      // We start probing from the ideal hash location.
      const idealSlot = this.hash(sourcePtr)
      entrySlot = this.findEmptySlot(idealSlot)

      if (entrySlot === -1) {
        return SYNAPSE_ERR.TABLE_FULL
      }
    } else {
      // Existing chain found. We need to append to the end.
      // First, find a fresh empty slot anywhere for the new link.
      // We probe starting from the head slot to keep chains somewhat local.
      entrySlot = this.findEmptySlot(headSlot + 1)

      if (entrySlot === -1) {
        return SYNAPSE_ERR.TABLE_FULL
      }

      // Walk to the tail of the existing chain
      tailSlot = headSlot
      let nextPtr = this.getNextPtr(tailSlot)

      // Safety: Max iterations to prevent infinite loops (though chains shouldn't loop)
      let ops = 0
      while (nextPtr !== NULL_PTR) {
        tailSlot = this.slotFromPtr(nextPtr)
        nextPtr = this.getNextPtr(tailSlot)

        ops = ops + 1
        if (ops > 1000) {
          return SYNAPSE_ERR.CHAIN_LOOP
        }
      }

      tailOffset = this.offsetForSlot(tailSlot)
    }

    // 3. Write the Synapse Data FIRST (CORRECTION-01: data before linking)
    // This ensures the Audio Thread never follows a link to uninitialized memory.
    const entryOffset = this.offsetForSlot(entrySlot)

    // Write all entry data atomically before it becomes reachable
    Atomics.store(this.sab, entryOffset + SYNAPSE.TARGET_PTR, targetPtr)
    Atomics.store(this.sab, entryOffset + SYNAPSE.WEIGHT_DATA, weightData)
    Atomics.store(this.sab, entryOffset + SYNAPSE.META_NEXT, 0)
    Atomics.store(this.sab, entryOffset + SYNAPSE.SOURCE_PTR, sourcePtr)

    // 4. NOW link the entry (AFTER data is fully written)
    if (tailSlot !== -1) {
      // Append case: Link tail -> new entry
      const entryPtr = this.ptrFromSlot(entrySlot)

      // Read-modify-write to preserve plasticity flags
      // Note: Single-writer model via Command Ring ensures no concurrent plasticity updates
      const currentMeta = Atomics.load(this.sab, tailOffset + SYNAPSE.META_NEXT)
      const plasticity = currentMeta & SYN_PACK.PLASTICITY_MASK

      // Pack: [NextPtr (24b) | Plasticity (8b)]
      const newMeta = plasticity | ((entryPtr & SYN_PACK.NEXT_PTR_MASK) << SYN_PACK.NEXT_PTR_SHIFT)

      // CRITICAL: This atomic store makes the new entry visible to readers
      Atomics.store(this.sab, tailOffset + SYNAPSE.META_NEXT, newMeta)
    }
    // For new head case: Entry is already discoverable via SOURCE_PTR set above

    // 5. Track slot usage (CORRECTION-02)
    this.usedSlots = this.usedSlots + 1

    return this.ptrFromSlot(entrySlot)
  }

  /**
   * Sever a synaptic connection.
   *
   * Implements "Tombstoning" by setting TARGET_PTR to NULL. The connection
   * remains in the chain but is skipped by the Kernel during resolution.
   * This preserves the linked list integrity for other targets.
   *
   * @param sourcePtr - The Trigger Node
   * @param targetPtr - (Optional) Specific target to disconnect. If omitted, disconnects ALL.
   */
  disconnect(sourcePtr: number, targetPtr?: number): void {
    const headSlot = this.findHeadSlot(sourcePtr)
    if (headSlot === -1) return // Not found

    let currentSlot = headSlot
    let ops = 0

    while (currentSlot !== -1) {
      const offset = this.offsetForSlot(currentSlot)

      // Check if this is the target (or if we are wiping all)
      const currentTarget = Atomics.load(this.sab, offset + SYNAPSE.TARGET_PTR)

      if (targetPtr === undefined || currentTarget === targetPtr) {
        // Tombstone it: Set TARGET to NULL
        Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, NULL_PTR)

        // If we are disconnecting a specific target, we can stop if we assume no duplicates.
        // But to be safe (and support 'all'), we continue if targetPtr is undefined.
        if (targetPtr !== undefined) return
      }

      // Move to next
      const nextPtr = this.getNextPtr(currentSlot)
      currentSlot = nextPtr === NULL_PTR ? -1 : this.slotFromPtr(nextPtr)

      ops = ops + 1
      if (ops > 1000) break // Safety
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /** Knuth's Multiplicative Hash (using KNUTH_HASH_CONST per RFC-045) */
  private hash(key: number): number {
    // Unsigned right shift to ensure non-negative integer result
    return (Math.imul(key, KNUTH_HASH_CONST) >>> 0) % this.capacity
  }

  /**
   * Find the slot containing the "Head" of the chain for a source.
   * Uses Linear Probing.
   * * @returns Slot index, or -1 if not found.
   */
  private findHeadSlot(sourcePtr: number): number {
    let slot = this.hash(sourcePtr)
    let probes = 0

    while (probes < this.capacity) {
      const offset = this.offsetForSlot(slot)
      const storedSource = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)

      if (storedSource === sourcePtr) {
        return slot // Found match
      }

      if (storedSource === NULL_PTR) {
        return -1 // Hit empty slot, entry does not exist
      }

      // Collision (different source), linear probe
      slot = (slot + 1) % this.capacity
      probes = probes + 1
    }

    return -1 // Table full/scanned completely
  }

  /**
   * Find the next empty slot starting from a seed index.
   * Used for allocating new entries (heads or overflow links).
   */
  private findEmptySlot(startSlot: number): number {
    let slot = startSlot % this.capacity
    let probes = 0

    while (probes < this.capacity) {
      const offset = this.offsetForSlot(slot)
      const source = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)

      if (source === NULL_PTR) {
        return slot
      }

      slot = (slot + 1) % this.capacity
      probes = probes + 1
    }

    return -1
  }

  /** Convert slot index to i32 index in SAB */
  private offsetForSlot(slot: number): number {
    return this.tableOffsetI32 + (slot * SYNAPSE_TABLE.STRIDE_I32)
  }

  /** Convert slot index to Byte Pointer (relative to start of SAB) */
  private ptrFromSlot(slot: number): number {
    return (this.tableOffsetI32 * 4) + (slot * SYNAPSE_TABLE.STRIDE_BYTES)
  }

  /** Convert Byte Pointer to slot index */
  private slotFromPtr(ptr: number): number {
    const tableStart = this.tableOffsetI32 * 4
    return (ptr - tableStart) / SYNAPSE_TABLE.STRIDE_BYTES
  }

  /** Extract Next Pointer from a slot's META_NEXT field */
  private getNextPtr(slot: number): number {
    const offset = this.offsetForSlot(slot)
    const meta = Atomics.load(this.sab, offset + SYNAPSE.META_NEXT)
    return (meta >>> SYN_PACK.NEXT_PTR_SHIFT) & SYN_PACK.NEXT_PTR_MASK
  }
}
