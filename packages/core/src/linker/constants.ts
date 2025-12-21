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
// PHYSICAL MEMORY MAP (v1.5)
// =============================================================================
/**
 * SharedArrayBuffer Memory Layout
 *
 * The Silicon Linker uses a carefully structured SharedArrayBuffer with the
 * following regions (all offsets in bytes):
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ HEADER REGION (0-60)                                    64 bytes    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Offset | i32 Index | Field              | Type    | Description    │
 * ├────────┼───────────┼────────────────────┼─────────┼────────────────┤
 * │ 0      │ 0         │ MAGIC              │ u32     │ 0x53594D42     │
 * │ 4      │ 1         │ VERSION            │ u32     │ Format version │
 * │ 8      │ 2         │ PPQ                │ u32     │ Pulses/quarter │
 * │ 12     │ 3         │ BPM                │ u32     │ Tempo          │
 * │ 16     │ 4         │ HEAD_PTR           │ u32     │ First node     │
 * │ 20     │ 5         │ RESERVED_5         │ u32     │ Padding/align  │
 * │ 24-31  │ 6-7       │ FREE_LIST_HEAD     │ i64     │ Ver+Ptr (ABA)  │
 * │ 32     │ 8         │ COMMIT_FLAG        │ u32     │ 0/1/2 sync     │
 * │ 36     │ 9         │ PLAYHEAD_TICK      │ u32     │ Audio position │
 * │ 40     │ 10        │ SAFE_ZONE_TICKS    │ u32     │ Edit boundary  │
 * │ 44     │ 11        │ ERROR_FLAG         │ u32     │ Error code     │
 * │ 48     │ 12        │ NODE_COUNT         │ u32     │ Live nodes     │
 * │ 52     │ 13        │ FREE_COUNT         │ u32     │ Free nodes     │
 * │ 56     │ 14        │ NODE_CAPACITY      │ u32     │ Max nodes      │
 * │ 60     │ 15        │ HEAP_START         │ u32     │ Heap offset    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ REGISTER BANK (64-88)                                   28 bytes    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ 64     │ 16        │ GROOVE_PTR         │ u32     │ Groove table   │
 * │ 68     │ 17        │ GROOVE_LEN         │ u32     │ Steps count    │
 * │ 72     │ 18        │ HUMAN_TIMING_PPT   │ u32     │ Timing jitter  │
 * │ 76     │ 19        │ HUMAN_VEL_PPT      │ u32     │ Velocity jit.  │
 * │ 80     │ 20        │ TRANSPOSE          │ i32     │ Semitones      │
 * │ 84     │ 21        │ VELOCITY_MULT      │ u32     │ Velocity ×1000 │
 * │ 88     │ 22        │ PRNG_SEED          │ u32     │ RNG seed       │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ EXTENDED HEADER (92-124) [v1.5]                        36 bytes    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ 92     │ 23        │ ID_TABLE_PTR       │ u32     │ TID hash table │
 * │ 96     │ 24        │ UPDATE_PASS_ID     │ u32     │ Generation ID  │
 * │ 100    │ 25        │ CHAIN_MUTEX        │ u32     │ 0=unlk, 1=lock │
 * │ 104    │ 26        │ ID_TABLE_CAPACITY  │ u32     │ Table slots    │
 * │ 108    │ 27        │ ID_TABLE_USED      │ u32     │ Used slots     │
 * │ 112    │ 28        │ TELEMETRY_OPS_LOW  │ u32     │ Ops count LOW  │
 * │ 116    │ 29        │ TELEMETRY_OPS_HIGH │ u32     │ Ops count HIGH │
 * │ 120    │ 30        │ YIELD_SLOT         │ u32     │ Atomics.wait   │
 * │ 124    │ 31        │ RESERVED_31        │ u32     │ Future use     │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ NODE HEAP (128+)                             nodeCapacity × 32 bytes│
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Each node: 8 × i32 = 32 bytes (doubly-linked, cache-aligned)       │
 * │   [+0] PACKED_A     : (opcode<<24)|(pitch<<16)|(vel<<8)|flags      │
 * │   [+4] BASE_TICK    : Grid-aligned timing (pre-transform)          │
 * │   [+8] DURATION     : Duration in ticks                             │
 * │   [+12] NEXT_PTR    : Byte offset to next node (0=end)             │
 * │   [+16] PREV_PTR    : Byte offset to prev node (0=head)            │
 * │   [+20] SOURCE_ID   : Editor hash / Temporal ID (TID)              │
 * │   [+24] SEQ_FLAGS   : (sequence<<8)|flags_ext (versioning)         │
 * │   [+28] LAST_PASS_ID: Generation ID for zero-alloc pruning [v1.5]  │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ IDENTITY TABLE (dynamic offset)              capacity × 8 bytes    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Linear-probe hash table: [TID: i32, NodePtr: u32] × capacity       │
 * │   TID = 0  : Empty slot                                             │
 * │   TID = -1 : Tombstone (deleted, will be cleaned on rebuild)       │
 * │   TID > 0  : Active entry (Knuth multiplicative hash)              │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ SYMBOL TABLE (dynamic offset)                capacity × 8 bytes    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Packed SourceLocation: [fileHash: i32, lineCol: i32] × capacity    │
 * │   fileHash = 0: No location stored                                  │
 * │   lineCol = (line << 16) | (column & 0xFFFF)                       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ATOMIC OPERATIONS:
 * - All fields marked [ATOMIC] in HDR use Atomics.load/store/compareExchange
 * - Chain Mutex (HDR.CHAIN_MUTEX): Protects ALL structural mutations
 * - Sequence Counter (NODE.SEQ_FLAGS): Versioned reads prevent torn data
 * - Yield Slot (HDR.YIELD_SLOT): Coordination point for Atomics.wait()
 *
 * CONCURRENCY MODEL (v1.5):
 * - Writers: Acquire Chain Mutex → Mutate → Increment SEQ → Release Mutex
 * - Readers: Versioned read loop (seq1, data, seq2) with hybrid CPU yield
 * - Dead-Man's Switch: Panic after 1M mutex iterations (crashed worker)
 * - Hash Table Rebuild: Defrag clears all tombstones, restores O(1) perf
 */

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
  /** Reserved for alignment (old FREE_LIST_PTR slot) */
  RESERVED_5: 5,
  /** [ATOMIC] 64-bit tagged pointer (version|ptr) - occupies i32 indices 6-7 */
  FREE_LIST_HEAD_LOW: 6,
  /** Upper 32 bits of FREE_LIST_HEAD (access via BigInt64Array) */
  FREE_LIST_HEAD_HIGH: 7,
  /** [ATOMIC] Commit flag: IDLE=0, PENDING=1, ACK=2 */
  COMMIT_FLAG: 8,
  /** [ATOMIC] Current playhead tick (written by AudioWorklet) */
  PLAYHEAD_TICK: 9,
  /** Safe zone distance in ticks (structural edits blocked within) */
  SAFE_ZONE_TICKS: 10,
  /** [ATOMIC] Error flag: OK=0, HEAP_EXHAUSTED=1, SAFE_ZONE=2, INVALID_PTR=3 */
  ERROR_FLAG: 11,
  /** [ATOMIC] Total allocated nodes (live chain) */
  NODE_COUNT: 12,
  /** [ATOMIC] Nodes in free list */
  FREE_COUNT: 13,
  /** Total node capacity (set at init) */
  NODE_CAPACITY: 14,
  /** Byte offset where node heap begins */
  HEAP_START: 15,

  // -------------------------------------------------------------------------
  // Extended Header Fields (v1.5) - Using REG reserved slots 23-31
  // -------------------------------------------------------------------------
  // These fields extend the header using previously reserved register slots.
  // Byte offsets are used to maintain consistency with atomic operations.

  /** [v1.5] Byte offset to Identity Table (TID → NodePtr hash map) */
  ID_TABLE_PTR: 23,
  /** [v1.5] Current generation ID for pruning (incremented on beginUpdate) */
  UPDATE_PASS_ID: 24,
  /** [v1.5] [ATOMIC] Chain Mutex for structural operations (0=unlocked, 1=locked) */
  CHAIN_MUTEX: 25,
  /** [v1.5] Identity Table capacity (total slots) */
  ID_TABLE_CAPACITY: 26,
  /** [v1.5] [ATOMIC] Identity Table used slots (active + tombstones) */
  ID_TABLE_USED: 27,
  /** [v1.5] [ATOMIC] Telemetry: Total operations LOW 32 bits */
  TELEMETRY_OPS_LOW: 28,
  /** [v1.5] [ATOMIC] Telemetry: Total operations HIGH 32 bits */
  TELEMETRY_OPS_HIGH: 29,
  /** [v1.5] Dedicated slot for Atomics.wait() yield coordination */
  YIELD_SLOT: 30,
  /** Reserved for future expansion */
  RESERVED_31: 31,

  // -------------------------------------------------------------------------
  // Command Ring Buffer Header (RFC-044)
  // -------------------------------------------------------------------------
  /** [RFC-044] [ATOMIC] Ring Buffer Read Index (Worker consumes from here) */
  RB_HEAD: 32,
  /** [RFC-044] [ATOMIC] Ring Buffer Write Index (Main Thread produces here) */
  RB_TAIL: 33,
  /** [RFC-044] Ring Buffer capacity in commands (fixed at init) */
  RB_CAPACITY: 34,
  /** [RFC-044] Byte offset to Command Ring Buffer data region */
  COMMAND_RING_PTR: 35
} as const

