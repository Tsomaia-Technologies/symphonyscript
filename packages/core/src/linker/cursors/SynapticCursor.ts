// =============================================================================
// SymphonyScript - SynapticCursor (RFC-045 Directive 03)
// =============================================================================
// Playback cursor with neural branching support for the Silicon Brain.
// Extends playback engine to resolve synaptic connections when chains end.

import {
  SYNAPSE,
  SYN_PACK,
  SYNAPSE_TABLE,
  SYNAPSE_QUOTA,
  NULL_PTR,
  getSynapseTableOffset,
  HDR,
  KNUTH_HASH_CONST
} from '../constants'
import type { PlasticityCallback, SynapseResolutionCallback } from '../types'

// RFC-045-04: Error indicator for collectCandidates
const CURSOR_ERR_CHAIN_LOOP = -1

// =============================================================================
// Types
// =============================================================================

// ISSUE-024: SynapseResolutionResult DELETED - use SynapseResolutionCallback instead
// RFC-045-04: SynapseCandidate interface removed - using SoA TypedArrays instead

// =============================================================================
// SynapticCursor
// =============================================================================

/**
 * Playback cursor with neural branching support (RFC-045).
 *
 * The SynapticCursor extends the playback engine to support the "Silicon Brain"
 * neural topology. When a playback cursor reaches the end of a clip chain
 * (`NEXT_PTR == NULL_PTR`), it performs **Synaptic Resolution** to determine
 * the next target.
 *
 * Key Responsibilities:
 * - Hash-based synapse table lookup (O(1))
 * - Stochastic selection among multiple candidates
 * - Jitter application for humanization
 * - Quota enforcement to prevent infinite loops
 *
 * Thread Safety:
 * - Designed for Audio Thread (read-only access to Synapse Table)
 * - Uses Atomics for all SAB reads
 * - Zero-allocation hot path
 */
export class SynapticCursor {
  private readonly sab: Int32Array
  private readonly synapseTableOffsetI32: number
  private readonly capacity: number

  /** Current position in the node chain (byte pointer) */
  private currentPtr: number = NULL_PTR

  /** Pending jitter ticks to wait before starting next clip */
  private pendingJitter: number = 0

  /** Counter for synapses fired this block (quota enforcement) */
  private synapsesFiredThisBlock: number = 0

  // RFC-045-04: SoA (Struct of Arrays) for zero-allocation candidate storage
  /** Pre-allocated candidate targetPtr array (max 64 candidates) */
  private readonly candTargetPtrs: Int32Array
  /** Pre-allocated candidate weight array */
  private readonly candWeights: Int32Array
  /** Pre-allocated candidate jitter array */
  private readonly candJitters: Int32Array
  /** Pre-allocated candidate synapsePtr array */
  private readonly candSynapsePtrs: Int32Array

  // ISSUE-024: _result DELETED - use resolveSynapseWithCallback() instead

  /** PRNG state for deterministic stochastic selection */
  private prngState: number

  /** RFC-045-03: Plasticity callback for automatic reward distribution */
  private plasticityCallback: PlasticityCallback | null = null

