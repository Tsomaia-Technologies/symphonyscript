// =============================================================================
// SymphonyScript - Silicon Linker Types (RFC-043)
// =============================================================================

/**
 * Node pointer type (byte offset into SAB).
 * 0 indicates null/end-of-chain.
 */
export type NodePtr = number

/**
 * Synapse pointer type (byte offset into Synapse Table).
 * Used for typed references to synaptic connections in the Silicon Brain.
 */
export type SynapsePtr = number

/**
 * Plasticity callback type (RFC-045-03 Section 4).
 *
 * Called whenever a synapse fires successfully during playback.
 * Used for automatic reward distribution (Hebbian learning).
 *
 * @param synapsePtr - Pointer to the synapse that fired
 */
export type PlasticityCallback = (synapsePtr: SynapsePtr) => void

/**
 * Synapse resolution callback type (RFC-045-04).
 *
 * Zero-allocation alternative to SynapseResolutionResult object.
 * Receives resolution data as primitives to avoid aliasing risk.
 *
 * @param targetPtr - Target node pointer (next clip start)
 * @param jitter - Jitter to apply to timing (in ticks)
 * @param weight - Weight of the winning synapse
 * @param synapsePtr - Pointer to the winning synapse
 */
export type SynapseResolutionCallback = (
  targetPtr: number,
  jitter: number,
  weight: number,
  synapsePtr: number
) => void

/**
 * Silicon Linker configuration options.
 */
export interface LinkerConfig {
  /** Maximum number of nodes (default: 4096) */
  nodeCapacity?: number
  /** Pulses per quarter note (default: 480) */
  ppq?: number
  /** Initial BPM (default: 120) */
  bpm?: number
  /** Safe zone in ticks (default: 960 = 2 beats at 480 PPQ) */
  safeZoneTicks?: number
  /** PRNG seed for humanization (default: 12345) */
  prngSeed?: number
}

/**
 * Result of a structural edit operation.
 */
export interface EditResult {
  /** Whether the operation succeeded */
  success: boolean
  /** New node pointer (for insert operations) */
  ptr?: NodePtr
  /** Error message if failed */
  error?: string
}

// RFC-045-04: Error classes removed - using error codes via Atomics.store instead
// See ERROR constant in constants.ts for error code definitions

// RFC-045-04 ISSUE-024: SynapseData and BrainSnapshot DELETED
// Use BrainSnapshotArrays for zero-allocation snapshot/restore operations

/**
 * Brain snapshot using TypedArrays (RFC-045-04 zero-allocation).
 *
 * All arrays must be pre-allocated by caller. Uses parallel array layout
 * (Structure of Arrays) for cache-friendly access.
 */
export interface BrainSnapshotArrays {
  /** Source IDs (parallel array) */
  sourceIds: Int32Array
  /** Target IDs (parallel array) */
  targetIds: Int32Array
  /** Weights (parallel array, 0-255) */
  weights: Int32Array
  /** Jitters (parallel array, in ticks) */
  jitters: Int32Array
  /** Number of valid entries (filled by snapshot operation) */
  count: number
}

/**
 * Silicon Linker interface.
 * Acts as MMU for the SharedArrayBuffer, handling all memory operations.
 */
export interface ISiliconLinker {
  // --- Memory Management ---

  /** Allocate a node from the free list. Returns NULL_PTR if exhausted. */
  allocNode(): NodePtr

  /** Return a node to the free list. */
  freeNode(ptr: NodePtr): void

  // --- Attribute Patching (Immediate) ---

  /** Patch pitch attribute (immediate, no COMMIT_FLAG). */
  patchPitch(ptr: NodePtr, pitch: number): void

  /** Patch velocity attribute (immediate, no COMMIT_FLAG). */
  patchVelocity(ptr: NodePtr, velocity: number): void

  /** Patch duration attribute (immediate, no COMMIT_FLAG). */
  patchDuration(ptr: NodePtr, duration: number): void

  /** Patch base tick (immediate, no COMMIT_FLAG). */
  patchBaseTick(ptr: NodePtr, baseTick: number): void

  /** Set/clear muted flag (immediate, no COMMIT_FLAG). */
  patchMuted(ptr: NodePtr, muted: boolean): void

  // --- Command Ring Protocol (RFC-044) ---

  /**
   * Process pending commands from the Ring Buffer.
   * This is the single source of truth for structural changes.
   * @returns Number of commands processed
   */
  processCommands(): number

  // --- Identity Table (sourceId ↔ NodePtr mapping) ---

  /** Lookup NodePtr by sourceId. Returns NULL_PTR if not found. */
  idTableLookup(sourceId: number): NodePtr

  /** Insert sourceId → ptr mapping. */
  idTableInsert(sourceId: number, ptr: NodePtr): void

  /** Remove sourceId from table. */
  idTableRemove(sourceId: number): void

  /** Clear all identity mappings. */
  idTableClear(): void

  // --- Symbol Table (sourceId ↔ SourceLocation mapping) ---

  /** Lookup source location by sourceId with callback pattern. Returns true if found. */
  symTableLookup(sourceId: number, cb: (fileHash: number, line: number, column: number) => void): boolean

  /** Store source location for sourceId. Returns true if stored, false if table full. */
  symTableStore(sourceId: number, fileHash: number, line: number, column: number): boolean

  /** Remove source location for sourceId. */
  symTableRemove(sourceId: number): void

  /** Clear all symbol mappings. */
  symTableClear(): void

  // --- Read Operations ---

  /**
   * Read node data at pointer with zero-allocation callback pattern.
   * Returns false if contention detected, true if read succeeded.
   *
   * CRITICAL: Callback function must be pre-bound/hoisted to avoid allocations.
   * DO NOT pass inline arrow functions - they allocate objects.
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
  ): boolean

  /** Get head of chain. */
  getHead(): NodePtr

  /**
   * Traverse all nodes in chain order with zero-allocation callback pattern.
   *
   * CRITICAL: Callback function must be pre-bound/hoisted to avoid allocations.
   * DO NOT pass inline arrow functions - they allocate objects.
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
  ): void

  // --- Register Operations ---

  /** Set groove template. */
  setGroove(ptr: NodePtr, length: number): void

  /** Set humanization parameters. */
  setHumanize(timingPpt: number, velocityPpt: number): void

  /** Set global transposition. */
  setTranspose(semitones: number): void

  /** Set global velocity multiplier. */
  setVelocityMult(ppt: number): void

  /** Set PRNG seed. */
  setPrngSeed(seed: number): void

  // --- Status ---

  /** Get current error flag. */
  getError(): number

  /** Clear error flag. */
  clearError(): void

  /** Get node count. */
  getNodeCount(): number

  /** Get free count. */
  getFreeCount(): number

  /** Reset linker state (clear chain and tables). */
  reset(): void

  /** Get underlying SAB. */
  getSAB(): SharedArrayBuffer
}