/**
 * Header register offsets for BigInt64Array access.
 * Use this for 64-bit atomic operations on tagged pointers.
 */
export const HDR_I64 = {
  /** 64-bit tagged pointer: (version << 32n) | (ptr & 0xFFFFFFFFn) */
  FREE_LIST_HEAD: 3 // Byte offset 24 / 8 = i64 index 3
} as const

// =============================================================================
// Register Bank Offsets (16-22) - 28 bytes = 7 × i32
// =============================================================================

/**
 * Live transform registers for VM-resident math.
 * These can be updated at any time for instant feedback.
 *
 * NOTE: Indices 23-31 are now used by Extended Header Fields (v1.5).
 * See HDR.ID_TABLE_PTR through HDR.RESERVED_31 above.
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
  PRNG_SEED: 22
  // Indices 23-31: See HDR extended fields above
} as const

// =============================================================================
// Node Heap Layout (Doubly-Linked List)
// =============================================================================

/**
 * Node structure offsets (8 × i32 = 32 bytes per node).
 *
 * 32-byte stride provides optimal cache alignment and room for
 * doubly-linked list pointers enabling O(1) deletion.
 *
 * Layout:
 * - [+0] PACKED_A: (opcode << 24) | (pitch << 16) | (velocity << 8) | flags
 * - [+1] BASE_TICK: Grid-aligned timing (pre-transform)
 * - [+2] DURATION: Duration in ticks
 * - [+3] NEXT_PTR: Byte offset to next node (0 = end of chain)
 * - [+4] PREV_PTR: Byte offset to previous node (0 = head of chain)
 * - [+5] SOURCE_ID: Editor location hash / TID for bidirectional mapping
 * - [+6] SEQ_FLAGS: (sequence << 8) | flags_extended
 * - [+7] LAST_PASS_ID: [v1.5] Generation ID for zero-alloc pruning
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
  /** Previous pointer (byte offset, 0 = head) */
  PREV_PTR: 4,
  /** Source ID (editor location hash) / Temporal ID (TID) for Identity Table */
  SOURCE_ID: 5,
  /** Sequence counter (upper 24 bits) + extended flags (lower 8 bits) */
  SEQ_FLAGS: 6,
  /** [v1.5] Last update pass ID (generation-based pruning) */
  LAST_PASS_ID: 7
} as const

