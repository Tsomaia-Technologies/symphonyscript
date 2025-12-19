// =============================================================================
// SymphonyScript - Silicon Linker SAB Initialization (RFC-043)
// =============================================================================
// Factory functions for creating and initializing SharedArrayBuffers.

import {
  SL_MAGIC,
  SL_VERSION,
  DEFAULT_PPQ,
  DEFAULT_BPM,
  DEFAULT_SAFE_ZONE_TICKS,
  HDR,
  REG,
  COMMIT,
  ERROR,
  NULL_PTR,
  calculateSABSize,
  HEAP_START_OFFSET
} from './constants'
import { FreeList } from './free-list'
import type { LinkerConfig } from './types'

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<LinkerConfig> = {
  nodeCapacity: 4096,
  ppq: DEFAULT_PPQ,
  bpm: DEFAULT_BPM,
  safeZoneTicks: DEFAULT_SAFE_ZONE_TICKS,
  prngSeed: 12345
}

/**
 * Create and initialize a new SharedArrayBuffer for the Silicon Linker.
 *
 * The buffer is fully initialized with:
 * - Magic number and version
 * - Configuration values (PPQ, BPM, safe zone)
 * - Empty node chain (HEAD_PTR = NULL)
 * - Full free list (all nodes linked)
 * - Zeroed groove template region
 *
 * @param config - Optional configuration overrides
 * @returns Initialized SharedArrayBuffer
 */
export function createLinkerSAB(config?: LinkerConfig): SharedArrayBuffer {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Calculate total size needed
  const totalBytes = calculateSABSize(cfg.nodeCapacity)

  // Create SharedArrayBuffer
  const buffer = new SharedArrayBuffer(totalBytes)
  const sab = new Int32Array(buffer)

  // Initialize header
  initializeHeader(sab, cfg)

  // Initialize register bank
  initializeRegisters(sab, cfg)

  // Initialize free list (links all nodes)
  FreeList.initialize(sab, cfg.nodeCapacity)

  // Initialize groove template region (zeroed by default in SAB)
  // Groove templates start after the node heap
  const grooveStart = HEAP_START_OFFSET + cfg.nodeCapacity * 24 // 24 bytes per node
  sab[HDR.GROOVE_START] = grooveStart

  return buffer
}

/**
 * Initialize the header region (offsets 0-15).
 */
function initializeHeader(
  sab: Int32Array,
  cfg: Required<LinkerConfig>
): void {
  // Identity
  sab[HDR.MAGIC] = SL_MAGIC
  sab[HDR.VERSION] = SL_VERSION

  // Timing
  sab[HDR.PPQ] = cfg.ppq
  sab[HDR.BPM] = cfg.bpm

  // Pointers (initialized by FreeList.initialize)
  // sab[HDR.HEAD_PTR] = NULL_PTR
  // sab[HDR.FREE_LIST_PTR] = ...

  // Synchronization
  sab[HDR.COMMIT_FLAG] = COMMIT.IDLE
  sab[HDR.PLAYHEAD_TICK] = 0
  sab[HDR.SAFE_ZONE_TICKS] = cfg.safeZoneTicks
  sab[HDR.ERROR_FLAG] = ERROR.OK

  // Counters (initialized by FreeList.initialize)
  // sab[HDR.NODE_COUNT] = 0
  // sab[HDR.FREE_COUNT] = cfg.nodeCapacity
  // sab[HDR.NODE_CAPACITY] = cfg.nodeCapacity
  // sab[HDR.HEAP_START] = HEAP_START_OFFSET
}

/**
 * Initialize the register bank (offsets 16-31).
 */
function initializeRegisters(
  sab: Int32Array,
  cfg: Required<LinkerConfig>
): void {
  // Groove (disabled by default)
  sab[REG.GROOVE_PTR] = NULL_PTR
  sab[REG.GROOVE_LEN] = 0

  // Humanization (disabled by default)
  sab[REG.HUMAN_TIMING_PPT] = 0
  sab[REG.HUMAN_VEL_PPT] = 0

  // Global transforms
  sab[REG.TRANSPOSE] = 0
  sab[REG.VELOCITY_MULT] = 1000 // 1.0 in parts per thousand

  // PRNG
  sab[REG.PRNG_SEED] = cfg.prngSeed
}