  constructor(buffer: SharedArrayBuffer, initialPtr: number = NULL_PTR, prngSeed: number = 12345) {
    this.sab = new Int32Array(buffer)

    // Calculate synapse table offset dynamically based on layout
    const nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    const byteOffset = getSynapseTableOffset(nodeCapacity)
    this.synapseTableOffsetI32 = byteOffset / 4

    // Capacity is fixed by RFC-045 at 65536
    this.capacity = SYNAPSE_TABLE.MAX_CAPACITY

    // Initialize cursor position
    this.currentPtr = initialPtr

    // Initialize PRNG state (xorshift32 has fixpoint at 0 - ensure non-zero seed)
    this.prngState = (prngSeed >>> 0) || 1

    // RFC-045-04: Pre-allocate SoA candidate arrays (max 64 per RFC-045 quota)
    this.candTargetPtrs = new Int32Array(SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK)
    this.candWeights = new Int32Array(SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK)
    this.candJitters = new Int32Array(SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK)
    this.candSynapsePtrs = new Int32Array(SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK)
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the current node pointer.
   */
  getCurrentPtr(): number {
    return this.currentPtr
  }

  /**
   * Set the current node pointer.
   */
  setCurrentPtr(ptr: number): void {
    this.currentPtr = ptr
  }

  /**
   * Get pending jitter (ticks to wait before starting).
   */
  getPendingJitter(): number {
    return this.pendingJitter
  }

  /**
   * Consume pending jitter (call after waiting).
   */
  consumeJitter(): void {
    this.pendingJitter = 0
  }

  /**
   * Check if cursor has pending jitter to wait.
   */
  hasJitter(): boolean {
    return this.pendingJitter > 0
  }

  /**
   * Reset synapse fire counter (call at start of each audio block).
   */
  resetBlockQuota(): void {
    this.synapsesFiredThisBlock = 0
  }

  /**
   * Check if quota allows more synapse fires this block.
   */
  canFireSynapse(): boolean {
    return this.synapsesFiredThisBlock < SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK
  }

  /**
   * Set the plasticity callback for automatic reward distribution.
   *
   * RFC-045-03: Called whenever a synapse fires successfully during playback.
   * Use this to implement Hebbian learning (reward winning synapses).
   *
   * @param cb - Callback to invoke with synapsePtr, or null to disable
   */
  setPlasticityCallback(cb: PlasticityCallback | null): void {
    this.plasticityCallback = cb
  }

  // ISSUE-024: resolveSynapse() DELETED - use resolveSynapseWithCallback() instead

  /**
   * Resolve synaptic connection with zero-allocation callback (RFC-045-04).
   *
   * This is the core neural branching logic (RFC-045 Section 4.1).
   * Called when `node.NEXT_PTR == NULL_PTR` to find the next target.
   *
   * **Algorithm:**
   * 1. Quota check (abort if exceeded)
   * 2. Hash SOURCE_PTR to find synapse head slot
   * 3. Collect all candidates (follow META_NEXT chain)
   * 4. Stochastic selection (weighted random)
   * 5. Apply jitter and invoke callback
   *
   * @param sourcePtr - The source node pointer (end of current clip)
   * @param cb - Callback receiving resolution result as primitives
   * @returns true if synapse was resolved, false if cursor dies (quota/no synapse)
   */
  resolveSynapseWithCallback(
    sourcePtr: number,
    cb: SynapseResolutionCallback
  ): boolean {
    // 1. Quota Check
    if (!this.canFireSynapse()) {
      return false  // Cursor dies
    }

    // Increment quota counter
    this.synapsesFiredThisBlock = this.synapsesFiredThisBlock + 1

    // 2. Hash Lookup
    const headSlot = this.findHeadSlot(sourcePtr)
    if (headSlot === -1) {
      return false  // No synapse found
    }

    // 3. Collect Candidates
    const candidateCount = this.collectCandidates(headSlot)
    if (candidateCount <= 0) {
      return false  // All tombstones or chain loop
    }

    // 4. Stochastic Selection
    const winnerIdx = this.selectWinner(candidateCount)

    // 5. Apply Jitter and Update State
    this.pendingJitter = this.candJitters[winnerIdx]
    this.currentPtr = this.candTargetPtrs[winnerIdx]

    // RFC-045-03: Invoke plasticity callback
    if (this.plasticityCallback !== null) {
      this.plasticityCallback(this.candSynapsePtrs[winnerIdx])
    }

    // RFC-045-04: Invoke callback with primitives (zero-allocation, no aliasing risk)
    cb(
      this.candTargetPtrs[winnerIdx],
      this.candJitters[winnerIdx],
      this.candWeights[winnerIdx],
      this.candSynapsePtrs[winnerIdx]
    )

    return true
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Knuth's Multiplicative Hash (using KNUTH_HASH_CONST per RFC-045).
   */
  private hash(key: number): number {
    return (Math.imul(key, KNUTH_HASH_CONST) >>> 0) % this.capacity
  }

  /**
   * Convert slot index to i32 offset in SAB.
   */
  private offsetForSlot(slot: number): number {
    return this.synapseTableOffsetI32 + (slot * SYNAPSE_TABLE.STRIDE_I32)
  }

  /**
   * Find the head slot for a source pointer using linear probing.
   * @returns Slot index, or -1 if not found
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
   * Collect all valid candidates from a synapse chain.
   *
   * Traverses the META_NEXT linked list, skipping tombstones
   * (TARGET_PTR == NULL_PTR), and populates the pre-allocated
   * SoA candidate arrays.
   *
   * @param headSlot - Starting slot for the chain
   * @returns Number of valid candidates collected, or CURSOR_ERR_CHAIN_LOOP on error
   */
  private collectCandidates(headSlot: number): number {
    let count = 0
    let currentSlot = headSlot
    let iterations = 0

    // Safety limit to prevent infinite loops (max chain length)
    const MAX_CHAIN_LENGTH = 1000

    while (currentSlot !== -1 && count < SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK) {
      iterations = iterations + 1
      if (iterations > MAX_CHAIN_LENGTH) {
        return CURSOR_ERR_CHAIN_LOOP // RFC-045-04: Return error instead of throwing
      }

      const offset = this.offsetForSlot(currentSlot)

      // Read synapse data atomically
      const targetPtr = Atomics.load(this.sab, offset + SYNAPSE.TARGET_PTR)
      const weightData = Atomics.load(this.sab, offset + SYNAPSE.WEIGHT_DATA)
      const metaNext = Atomics.load(this.sab, offset + SYNAPSE.META_NEXT)

      // Skip tombstones (disconnected synapses)
      if (targetPtr !== NULL_PTR) {
        // Unpack weight and jitter
        const weight = (weightData >>> SYN_PACK.WEIGHT_SHIFT) & SYN_PACK.WEIGHT_MASK
        const jitter = (weightData >>> SYN_PACK.JITTER_SHIFT) & SYN_PACK.JITTER_MASK

        // RFC-045-04: Store candidate in SoA arrays (zero-allocation)
        this.candTargetPtrs[count] = targetPtr
        this.candWeights[count] = weight
        this.candJitters[count] = jitter
        this.candSynapsePtrs[count] = this.ptrFromSlot(currentSlot)
        count = count + 1
      }

      // Move to next in chain
      const nextPtr = (metaNext >>> SYN_PACK.NEXT_PTR_SHIFT) & SYN_PACK.NEXT_PTR_MASK
      if (nextPtr === NULL_PTR) {
        break // End of chain
      }

      // Convert pointer to slot
      currentSlot = this.slotFromPtr(nextPtr)
    }

    return count
  }

  /**
   * Stochastic selection among candidates (weighted random).
   *
   * Uses a deterministic PRNG for reproducible results.
   * Weights are treated as relative probabilities.
   *
   * RFC-045-04: Returns index into SoA arrays instead of object reference.
   *
   * @param candidateCount - Number of valid candidates in SoA arrays
   * @returns Index of the winning candidate
   */
  private selectWinner(candidateCount: number): number {
    // Single candidate - no randomness needed
    if (candidateCount === 1) {
      return 0
    }

    // Calculate total weight from SoA array
    let totalWeight = 0
    let i = 0
    while (i < candidateCount) {
      totalWeight = totalWeight + this.candWeights[i]
      i = i + 1
    }

    // Edge case: all weights are zero - pick first candidate
    if (totalWeight === 0) {
      return 0
    }

    // Roll using PRNG (0 to totalWeight - 1)
    const roll = this.nextRandom() % totalWeight

    // Select winner by weight accumulation
    let accumulated = 0
    i = 0
    while (i < candidateCount) {
      accumulated = accumulated + this.candWeights[i]
      if (roll < accumulated) {
        return i
      }
      i = i + 1
    }

    // Fallback to last candidate (should never reach here)
    return candidateCount - 1
  }

  /**
   * Convert slot index to byte pointer.
   */
  private ptrFromSlot(slot: number): number {
    return (this.synapseTableOffsetI32 * 4) + (slot * SYNAPSE_TABLE.STRIDE_BYTES)
  }

  /**
   * Convert byte pointer to slot index.
   */
  private slotFromPtr(ptr: number): number {
    const tableStart = this.synapseTableOffsetI32 * 4
    return (ptr - tableStart) / SYNAPSE_TABLE.STRIDE_BYTES
  }

  /**
   * Simple xorshift32 PRNG for deterministic random selection.
   * Zero-allocation, fast, and reproducible.
   */
  private nextRandom(): number {
    let x = this.prngState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.prngState = x >>> 0
    return this.prngState
  }

  /**
   * Set PRNG seed for reproducible randomness.
   * Note: xorshift32 has fixpoint at 0, so zero seeds are converted to 1.
   */
  setSeed(seed: number): void {
    this.prngState = (seed >>> 0) || 1
  }
}