/**
 * Node size in i32 units.
 */
export const NODE_SIZE_I32 = 8

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
 *
 * NOTE: Node liveness tracking is handled by LAST_PASS_ID (generation-based),
 * not by flag bits. Do not add a TOUCHED flag.
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
  INVALID_PTR: 3,
  /** [v1.5] Kernel panic: mutex deadlock or catastrophic failure */
  KERNEL_PANIC: 4,
  /** [v1.5] Identity Table load factor exceeded 75% warning */
  LOAD_FACTOR_WARNING: 5
} as const

// =============================================================================
// Identity Table (v1.5) - TID → NodePtr Hash Map
// =============================================================================

/**
 * Identity Table constants for O(1) Temporal ID lookups.
 *
 * The Identity Table is a fixed-size hash table stored in the SAB that maps
 * Temporal IDs (TID) to NodePtr values for zero-allocation lookups.
 *
 * Structure: Linear-probe hash table with [TID: i32, NodePtr: u32] entries.
 * - TID = 0: Empty slot
 * - TID = -1: Tombstone (deleted entry)
 * - TID > 0: Active entry
 */
export const ID_TABLE = {
  /** Entry size in i32 units (TID + NodePtr) */
  ENTRY_SIZE_I32: 2,
  /** Entry size in bytes */
  ENTRY_SIZE_BYTES: 8,
  /** Default capacity (4096 entries = 32KB) */
  DEFAULT_CAPACITY: 4096,
  /** Load factor threshold for warnings (0.75 = 75%) */
  LOAD_FACTOR_WARNING: 0.75,
  /** Empty slot marker */
  EMPTY_TID: 0,
  /** Tombstone marker (deleted entry) */
  TOMBSTONE_TID: -1,
  /** Knuth's multiplicative hash constant (golden ratio × 2^32) */
  KNUTH_HASH_MULTIPLIER: 2654435769
} as const

