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
  getIdentityTableOffset,
  getSymbolTableOffset,
  getGrooveTemplateOffset,
  getZoneSplitIndex,
  getRingBufferOffset,
  DEFAULT_RING_CAPACITY,
  ID_TABLE,
  SYM_TABLE,
  REVERSE_INDEX,
  getReverseIndexOffset,
  SYNAPSE_TABLE,
  getSynapseTableOffset
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
  const sab64 = new BigInt64Array(buffer)

  // Initialize header
  initializeHeader(sab, cfg)

  // Initialize register bank
  initializeRegisters(sab, cfg)

  // Initialize free list (RFC-044: Only Zone A, not Zone B)
  // Zone A is for Worker/Audio Thread CAS-based allocation
  // Zone B is reserved for Main Thread bump-pointer allocation (LocalAllocator)
  const zoneASize = getZoneSplitIndex(cfg.nodeCapacity)
  FreeList.initialize(sab, sab64, zoneASize, cfg.nodeCapacity)

  // Initialize Identity Table
  initializeIdentityTable(sab, cfg.nodeCapacity)

  // Initialize Symbol Table
  initializeSymbolTable(sab, cfg.nodeCapacity)

  // Initialize Ring Buffer header (RFC-044)
  initializeRingBufferHeader(sab, cfg.nodeCapacity)

  // Initialize Reverse Index table (ISSUE-016)
  initializeReverseIndex(sab, cfg.nodeCapacity)

  // Initialize Synapse Table (ISSUE-023)
  initializeSynapseTable(sab, cfg.nodeCapacity)

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
 * Initialize the Identity Table region.
 *
 * The Identity Table is a linear-probe hash table mapping TID (sourceId) to NodePtr.
 * All slots are initialized to EMPTY_TID (0) to indicate empty.
 *
 * Header fields set:
 * - HDR.ID_TABLE_PTR: Byte offset to the Identity Table
 * - HDR.ID_TABLE_CAPACITY: Total number of slots
 * - HDR.ID_TABLE_USED: 0 (no entries initially)
 */
function initializeIdentityTable(sab: Int32Array, nodeCapacity: number): void {
  const tableOffset = getIdentityTableOffset(nodeCapacity)
  const tableOffsetI32 = tableOffset / 4

  // Set header fields
  sab[HDR.ID_TABLE_PTR] = tableOffset
  sab[HDR.ID_TABLE_CAPACITY] = nodeCapacity
  sab[HDR.ID_TABLE_USED] = 0

  // Clear all slots to EMPTY_TID (0)
  // Each entry is 2 × i32: [TID, NodePtr]
  // Total slots = nodeCapacity
  const totalI32 = nodeCapacity * ID_TABLE.ENTRY_SIZE_I32
  let i = 0
  while (i < totalI32) {
    sab[tableOffsetI32 + i] = 0
    i = i + 1
  }
}

/**
 * Initialize the Symbol Table region.
 *
 * The Symbol Table maps sourceId → packed SourceLocation for editor integration.
 * All entries are initialized to EMPTY_ENTRY (0) to indicate no location stored.
 *
 * The Symbol Table shares the same capacity as the Identity Table and uses
 * the same slot index for corresponding sourceIds.
 */
function initializeSymbolTable(sab: Int32Array, nodeCapacity: number): void {
  const tableOffset = getSymbolTableOffset(nodeCapacity)
  const tableOffsetI32 = tableOffset / 4

  // Clear all entries to EMPTY_ENTRY (0)
  // Each entry is 2 × i32: [fileHash, lineCol]
  // Total slots = nodeCapacity
  const totalI32 = nodeCapacity * SYM_TABLE.ENTRY_SIZE_I32
  let i = 0
  while (i < totalI32) {
    sab[tableOffsetI32 + i] = 0
    i = i + 1
  }
}

/**
 * Initialize the Command Ring Buffer header (RFC-044).
 *
 * The Ring Buffer header fields must be initialized here (not in RingBuffer constructor)
 * to ensure the SAB is fully formatted before any threads access it.
 *
 * **Critical Hygiene:**
 * If the Worker starts before the Main Thread instantiates RingBuffer, it must see
 * valid header fields. This function ensures the SAB is "pre-formatted" for RFC-044.
 *
 * Header fields initialized:
 * - HDR.RB_CAPACITY: Maximum commands that can be queued
 * - HDR.COMMAND_RING_PTR: Byte offset to ring buffer data region
 * - HDR.RB_HEAD: Read index (initially 0, empty)
 * - HDR.RB_TAIL: Write index (initially 0, empty)
 */
function initializeRingBufferHeader(sab: Int32Array, nodeCapacity: number): void {
  // Set capacity (fixed at compile time)
  Atomics.store(sab, HDR.RB_CAPACITY, DEFAULT_RING_CAPACITY)

  // Calculate and store data region pointer
  const ringOffset = getRingBufferOffset(nodeCapacity)
  Atomics.store(sab, HDR.COMMAND_RING_PTR, ringOffset)

  // Initialize indices (empty ring: head === tail)
  Atomics.store(sab, HDR.RB_HEAD, 0)
  Atomics.store(sab, HDR.RB_TAIL, 0)
}

/**
 * Initialize the Reverse Index table (ISSUE-016).
 *
 * The Reverse Index maps TARGET_PTR → linked list of synapses for O(k) disconnect.
 * All buckets are initialized to EMPTY (-1) to indicate no synapses in that bucket.
 *
 * @param sab - Int32Array view of the SharedArrayBuffer
 * @param nodeCapacity - Number of nodes in the SAB (used to calculate offset)
 */
