// =============================================================================
// SymphonyScript - Silicon Linker Constants (RFC-043)
// =============================================================================
// Memory layout and constants for Direct-to-Silicon Mirroring architecture.

/**
 * Magic number identifying Silicon Linker SAB format: "SYMB" as ASCII bytes.
 */
export const SL_MAGIC = 0x53594d42

/**
 * Current Silicon Linker format version.
 */
export const SL_VERSION = 0x01

/**
 * Default pulses per quarter note.
 */
export const DEFAULT_PPQ = 480

/**
 * Default tempo in BPM.
 */
export const DEFAULT_BPM = 120

/**
 * Default safe zone in ticks (2 beats at 480 PPQ).
 */
export const DEFAULT_SAFE_ZONE_TICKS = 960

/**
 * Null pointer value (end of chain / empty).
 */
export const NULL_PTR = 0

// =============================================================================
// Header Offsets (0-15) - 64 bytes = 16 × i32
// =============================================================================

/**
 * Header register offsets within the SAB.
 * All offsets are i32 indices (multiply by 4 for byte offset).
 */
export const HDR = {
  /** Magic number (0x53594D42 = "SYMB") */
  MAGIC: 0,
  /** Format version */
  VERSION: 1,
  /** Pulses per quarter note */
  PPQ: 2,
  /** Tempo in BPM (can be updated live) */
  BPM: 3,
  /** [ATOMIC] Byte offset to first node in chain (0 = empty) */
  HEAD_PTR: 4,
  /** [ATOMIC] Byte offset to first free node (0 = heap exhausted) */
  FREE_LIST_PTR: 5,
  /** [ATOMIC] Commit flag: IDLE=0, PENDING=1, ACK=2 */
  COMMIT_FLAG: 6,
  /** [ATOMIC] Current playhead tick (written by AudioWorklet) */
  PLAYHEAD_TICK: 7,
  /** Safe zone distance in ticks (structural edits blocked within) */
  SAFE_ZONE_TICKS: 8,
  /** [ATOMIC] Error flag: OK=0, HEAP_EXHAUSTED=1, SAFE_ZONE=2, INVALID_PTR=3 */
  ERROR_FLAG: 9,
  /** [ATOMIC] Total allocated nodes (live chain) */
  NODE_COUNT: 10,
  /** [ATOMIC] Nodes in free list */
  FREE_COUNT: 11,
  /** Total node capacity (set at init) */
  NODE_CAPACITY: 12,
  /** Byte offset where node heap begins */
  HEAP_START: 13,
  /** Byte offset where groove templates begin */
  GROOVE_START: 14,
  /** Reserved */
  RESERVED_15: 15
} as const

// =============================================================================
// Register Bank Offsets (16-31) - 64 bytes = 16 × i32
// =============================================================================

/**
 * Live transform registers for VM-resident math.
 * These can be updated at any time for instant feedback.
 */
export const REG = {
  /** Byte offset to active groove template (0 = no groove) */
  GROOVE_PTR: 16,
  /** Groove template length in steps */
  GROOVE_LEN: 17,
  /** Humanize timing jitter (parts per thousand of PPQ) */
  HUMAN_TIMING_PPT: 18,
  /** Humanize velocity jitter (parts per thousand) */
  HUMAN_VEL_PPT: 19,
  /** Global transposition in semitones (signed) */
  TRANSPOSE: 20,
  /** Global velocity multiplier (parts per thousand, 1000 = 1.0) */
  VELOCITY_MULT: 21,
  /** PRNG seed for deterministic humanization */
  PRNG_SEED: 22,
  /** Reserved registers 23-31 */
  RESERVED_23: 23,
  RESERVED_24: 24,
  RESERVED_25: 25,
  RESERVED_26: 26,
  RESERVED_27: 27,
  RESERVED_28: 28,
  RESERVED_29: 29,
  RESERVED_30: 30,
  RESERVED_31: 31
} as const

// =============================================================================
// Node Heap Layout
// =============================================================================

/**
 * Node structure offsets (6 × i32 = 24 bytes per node).
 *
 * Layout:
 * - [+0] PACKED_A: (opcode << 24) | (pitch << 16) | (velocity << 8) | flags
 * - [+1] BASE_TICK: Grid-aligned timing (pre-transform)
 * - [+2] DURATION: Duration in ticks
 * - [+3] NEXT_PTR: Byte offset to next node (0 = end of chain)
 * - [+4] SOURCE_ID: Editor location hash for bidirectional mapping
 * - [+5] SEQ_FLAGS: (sequence << 8) | flags_extended
 */