// =============================================================================
// Symbol Table (v1.5) - SourceId → Packed SourceLocation
// =============================================================================

/**
 * Symbol Table constants for storing packed SourceLocations in SAB.
 *
 * The Symbol Table is a parallel structure to the Identity Table that maps
 * sourceId → packed SourceLocation for editor integration (click-to-source).
 *
 * Packed SourceLocation format (64 bits / 2 × i32):
 * - [0] FILE_HASH: Hash of the file path (i32)
 * - [1] LINE_COL: (line << 16) | (column & 0xFFFF) (i32)
 *
 * This allows zero-allocation storage/retrieval of source locations.
 */
export const SYM_TABLE = {
  /** Entry size in i32 units (fileHash + lineCol) */
  ENTRY_SIZE_I32: 2,
  /** Entry size in bytes */
  ENTRY_SIZE_BYTES: 8,
  /** Empty entry marker (fileHash = 0 indicates no location) */
  EMPTY_ENTRY: 0,
  /** Line shift for packing into lineCol field */
  LINE_SHIFT: 16,
  /** Column mask for extracting from lineCol field */
  COLUMN_MASK: 0xffff,
  /** Maximum line number (16 bits = 65535) */
  MAX_LINE: 0xffff,
  /** Maximum column number (16 bits = 65535) */
  MAX_COLUMN: 0xffff
} as const

// =============================================================================
// Concurrency Control (v1.5)
// =============================================================================

/**
 * Concurrency control constants for lock-free and mutex-based operations.
 */
export const CONCURRENCY = {
  /** Chain Mutex: Unlocked state */
  MUTEX_UNLOCKED: 0,
  /** Chain Mutex: Locked state */
  MUTEX_LOCKED: 1,
  /** CPU yield threshold: yield after this many spins */
  YIELD_AFTER_SPINS: 100,
  /** Dead-Man's Switch: panic after this many mutex acquisition attempts (~200ms with 1ms yields) */
  MUTEX_PANIC_THRESHOLD: 200
} as const

// =============================================================================
// Command Ring Buffer (RFC-044)
// =============================================================================

/**
 * Command Ring Buffer constants for zero-blocking structural edits.
 *
 * The Command Ring is a fixed-stride circular buffer that queues structural
 * operations (INSERT, DELETE, PATCH, CLEAR) from the Main Thread to the Worker.
 *
 * Each command occupies exactly 4 × i32 (16 bytes) for alignment:
 * [OPCODE, PARAM_1, PARAM_2, RESERVED]
 */
export const COMMAND = {
  /** Command stride in bytes (16 bytes for 4 × i32) */
  STRIDE_BYTES: 16,
  /** Command stride in i32 units (4 words) */
  STRIDE_I32: 4,
  /** Default ring buffer size in bytes (64KB = 4096 commands) */
  DEFAULT_RING_SIZE_BYTES: 65536
} as const

/**
 * Default number of commands that can be queued (64KB / 16 bytes).
 */
export const DEFAULT_RING_CAPACITY = COMMAND.DEFAULT_RING_SIZE_BYTES / COMMAND.STRIDE_BYTES

