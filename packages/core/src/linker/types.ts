// =============================================================================
// SymphonyScript - Silicon Linker Types (RFC-043)
// =============================================================================

import type { Opcode } from './constants'

/**
 * Node pointer type (byte offset into SAB).
 * 0 indicates null/end-of-chain.
 */
export type NodePtr = number

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

/**
 * Error thrown when heap is exhausted.
 */
export class HeapExhaustedError extends Error {
  constructor() {
    super('Silicon Linker: Heap exhausted, no free nodes available')
    this.name = 'HeapExhaustedError'
  }
}

/**
 * Error thrown when structural edit violates safe zone.
 */
export class SafeZoneViolationError extends Error {
  constructor(
    public readonly targetTick: number,
    public readonly playheadTick: number,
    public readonly safeZone: number
  ) {
    super(
      `Silicon Linker: Safe zone violation. ` +
        `Target tick ${targetTick} is within ${safeZone} ticks of playhead ${playheadTick}`
    )
    this.name = 'SafeZoneViolationError'
  }
}

/**
 * Error thrown when an invalid pointer is encountered.
 */
export class InvalidPointerError extends Error {
  constructor(ptr: NodePtr) {
    super(`Silicon Linker: Invalid pointer ${ptr}`)
    this.name = 'InvalidPointerError'
  }
}

/**
 * Error thrown when kernel panic occurs (mutex deadlock or catastrophic failure).
 * This indicates a crashed worker is holding a lock or other unrecoverable state.
 * System requires a warm restart.
 *
 * @remarks
 * This error is part of the Dead-Man's Switch mechanism (v1.5) to prevent
 * permanent system freezes when a worker crashes while holding the Chain Mutex.
 */
export class KernelPanicError extends Error {
  constructor(message: string) {
    super(`Silicon Linker: Kernel Panic - ${message}`)
    this.name = 'KernelPanicError'
  }
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

  // --- Structural Operations (Safe Zone Enforced) ---

  /** Insert a new node after the given node. Throws if in safe zone. */
  insertNode(
    afterPtr: NodePtr,
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr

  /** Insert a new node at the head of the chain. */
  insertHead(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    sourceId: number,
    flags: number
  ): NodePtr

  /** Delete a node from the chain. Throws if in safe zone. */
  deleteNode(ptr: NodePtr): void

  // --- Commit Protocol ---

  /** Synchronously wait for consumer to acknowledge structural change. */
  syncAck(): void

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

  /** Get underlying SAB. */
  getSAB(): SharedArrayBuffer
}