/**
 * Validate that a SharedArrayBuffer has the correct Silicon Linker format.
 *
 * @param buffer - Buffer to validate
 * @returns true if valid, false otherwise
 */
export function validateLinkerSAB(buffer: SharedArrayBuffer): boolean {
  if (buffer.byteLength < 128) {
    return false // Too small for header + registers
  }

  const sab = new Int32Array(buffer)

  // Check magic number
  if (sab[HDR.MAGIC] !== SL_MAGIC) {
    return false
  }

  // Check version
  if (sab[HDR.VERSION] !== SL_VERSION) {
    return false
  }

  // Check that node capacity is reasonable
  const nodeCapacity = sab[HDR.NODE_CAPACITY]
  if (nodeCapacity <= 0 || nodeCapacity > 1000000) {
    return false
  }

  // Check buffer size matches expected
  const expectedSize = calculateSABSize(nodeCapacity)
  if (buffer.byteLength < expectedSize) {
    return false
  }

  return true
}

/**
 * Get configuration values from an existing SAB.
 *
 * @param buffer - Initialized SharedArrayBuffer
 * @returns Configuration extracted from the buffer
 */
export function getLinkerConfig(buffer: SharedArrayBuffer): Required<LinkerConfig> {
  const sab = new Int32Array(buffer)

  return {
    nodeCapacity: sab[HDR.NODE_CAPACITY],
    ppq: sab[HDR.PPQ],
    bpm: sab[HDR.BPM],
    safeZoneTicks: sab[HDR.SAFE_ZONE_TICKS],
    prngSeed: sab[REG.PRNG_SEED]
  }
}

/**
 * Reset an existing SAB to initial state.
 * Clears all nodes and resets to empty chain with full free list.
 *
 * WARNING: This is NOT thread-safe. Only call when no other threads
 * are accessing the buffer.
 *
 * @param buffer - SharedArrayBuffer to reset
 */
export function resetLinkerSAB(buffer: SharedArrayBuffer): void {
  const sab = new Int32Array(buffer)
  const nodeCapacity = sab[HDR.NODE_CAPACITY]

  // Reset synchronization state
  sab[HDR.COMMIT_FLAG] = COMMIT.IDLE
  sab[HDR.PLAYHEAD_TICK] = 0
  sab[HDR.ERROR_FLAG] = ERROR.OK

  // Re-initialize free list (clears all nodes)
  FreeList.initialize(sab, nodeCapacity)
}

/**
 * Write a groove template to the SAB.
 *
 * Groove template format in SAB:
 * - [0] Length (number of steps)
 * - [1..N] Tick offsets for each step
 *
 * @param buffer - SharedArrayBuffer
 * @param templateIndex - Which template slot (0-based)
 * @param offsets - Array of tick offsets for each step
 */
export function writeGrooveTemplate(
  buffer: SharedArrayBuffer,
  templateIndex: number,
  offsets: number[]
): void {
  const sab = new Int32Array(buffer)
  const grooveStart = sab[HDR.GROOVE_START] / 4 // Convert byte offset to i32 index

  // Each template: 17 i32s (1 length + 16 max offsets)
  const templateSize = 17
  const templateOffset = grooveStart + templateIndex * templateSize

  // Write length
  sab[templateOffset] = Math.min(offsets.length, 16)

  // Write offsets (max 16 steps)
  for (let i = 0; i < 16; i++) {
    sab[templateOffset + 1 + i] = i < offsets.length ? (offsets[i] | 0) : 0
  }
}

/**
 * Read a groove template from the SAB.
 *
 * @param buffer - SharedArrayBuffer
 * @param templateIndex - Which template slot (0-based)
 * @returns Array of tick offsets
 */
export function readGrooveTemplate(
  buffer: SharedArrayBuffer,
  templateIndex: number
): number[] {
  const sab = new Int32Array(buffer)
  const grooveStart = sab[HDR.GROOVE_START] / 4

  const templateSize = 17
  const templateOffset = grooveStart + templateIndex * templateSize

  const length = sab[templateOffset]
  const offsets: number[] = []

  for (let i = 0; i < length; i++) {
    offsets.push(sab[templateOffset + 1 + i])
  }

  return offsets
}