/**
 * Calculate the Zone Split Index for partitioned heap allocation (RFC-044).
 *
 * The node heap is partitioned into two zones to eliminate allocation contention:
 * - **Zone A (Kernel)**: Indices 0 to ZONE_SPLIT_INDEX - 1 (Worker/Audio Thread)
 * - **Zone B (UI)**: Indices ZONE_SPLIT_INDEX to nodeCapacity - 1 (Main Thread)
 *
 * This allows lock-free allocation: Worker uses CAS-based free list in Zone A,
 * Main Thread uses bump allocator in Zone B.
 *
 * @param nodeCapacity - Maximum number of nodes
 * @returns Index where Zone B begins (typically nodeCapacity / 2)
 */
export function getZoneSplitIndex(nodeCapacity: number): number {
  return Math.floor(nodeCapacity / 2)
}

// =============================================================================
// Memory Layout Calculation
// =============================================================================

/**
 * Calculate total SAB size needed for given node capacity.
 *
 * Layout:
 * - Header + Registers + Command Ring Header: 144 bytes (36 × i32)
 * - Node Heap: nodeCapacity × 32 bytes
 * - Identity Table: nodeCapacity × 8 bytes (TID + NodePtr per entry)
 * - Symbol Table: nodeCapacity × 8 bytes (fileHash + lineCol per entry)
 * - Groove Templates: 1024 bytes (fixed)
 * - Command Ring Buffer: 64KB (RFC-044)
 *
 * @param nodeCapacity - Maximum number of nodes
 * @returns Total bytes needed for SharedArrayBuffer
 */
export function calculateSABSize(nodeCapacity: number): number {
  const headerSize = HEAP_START_OFFSET // 144 bytes (includes header + registers + command ring header)
  const heapSize = nodeCapacity * NODE_SIZE_BYTES
  const identityTableSize = nodeCapacity * ID_TABLE.ENTRY_SIZE_BYTES // 8 bytes per entry
  const symbolTableSize = nodeCapacity * SYM_TABLE.ENTRY_SIZE_BYTES // 8 bytes per entry
  const grooveSize = 1024 // Fixed groove template region
  const ringBufferSize = COMMAND.DEFAULT_RING_SIZE_BYTES // 64KB command ring (RFC-044)
  return headerSize + heapSize + identityTableSize + symbolTableSize + grooveSize + ringBufferSize
}

/**
 * Calculate byte offset where node heap begins.
 * Header (64) + Registers (64) + Command Ring Header (16) = 144 bytes.
 * Indices 0-35 = 36 × 4 bytes = 144 bytes.
 */
export const HEAP_START_OFFSET = 144

/**
 * Calculate i32 index where node heap begins.
 */
export const HEAP_START_I32 = HEAP_START_OFFSET / 4

/**
 * Calculate byte offset where Identity Table begins.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Identity Table
 */
export function getIdentityTableOffset(nodeCapacity: number): number {
  return HEAP_START_OFFSET + nodeCapacity * NODE_SIZE_BYTES
}

/**
 * Calculate byte offset where Symbol Table begins.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Symbol Table
 */
export function getSymbolTableOffset(nodeCapacity: number): number {
  return getIdentityTableOffset(nodeCapacity) + nodeCapacity * ID_TABLE.ENTRY_SIZE_BYTES
}

/**
 * Calculate byte offset where Groove Templates begin.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Groove Templates
 */
export function getGrooveTemplateOffset(nodeCapacity: number): number {
  return getSymbolTableOffset(nodeCapacity) + nodeCapacity * SYM_TABLE.ENTRY_SIZE_BYTES
}

/**
 * Calculate byte offset where Command Ring Buffer data begins (RFC-044).
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Command Ring Buffer data region
 */
export function getRingBufferOffset(nodeCapacity: number): number {
  return getGrooveTemplateOffset(nodeCapacity) + 1024 // Groove size is fixed at 1024 bytes
}

// =============================================================================
// Type Exports
// =============================================================================

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE]
export type CommitState = (typeof COMMIT)[keyof typeof COMMIT]
export type ErrorCode = (typeof ERROR)[keyof typeof ERROR]
export type NodeFlag = (typeof FLAG)[keyof typeof FLAG]
