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
  KNUTH_HASH_CONST,
  REVERSE_INDEX,
  getReverseIndexOffset,
  ERROR
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
  private readonly reverseIndexI32: number
  private readonly capacity: number

  /** Tracks number of used slots for load factor monitoring (RFC-045-02 directive) */
  private usedSlots: number = 0

  /** Tracks number of tombstoned entries (ISSUE-021) */
  private tombstoneCount: number = 0

  /** Pre-allocated staging array for compaction - source pointers (ISSUE-021) */
  private readonly stagingSourcePtrs: Int32Array

  /** Pre-allocated staging array for compaction - target pointers (ISSUE-021) */
  private readonly stagingTargetPtrs: Int32Array

  /** Pre-allocated staging array for compaction - weight data (ISSUE-021) */
  private readonly stagingWeightData: Int32Array

  constructor(buffer: SharedArrayBuffer) {
    this.sab = new Int32Array(buffer)

    // Calculate table offset dynamically based on layout
    const nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    const byteOffset = getSynapseTableOffset(nodeCapacity)
    this.tableOffsetI32 = byteOffset / 4

    // Calculate reverse index offset (ISSUE-016)
    const reverseByteOffset = getReverseIndexOffset(nodeCapacity)
    this.reverseIndexI32 = reverseByteOffset / 4

    // Capacity is fixed by RFC-045 at 65536
    this.capacity = SYNAPSE_TABLE.MAX_CAPACITY

    // Pre-allocate staging arrays for compaction (ISSUE-021)
    // Init-time allocation is acceptable per RFC-045-04
    this.stagingSourcePtrs = new Int32Array(SYNAPSE_TABLE.MAX_CAPACITY)
    this.stagingTargetPtrs = new Int32Array(SYNAPSE_TABLE.MAX_CAPACITY)
    this.stagingWeightData = new Int32Array(SYNAPSE_TABLE.MAX_CAPACITY)
  }

  /**
   * Get the current load factor of the Synapse Table.
   * Accounts for tombstoned entries to reflect actual usage.
   * @returns Load factor as a ratio (0.0 to 1.0)
   */
  getLoadFactor(): number {
    return (this.usedSlots - this.tombstoneCount) / this.capacity
  }

  /**
   * Get the number of used slots in the Synapse Table (including tombstones).
   * @returns Number of slots currently in use
   */
  getUsedSlots(): number {
    return this.usedSlots
  }

  /**
   * Get the number of active (non-tombstoned) slots.
   * @returns Number of live synapse entries
   */
  getActiveSlots(): number {
    return this.usedSlots - this.tombstoneCount
  }

  /**
   * Get the ratio of tombstoned entries to total used slots.
   * High ratio (>0.5) indicates table should be compacted.
   * @returns Tombstone ratio (0.0 to 1.0)
   */
  getTombstoneRatio(): number {
    if (this.usedSlots === 0) return 0
    return this.tombstoneCount / this.usedSlots
  }

  /**
   * Reset allocator state after table clear.
   *
   * **Note:** Actual memory clearing is done by SiliconSynapse.synapseTableClear().
   * This method resets the allocator's internal tracking counters.
   */
  clear(): void {
    this.usedSlots = 0
    this.tombstoneCount = 0
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

    // 3b. Insert into Reverse Index linked list (ISSUE-016)
    // Hash targetPtr to find bucket, prepend to linked list
    const bucketIdx = ((targetPtr * KNUTH_HASH_CONST) >>> 0) & REVERSE_INDEX.BUCKET_MASK
    const bucketOffset = this.reverseIndexI32 + bucketIdx

    // Read current head, store as our next
    const currentHead = Atomics.load(this.sab, bucketOffset)
    Atomics.store(this.sab, entryOffset + SYNAPSE.NEXT_SAME_TARGET, currentHead)

    // Update bucket head to point to us (slot index, not byte ptr)
    Atomics.store(this.sab, bucketOffset, entrySlot)

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

      // Only tombstone if not already tombstoned (ISSUE-021)
      if (currentTarget !== NULL_PTR && (targetPtr === undefined || currentTarget === targetPtr)) {
        // Tombstone it: Set TARGET to NULL
        Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, NULL_PTR)
        this.tombstoneCount = this.tombstoneCount + 1

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
  // Compaction (ISSUE-021)
  // ===========================================================================

  /**
   * Check if compaction is needed and perform if so.
   * COLD PATH - Called after disconnect operations.
   *
   * @returns Number of entries compacted (0 if no compaction needed)
   */
  maybeCompact(): number {
    // Skip if below minimum threshold
    if (this.usedSlots < SYNAPSE_TABLE.COMPACTION_MIN_SLOTS) {
      return 0
    }

    // Skip if tombstone ratio below threshold
    if (this.getTombstoneRatio() < SYNAPSE_TABLE.COMPACTION_THRESHOLD) {
      return 0
    }

    return this.compactTable()
  }

  /**
   * Compact the synapse table by rehashing all live entries.
   * COLD PATH - O(n) where n = table capacity.
   *
   * **Thread Safety:** Must NOT be called while audio thread is active.
   * Caller must ensure exclusive access (e.g., during pause or clear).
   *
   * **Algorithm:**
   * 1. Scan table for live entries (SOURCE_PTR != NULL && TARGET_PTR != NULL)
   * 2. Collect live entries into staging arrays
   * 3. Clear entire table
   * 4. Clear reverse index buckets
   * 5. Reinsert live entries with fresh hash positions
   *
   * @returns Number of entries compacted
   */
  compactTable(): number {
    // Phase 1: Scan and collect live entries to staging
    let liveCount = 0
    let scanSlot = 0

    while (scanSlot < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = this.tableOffsetI32 + scanSlot * SYNAPSE_TABLE.STRIDE_I32

      const sourcePtr = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)
      const targetPtr = Atomics.load(this.sab, offset + SYNAPSE.TARGET_PTR)

      // Live entry: both pointers non-null
      if (sourcePtr !== NULL_PTR && targetPtr !== NULL_PTR) {
        const weightData = Atomics.load(this.sab, offset + SYNAPSE.WEIGHT_DATA)

        this.stagingSourcePtrs[liveCount] = sourcePtr
        this.stagingTargetPtrs[liveCount] = targetPtr
        this.stagingWeightData[liveCount] = weightData
        liveCount = liveCount + 1
      }

      scanSlot = scanSlot + 1
    }

    // Phase 2: Clear entire table
    let clearSlot = 0
    while (clearSlot < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = this.tableOffsetI32 + clearSlot * SYNAPSE_TABLE.STRIDE_I32
      Atomics.store(this.sab, offset + SYNAPSE.SOURCE_PTR, NULL_PTR)
      Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, NULL_PTR)
      Atomics.store(this.sab, offset + SYNAPSE.WEIGHT_DATA, 0)
      Atomics.store(this.sab, offset + SYNAPSE.META_NEXT, 0)
      Atomics.store(this.sab, offset + SYNAPSE.NEXT_SAME_TARGET, REVERSE_INDEX.EMPTY)
      clearSlot = clearSlot + 1
    }

    // Phase 3: Clear reverse index buckets
    let bucket = 0
    while (bucket < REVERSE_INDEX.BUCKET_COUNT) {
      Atomics.store(this.sab, this.reverseIndexI32 + bucket, REVERSE_INDEX.EMPTY)
      bucket = bucket + 1
    }

    // Phase 4: Reinsert live entries with fresh hash positions
    this.usedSlots = 0
    this.tombstoneCount = 0

    let reinsertIdx = 0
    while (reinsertIdx < liveCount) {
      this._insertDirect(
        this.stagingSourcePtrs[reinsertIdx],
        this.stagingTargetPtrs[reinsertIdx],
        this.stagingWeightData[reinsertIdx]
      )
      reinsertIdx = reinsertIdx + 1
    }

    return liveCount
  }

  /**
   * Direct insertion during compaction (bypasses validation).
   * @internal
   */
  private _insertDirect(sourcePtr: number, targetPtr: number, weightData: number): void {
    // Find empty slot using linear probing from hash position
    const idealSlot = this.hash(sourcePtr)
    let slot = idealSlot
    let probes = 0

    while (probes < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = this.tableOffsetI32 + slot * SYNAPSE_TABLE.STRIDE_I32
      const existing = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)

      if (existing === NULL_PTR) {
        // Found empty slot - write entry
        Atomics.store(this.sab, offset + SYNAPSE.SOURCE_PTR, sourcePtr)
        Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, targetPtr)
        Atomics.store(this.sab, offset + SYNAPSE.WEIGHT_DATA, weightData)
        Atomics.store(this.sab, offset + SYNAPSE.META_NEXT, 0)

        // Update reverse index
        const bucketIdx = ((targetPtr * KNUTH_HASH_CONST) >>> 0) & REVERSE_INDEX.BUCKET_MASK
        const bucketOffset = this.reverseIndexI32 + bucketIdx
        const currentHead = Atomics.load(this.sab, bucketOffset)
        Atomics.store(this.sab, offset + SYNAPSE.NEXT_SAME_TARGET, currentHead)
        Atomics.store(this.sab, bucketOffset, slot)

        this.usedSlots = this.usedSlots + 1
        return
      }

      slot = (slot + 1) % SYNAPSE_TABLE.MAX_CAPACITY
      probes = probes + 1
    }

    // Should never happen during compaction (we cleared first)
    Atomics.store(this.sab, HDR.ERROR_FLAG, ERROR.KERNEL_PANIC)
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
