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
  HDR
} from '../constants'
import { KernelPanicError } from '../types'

// =============================================================================
// Types
// =============================================================================

/**
 * Result of synaptic resolution.
 */
export interface SynapseResolutionResult {
  /** Target node pointer (next clip start), or NULL_PTR if no valid synapse */
  targetPtr: number
  /** Jitter to apply to timing (in ticks) */
  jitter: number
  /** Weight of the winning synapse (for plasticity feedback) */
  weight: number
  /** Pointer to the winning synapse (for reward updates) */
  synapsePtr: number
}

/**
 * Candidate synapse during stochastic selection.
 * Uses stack-based array to avoid allocations during resolution.
 */
interface SynapseCandidate {
  targetPtr: number
  weight: number
  jitter: number
  synapsePtr: number
}

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

  /** Pre-allocated candidate array for stochastic selection (max 64 candidates) */
  private readonly candidates: SynapseCandidate[] = []

  /** PRNG state for deterministic stochastic selection */
  private prngState: number

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

    // Pre-allocate candidate slots (max 64 per RFC-045 quota)
    for (let i = 0; i < SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK; i++) {
      this.candidates.push({ targetPtr: 0, weight: 0, jitter: 0, synapsePtr: 0 })
    }
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
   * Resolve synaptic connection when cursor reaches end of chain.
   *
   * This is the core neural branching logic (RFC-045 Section 4.1).
   * Called when `node.NEXT_PTR == NULL_PTR` to find the next target.
   *
   * **Algorithm:**
   * 1. Quota check (abort if exceeded)
   * 2. Hash SOURCE_PTR to find synapse head slot
   * 3. Collect all candidates (follow META_NEXT chain)
   * 4. Stochastic selection (weighted random)
   * 5. Apply jitter and return target
   *
   * @param sourcePtr - The source node pointer (end of current clip)
   * @returns Resolution result with target, jitter, and metadata
   */
  resolveSynapse(sourcePtr: number): SynapseResolutionResult {
    // 1. Quota Check
    if (!this.canFireSynapse()) {
      // Quota exceeded - cursor dies (song ends)
      return {
        targetPtr: NULL_PTR,
        jitter: 0,
        weight: 0,
        synapsePtr: NULL_PTR
      }
    }

    // Increment quota counter
    this.synapsesFiredThisBlock++

    // 2. Hash Lookup
    const headSlot = this.findHeadSlot(sourcePtr)
    if (headSlot === -1) {
      // No synapse found - cursor dies (song ends)
      return {
        targetPtr: NULL_PTR,
        jitter: 0,
        weight: 0,
        synapsePtr: NULL_PTR
      }
    }

    // 3. Collect Candidates (traverse META_NEXT chain)
    const candidateCount = this.collectCandidates(headSlot)
    if (candidateCount === 0) {
      // All candidates were tombstones - cursor dies
      return {
        targetPtr: NULL_PTR,
        jitter: 0,
        weight: 0,
        synapsePtr: NULL_PTR
      }
    }

    // 4. Stochastic Selection
    const winner = this.selectWinner(candidateCount)

    // 5. Apply Jitter and Update State
    this.pendingJitter = winner.jitter
    this.currentPtr = winner.targetPtr

    // Placeholder for plasticity hook (RFC-045-04)
    // this._triggerRewardUpdate(winner.synapsePtr)

    return {
      targetPtr: winner.targetPtr,
      jitter: winner.jitter,
      weight: winner.weight,
      synapsePtr: winner.synapsePtr
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Knuth's Multiplicative Hash (same as SynapseAllocator).
   */
  private hash(key: number): number {
    return (Math.imul(key, SYNAPSE_TABLE.KNUTH_CONST) >>> 0) % this.capacity
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
      probes++
    }

    return -1 // Table full/scanned completely
  }

  /**
   * Collect all valid candidates from a synapse chain.
   *
   * Traverses the META_NEXT linked list, skipping tombstones
   * (TARGET_PTR == NULL_PTR), and populates the pre-allocated
   * candidates array.
   *
   * @param headSlot - Starting slot for the chain
   * @returns Number of valid candidates collected
   */
  private collectCandidates(headSlot: number): number {
    let count = 0
    let currentSlot = headSlot
    let iterations = 0

    // Safety limit to prevent infinite loops (max chain length)
    const MAX_CHAIN_LENGTH = 1000

    while (currentSlot !== -1 && count < SYNAPSE_QUOTA.MAX_FIRES_PER_BLOCK) {
      if (++iterations > MAX_CHAIN_LENGTH) {
        throw new KernelPanicError('SynapticCursor: Infinite loop in synapse chain')
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

        // Store candidate (reuse pre-allocated slot)
        const candidate = this.candidates[count]
        candidate.targetPtr = targetPtr
        candidate.weight = weight
        candidate.jitter = jitter
        candidate.synapsePtr = this.ptrFromSlot(currentSlot)
        count++
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
   * @param candidateCount - Number of valid candidates in array
   * @returns The winning candidate
   */
  private selectWinner(candidateCount: number): SynapseCandidate {
    // Single candidate - no randomness needed
    if (candidateCount === 1) {
      return this.candidates[0]
    }

    // Calculate total weight
    let totalWeight = 0
    for (let i = 0; i < candidateCount; i++) {
      totalWeight += this.candidates[i].weight
    }

    // Edge case: all weights are zero - pick first candidate
    if (totalWeight === 0) {
      return this.candidates[0]
    }

    // Roll using PRNG (0 to totalWeight - 1)
    const roll = this.nextRandom() % totalWeight

    // Select winner by weight accumulation
    let accumulated = 0
    for (let i = 0; i < candidateCount; i++) {
      accumulated += this.candidates[i].weight
      if (roll < accumulated) {
        return this.candidates[i]
      }
    }

    // Fallback to last candidate (should never reach here)
    return this.candidates[candidateCount - 1]
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

  // ===========================================================================
  // Plasticity Hook (Placeholder for RFC-045-04)
  // ===========================================================================

  /**
   * Trigger reward update for the winning synapse.
   * This is a placeholder for the Plasticity Engine (RFC-045-04).
   *
   * @param _synapsePtr - Pointer to the synapse that fired
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected _triggerRewardUpdate(_synapsePtr: number): void {
    // RFC-045-04 will implement:
    // - Weight hardening (potentiation)
    // - Learning rate application
    // - Reward counter integration
  }
}