function initializeReverseIndex(sab: Int32Array, nodeCapacity: number): void {
  const reverseIndexOffset = getReverseIndexOffset(nodeCapacity)
  const reverseIndexI32 = reverseIndexOffset / 4

  // Initialize all buckets to EMPTY (-1)
  let bucket = 0
  while (bucket < REVERSE_INDEX.BUCKET_COUNT) {
    sab[reverseIndexI32 + bucket] = REVERSE_INDEX.EMPTY
    bucket = bucket + 1
  }
}

/**
 * Initialize the Synapse Table region (ISSUE-023).
 *
 * While SharedArrayBuffer is zero-initialized by spec, we explicitly clear the
 * Synapse Table to:
 * 1. Document intent that all entries start empty
 * 2. Support future non-zero sentinel values if needed
 * 3. Ensure consistent behavior across all platforms
 *
 * Each synapse entry is 4 × i32: [SOURCE_PTR, TARGET_PTR, WEIGHT_DATA, META_NEXT]
 * Total size: SYNAPSE_TABLE.MAX_CAPACITY (65536) × SYNAPSE_TABLE.STRIDE_I32 (4) = 262144 i32s
 *
 * @param sab - Int32Array view of the SharedArrayBuffer
 * @param nodeCapacity - Number of nodes in the SAB (used to calculate offset)
 */
function initializeSynapseTable(sab: Int32Array, nodeCapacity: number): void {
  const tableOffset = getSynapseTableOffset(nodeCapacity)
  const tableOffsetI32 = tableOffset / 4
  const totalI32 = SYNAPSE_TABLE.MAX_CAPACITY * SYNAPSE_TABLE.STRIDE_I32

  // Zero all synapse entries
  let i = 0
  while (i < totalI32) {
    sab[tableOffsetI32 + i] = 0
    i = i + 1
  }
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
  const sab64 = new BigInt64Array(buffer)
  const nodeCapacity = sab[HDR.NODE_CAPACITY]

  // Reset synchronization state
  sab[HDR.COMMIT_FLAG] = COMMIT.IDLE
  sab[HDR.PLAYHEAD_TICK] = 0
  sab[HDR.ERROR_FLAG] = ERROR.OK

  // Re-initialize free list (RFC-044: Only Zone A, not Zone B)
  const zoneASize = getZoneSplitIndex(nodeCapacity)
  FreeList.initialize(sab, sab64, zoneASize, nodeCapacity)

  // Re-initialize Identity Table
  initializeIdentityTable(sab, nodeCapacity)

  // Re-initialize Symbol Table
  initializeSymbolTable(sab, nodeCapacity)

  // Re-initialize Ring Buffer header (RFC-044)
  initializeRingBufferHeader(sab, nodeCapacity)

  // Re-initialize Reverse Index table (ISSUE-016)
  initializeReverseIndex(sab, nodeCapacity)

  // Re-initialize Synapse Table (ISSUE-023)
  initializeSynapseTable(sab, nodeCapacity)
}

/**
 * Write a groove template to the SAB.
 *
 * RFC-045-04: Accepts ArrayLike<number> (both number[] and Int32Array).
 *
 * Groove template format in SAB:
 * - [0] Length (number of steps)
 * - [1..N] Tick offsets for each step
 *
 * @param buffer - SharedArrayBuffer
 * @param templateIndex - Which template slot (0-based)
 * @param offsets - ArrayLike of tick offsets for each step
 * @param count - Number of offsets to write (if less than offsets.length)
 */
export function writeGrooveTemplate(
  buffer: SharedArrayBuffer,
  templateIndex: number,
  offsets: ArrayLike<number>,
  count?: number
): void {
  const sab = new Int32Array(buffer)
  const nodeCapacity = sab[HDR.NODE_CAPACITY]
  // Groove templates are after Identity Table
  const grooveStart = getGrooveTemplateOffset(nodeCapacity) / 4 // Convert byte offset to i32 index

  // Each template: 17 i32s (1 length + 16 max offsets)
  const templateSize = 17
  const templateOffset = grooveStart + templateIndex * templateSize

  const offsetCount = count ?? offsets.length

  // Write length
  sab[templateOffset] = Math.min(offsetCount, 16)

  // Write offsets (max 16 steps) - zero-alloc while loop
  let i = 0
  while (i < 16) {
    sab[templateOffset + 1 + i] = i < offsetCount ? (offsets[i] | 0) : 0
    i = i + 1
  }
}

/**
 * Read a groove template from the SAB.
 *
 * RFC-045-04: Zero-allocation API - caller provides output array.
 * For backward compatibility (tests), can be called without output array.
 *
 * @param buffer - SharedArrayBuffer
 * @param templateIndex - Which template slot (0-based)
 * @param outOffsets - Pre-allocated Int32Array to receive offsets (optional for tests)
 * @returns Number of offsets read (if outOffsets provided), or array of offsets (if not)
 */
export function readGrooveTemplate(
  buffer: SharedArrayBuffer,
  templateIndex: number,
  outOffsets?: Int32Array
): number | number[] {
  const sab = new Int32Array(buffer)
  const nodeCapacity = sab[HDR.NODE_CAPACITY]
  // Groove templates are after Identity Table
  const grooveStart = getGrooveTemplateOffset(nodeCapacity) / 4

  const templateSize = 17
  const templateOffset = grooveStart + templateIndex * templateSize

  const length = sab[templateOffset]

  // Zero-allocation path: caller provides output array
  if (outOffsets !== undefined) {
    let i = 0
    while (i < length && i < outOffsets.length) {
      outOffsets[i] = sab[templateOffset + 1 + i]
      i = i + 1
    }
    return length
  }

  // Legacy path (for tests): allocate and return array
  const offsets: number[] = []
  let i = 0
  while (i < length) {
    offsets[i] = sab[templateOffset + 1 + i]
    i = i + 1
  }
  return offsets
}