export const NODE = {
  /** Packed opcode, pitch, velocity, flags */
  PACKED_A: 0,
  /** Base tick (grid-aligned, pre-transform) */
  BASE_TICK: 1,
  /** Duration in ticks */
  DURATION: 2,
  /** Next pointer (byte offset, 0 = end) */
  NEXT_PTR: 3,
  /** Source ID (editor location hash) */
  SOURCE_ID: 4,
  /** Sequence counter (upper 24 bits) + extended flags (lower 8 bits) */
  SEQ_FLAGS: 5
} as const

/**
 * Node size in i32 units.
 */
export const NODE_SIZE_I32 = 6

/**
 * Node size in bytes.
 */
export const NODE_SIZE_BYTES = NODE_SIZE_I32 * 4

// =============================================================================
// Packed Field Bit Layouts
// =============================================================================

/**
 * PACKED_A field bit positions and masks.
 * Format: (opcode << 24) | (pitch << 16) | (velocity << 8) | flags
 */
export const PACKED = {
  /** Opcode: bits 24-31 */
  OPCODE_SHIFT: 24,
  OPCODE_MASK: 0xff000000,
  /** Pitch: bits 16-23 */
  PITCH_SHIFT: 16,
  PITCH_MASK: 0x00ff0000,
  /** Velocity: bits 8-15 */
  VELOCITY_SHIFT: 8,
  VELOCITY_MASK: 0x0000ff00,
  /** Flags: bits 0-7 */
  FLAGS_MASK: 0x000000ff
} as const

/**
 * SEQ_FLAGS field bit positions.
 * Format: (sequence << 8) | flags_extended
 */
export const SEQ = {
  /** Sequence counter: bits 8-31 (24-bit counter) */
  SEQ_SHIFT: 8,
  SEQ_MASK: 0xffffff00,
  /** Extended flags: bits 0-7 */
  FLAGS_EXT_MASK: 0x000000ff
} as const

// =============================================================================
// Node Flags
// =============================================================================

/**
 * Node flags (lower 8 bits of PACKED_A).
 */
export const FLAG = {
  /** Node is active (not deleted) */
  ACTIVE: 0x01,
  /** Node is muted (skip during playback) */
  MUTED: 0x02,
  /** Write in progress (consumer should spin/skip) */
  DIRTY: 0x04
} as const

// =============================================================================
// Opcodes
// =============================================================================

/**
 * Node opcodes (upper 8 bits of PACKED_A).
 */
export const OPCODE = {
  /** Note event */
  NOTE: 0x01,
  /** Rest (silent duration) */
  REST: 0x02,
  /** Control change */
  CC: 0x03,
  /** Pitch bend */
  BEND: 0x04
} as const

// =============================================================================
// Commit Protocol
// =============================================================================

/**
 * COMMIT_FLAG states for structural edit synchronization.
 */
export const COMMIT = {
  /** No pending structural changes */
  IDLE: 0,
  /** Structural change complete, awaiting ACK */
  PENDING: 1,
  /** Consumer acknowledged, Linker can clear */
  ACK: 2
} as const

// =============================================================================
// Error Codes
// =============================================================================

/**
 * ERROR_FLAG values.
 */
export const ERROR = {
  /** No error */
  OK: 0,
  /** Heap exhausted (no free nodes) */
  HEAP_EXHAUSTED: 1,
  /** Safe zone violation (edit too close to playhead) */
  SAFE_ZONE: 2,
  /** Invalid pointer encountered */
  INVALID_PTR: 3
} as const

// =============================================================================
// Memory Layout Calculation
// =============================================================================

/**
 * Calculate total SAB size needed for given node capacity.
 *
 * Layout:
 * - Header: 64 bytes (16 × i32)
 * - Registers: 64 bytes (16 × i32)
 * - Node Heap: nodeCapacity × 24 bytes
 * - Groove Templates: 1024 bytes (fixed)
 *
 * @param nodeCapacity - Maximum number of nodes
 * @returns Total bytes needed for SharedArrayBuffer
 */
export function calculateSABSize(nodeCapacity: number): number {
  const headerSize = 64 // 16 × i32
  const registerSize = 64 // 16 × i32
  const heapSize = nodeCapacity * NODE_SIZE_BYTES
  const grooveSize = 1024 // Fixed groove template region
  return headerSize + registerSize + heapSize + grooveSize
}

/**
 * Calculate byte offset where node heap begins.
 * Header (64) + Registers (64) = 128 bytes.
 */
export const HEAP_START_OFFSET = 128

/**
 * Calculate i32 index where node heap begins.
 */
export const HEAP_START_I32 = HEAP_START_OFFSET / 4

// =============================================================================
// Type Exports
// =============================================================================

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE]
export type CommitState = (typeof COMMIT)[keyof typeof COMMIT]
export type ErrorCode = (typeof ERROR)[keyof typeof ERROR]
export type NodeFlag = (typeof FLAG)[keyof typeof FLAG]
