// =============================================================================
// SymphonyScript - VM Constants (RFC-038)
// =============================================================================
// All bytecode values use hexadecimal notation as required by the specification.

/**
 * Magic number identifying SBC format: "SBC1" as ASCII bytes.
 */
export const SBC_MAGIC = 0x53424331

/**
 * Current SBC format version.
 */
export const SBC_VERSION = 0x02

/**
 * Default pulses per quarter note.
 */
export const DEFAULT_PPQ = 96

/**
 * Default tempo in BPM.
 */
export const DEFAULT_BPM = 120

// =============================================================================
// Register Offsets (0-31)
// =============================================================================

/**
 * Register offsets within the unified memory buffer.
 * Registers marked [ATOMIC] require Atomics.load/store for cross-thread visibility.
 */
export const REG = {
  /** Magic number (0x53424331 = "SBC1") */
  MAGIC: 0,
  /** Format version */
  VERSION: 1,
  /** Pulses per quarter note */
  PPQ: 2,
  /** Initial tempo in BPM */
  BPM: 3,
  /** Total program length in ticks */
  TOTAL_LENGTH: 4,
  /** Program counter (offset into bytecode region) */
  PC: 5,
  /** Current clock in ticks */
  TICK: 6,
  /** [ATOMIC] VM state: IDLE/RUNNING/PAUSED/DONE */
  STATE: 7,
  /** Stack frame pointer (0-based index, points to next free slot) */
  STACK_SP: 8,
  /** Loop frame pointer (0-based index, points to next free slot) */
  LOOP_SP: 9,
  /** Transposition stack pointer */
  TRANS_SP: 10,
  /** Current transposition offset (cached top of stack) */
  TRANSPOSITION: 11,
  /** [ATOMIC] Events written (monotonic counter for ring buffer) */
  EVENT_WRITE: 12,
  /** [ATOMIC] Events read by consumer (monotonic counter) */
  EVENT_READ: 13,
  /** Number of tempo changes recorded */
  TEMPO_COUNT: 14,
  /** Offset where bytecode begins */
  BYTECODE_START: 15,
  /** Offset where bytecode ends */
  BYTECODE_END: 16,
  /** Offset where event ring buffer begins */
  EVENT_START: 17,
  /** Ring buffer capacity (entries, not bytes) */
  EVENT_CAPACITY: 18,
  /** Offset where tempo buffer begins */
  TEMPO_START: 19,
  /** Maximum tempo changes */
  TEMPO_CAPACITY: 20
} as const

// =============================================================================
// Region Offsets
// =============================================================================

/**
 * Memory region offsets within the unified buffer.
 */
export const REGION = {
  /** Registers region (0-31) */
  REGISTERS: 0,
  /** Stack frames region: 14 frames × 8 ints = 112 ints */
  STACK_FRAMES: 32,
  /** Loop frames region: 20 frames × 4 ints = 80 ints */
  LOOP_FRAMES: 144,
  /** Transposition stack: 32 entries × 1 int = 32 ints */
  TRANSPOSE_STACK: 224,
  /** Bytecode starts at offset 256 */
  BYTECODE: 256
} as const

// =============================================================================
// Frame and Entry Sizes
// =============================================================================

/**
 * Stack frame size in ints.
 * Layout: [startTick, maxDuration, branchCount, branchIndex, reserved×4]
 */
export const STACK_FRAME_SIZE = 8

/**
 * Loop frame size in ints.
 * Layout: [bodyStartPC, remainingCount, reserved×2]
 */
export const LOOP_FRAME_SIZE = 4

/**
 * Event entry size in ints.
 * Layout: [type, startTick, field1, field2, field3, reserved]
 */
export const EVENT_SIZE = 6

/**
 * Tempo entry size in ints.
 * Layout: [tick, bpm]
 */
export const TEMPO_ENTRY_SIZE = 2

/**
 * Maximum stack frame depth.
 */
export const MAX_STACK_FRAMES = 14

/**
 * Maximum loop frame depth.
 */
export const MAX_LOOP_FRAMES = 20

/**
 * Maximum transposition stack depth.
 */
export const MAX_TRANSPOSE_DEPTH = 32

// =============================================================================
// VM States
// =============================================================================

/**
 * VM execution states.
 */
export const STATE = {
  /** VM initialized but not started */
  IDLE: 0x00,
  /** VM actively executing */
  RUNNING: 0x01,
  /** VM paused (tick boundary or backpressure) */
  PAUSED: 0x02,
  /** VM completed execution (hit EOF) */
  DONE: 0x03
} as const

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event type discriminators for the event buffer.
 */
export const EVENT_TYPE = {
  /** Note event */
  NOTE: 0x01,
  /** Control Change event */
  CC: 0x02,
  /** Pitch Bend event */
  BEND: 0x03
} as const

// =============================================================================
// Opcodes
// =============================================================================

/**
 * Bytecode opcodes organized by category.
 */
export const OP = {
  // --- Event Operations (0x00-0x1F) ---
  /** NOTE pitch vel dur — Emit note event, advance tick by dur */
  NOTE: 0x01,
  /** REST dur — Advance tick by dur (no event) */
  REST: 0x02,
  /** CHORD2 root int1 vel dur — 2-note chord macro */
  CHORD2: 0x03,
  /** CHORD3 root int1 int2 vel dur — 3-note chord macro */
  CHORD3: 0x04,
  /** CHORD4 root int1 int2 int3 vel dur — 4-note chord macro */
  CHORD4: 0x05,

  // --- Control Operations (0x20-0x3F) ---
  /** TEMPO bpm — Record tempo change */
  TEMPO: 0x20,
  /** CC ctrl val — Emit CC event */
  CC: 0x21,
  /** BEND val — Emit pitch bend event */
  BEND: 0x22,
  /** TRANSPOSE semitones — Push (n≠0) or pop (n=0) transposition */
  TRANSPOSE: 0x23,

  // --- Structural Operations (0x40-0x5F) ---
  /** STACK_START count — Push stack frame */
  STACK_START: 0x40,
  /** STACK_END — Pop frame, advance tick to max duration */
  STACK_END: 0x41,
  /** LOOP_START count — Push loop frame (skip body if count ≤ 0) */
  LOOP_START: 0x42,
  /** LOOP_END — Decrement count, jump back or pop */
  LOOP_END: 0x43,
  /** BRANCH_START — Reset tick to stack start */
  BRANCH_START: 0x46,
  /** BRANCH_END — Record branch duration */
  BRANCH_END: 0x47,

  // --- Terminator ---
  /** EOF — End of program */
  EOF: 0xFF
} as const

// =============================================================================
// Type Exports
// =============================================================================

export type OpCode = typeof OP[keyof typeof OP]
export type StateCode = typeof STATE[keyof typeof STATE]
export type EventTypeCode = typeof EVENT_TYPE[keyof typeof EVENT_TYPE]
