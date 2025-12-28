/**
 * Magic number identifying Silicon Linker SAB format: "SYMB" as ASCII bytes.
 */
export declare const SL_MAGIC = 1398361410;
/**
 * Current Silicon Linker format version.
 */
export declare const SL_VERSION = 1;
/**
 * Default pulses per quarter note.
 */
export declare const DEFAULT_PPQ = 480;
/**
 * Default tempo in BPM.
 */
export declare const DEFAULT_BPM = 120;
/**
 * Default safe zone in ticks (2 beats at 480 PPQ).
 */
export declare const DEFAULT_SAFE_ZONE_TICKS = 960;
/**
 * Null pointer value (end of chain / empty).
 */
export declare const NULL_PTR = 0;
/**
 * Knuth's multiplicative hash constant (golden ratio × 2^32).
 * Used for all hash table operations (Identity Table, Synapse Table).
 * Value: floor(2^32 / φ) where φ = (1 + √5) / 2 = 0x9E3779B1
 *
 * RFC-045-01: This is the canonical constant for all hash operations.
 */
export declare const KNUTH_HASH_CONST = 2654435761;
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
 * │ 124    │ 31        │ PLAYBACK_OFFSET    │ u32     │ Latency (ms)   │
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
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ GROOVE TEMPLATES (dynamic offset)                      1024 bytes  │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Fixed-size region for groove template patterns (humanization)      │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ COMMAND RING BUFFER (dynamic offset) [RFC-044]        64KB        │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Circular buffer for zero-blocking structural edits (4096 commands) │
 * │ Each command: 4 × i32 = 16 bytes [OPCODE, PARAM_1, PARAM_2, RSV]  │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ SYNAPSE TABLE (dynamic offset) [RFC-045]               1MB        │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ The Silicon Brain: Linear-probe hash table (65536 synapses)        │
 * │ Each synapse: 4 × i32 = 16 bytes (neuromorphic connection)        │
 * │   [+0] SOURCE_PTR   : Trigger node (hash key for lookup)          │
 * │   [+4] TARGET_PTR   : Destination node (signal target)            │
 * │   [+8] WEIGHT_DATA  : weight(16b) | jitter(16b)                   │
 * │   [+12] META_NEXT   : plasticity(8b) | nextSynapse(24b)           │
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
/**
 * Header register offsets within the SAB.
 * All offsets are i32 indices (multiply by 4 for byte offset).
 */
export declare const HDR: {
    /** Magic number (0x53594D42 = "SYMB") */
    readonly MAGIC: 0;
    /** Format version */
    readonly VERSION: 1;
    /** Pulses per quarter note */
    readonly PPQ: 2;
    /** Tempo in BPM (can be updated live) */
    readonly BPM: 3;
    /** [ATOMIC] Byte offset to first node in chain (0 = empty) */
    readonly HEAD_PTR: 4;
    /** Reserved for alignment (old FREE_LIST_PTR slot) */
    readonly RESERVED_5: 5;
    /** [ATOMIC] 64-bit tagged pointer (version|ptr) - occupies i32 indices 6-7 */
    readonly FREE_LIST_HEAD_LOW: 6;
    /** Upper 32 bits of FREE_LIST_HEAD (access via BigInt64Array) */
    readonly FREE_LIST_HEAD_HIGH: 7;
    /** [ATOMIC] Commit flag: IDLE=0, PENDING=1, ACK=2 */
    readonly COMMIT_FLAG: 8;
    /** [ATOMIC] Current playhead tick (written by AudioWorklet) */
    readonly PLAYHEAD_TICK: 9;
    /** Safe zone distance in ticks (structural edits blocked within) */
    readonly SAFE_ZONE_TICKS: 10;
    /** [ATOMIC] Error flag: OK=0, HEAP_EXHAUSTED=1, SAFE_ZONE=2, INVALID_PTR=3 */
    readonly ERROR_FLAG: 11;
    /** [ATOMIC] Total allocated nodes (live chain) */
    readonly NODE_COUNT: 12;
    /** [ATOMIC] Nodes in free list */
    readonly FREE_COUNT: 13;
    /** Total node capacity (set at init) */
    readonly NODE_CAPACITY: 14;
    /** Byte offset where node heap begins */
    readonly HEAP_START: 15;
    /** [v1.5] Byte offset to Identity Table (TID → NodePtr hash map) */
    readonly ID_TABLE_PTR: 23;
    /** [v1.5] Current generation ID for pruning (incremented on beginUpdate) */
    readonly UPDATE_PASS_ID: 24;
    /** [v1.5] [ATOMIC] Chain Mutex for structural operations (0=unlocked, 1=locked) */
    readonly CHAIN_MUTEX: 25;
    /** [v1.5] Identity Table capacity (total slots) */
    readonly ID_TABLE_CAPACITY: 26;
    /** [v1.5] [ATOMIC] Identity Table used slots (active + tombstones) */
    readonly ID_TABLE_USED: 27;
    /** [v1.5] [ATOMIC] Telemetry: Total operations LOW 32 bits */
    readonly TELEMETRY_OPS_LOW: 28;
    /** [v1.5] [ATOMIC] Telemetry: Total operations HIGH 32 bits */
    readonly TELEMETRY_OPS_HIGH: 29;
    /** [v1.5] Dedicated slot for Atomics.wait() yield coordination */
    readonly YIELD_SLOT: 30;
    /** [RFC-047 Phase 8 Task 4] Playback offset in milliseconds for latency compensation */
    readonly PLAYBACK_OFFSET: 31;
    /** [RFC-044] [ATOMIC] Ring Buffer Read Index (Worker consumes from here) */
    readonly RB_HEAD: 32;
    /** [RFC-044] [ATOMIC] Ring Buffer Write Index (Main Thread produces here) */
    readonly RB_TAIL: 33;
    /** [RFC-044] Ring Buffer capacity in commands (fixed at init) */
    readonly RB_CAPACITY: 34;
    /** [RFC-044] Byte offset to Command Ring Buffer data region */
    readonly COMMAND_RING_PTR: 35;
};
/**
 * Header register offsets for BigInt64Array access.
 * Use this for 64-bit atomic operations on tagged pointers.
 */
export declare const HDR_I64: {
    /** 64-bit tagged pointer: (version << 32n) | (ptr & 0xFFFFFFFFn) */
    readonly FREE_LIST_HEAD: 3;
};
/**
 * Live transform registers for VM-resident math.
 * These can be updated at any time for instant feedback.
 *
 * NOTE: Indices 23-31 are now used by Extended Header Fields (v1.5).
 * See HDR.ID_TABLE_PTR through HDR.RESERVED_31 above.
 */
export declare const REG: {
    /** Byte offset to active groove template (0 = no groove) */
    readonly GROOVE_PTR: 16;
    /** Groove template length in steps */
    readonly GROOVE_LEN: 17;
    /** Humanize timing jitter (parts per thousand of PPQ) */
    readonly HUMAN_TIMING_PPT: 18;
    /** Humanize velocity jitter (parts per thousand) */
    readonly HUMAN_VEL_PPT: 19;
    /** Global transposition in semitones (signed) */
    readonly TRANSPOSE: 20;
    /** Global velocity multiplier (parts per thousand, 1000 = 1.0) */
    readonly VELOCITY_MULT: 21;
    /** PRNG seed for deterministic humanization */
    readonly PRNG_SEED: 22;
};
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
export declare const NODE: {
    /** Packed opcode, pitch, velocity, flags */
    readonly PACKED_A: 0;
    /** Base tick (grid-aligned, pre-transform) */
    readonly BASE_TICK: 1;
    /** Duration in ticks */
    readonly DURATION: 2;
    /** Next pointer (byte offset, 0 = end) */
    readonly NEXT_PTR: 3;
    /** Previous pointer (byte offset, 0 = head) */
    readonly PREV_PTR: 4;
    /** Source ID (editor location hash) / Temporal ID (TID) for Identity Table */
    readonly SOURCE_ID: 5;
    /** Sequence counter (upper 24 bits) + extended flags (lower 8 bits) */
    readonly SEQ_FLAGS: 6;
    /** [v1.5] Last update pass ID (generation-based pruning) */
    readonly LAST_PASS_ID: 7;
};
/**
 * Node size in i32 units.
 */
export declare const NODE_SIZE_I32 = 8;
/**
 * Node size in bytes.
 */
export declare const NODE_SIZE_BYTES: number;
/**
 * PACKED_A field bit positions and masks.
 * Format: (opcode << 24) | (pitch << 16) | (velocity << 8) | flags
 */
export declare const PACKED: {
    /** Opcode: bits 24-31 */
    readonly OPCODE_SHIFT: 24;
    readonly OPCODE_MASK: 4278190080;
    /** Pitch: bits 16-23 */
    readonly PITCH_SHIFT: 16;
    readonly PITCH_MASK: 16711680;
    /** Velocity: bits 8-15 */
    readonly VELOCITY_SHIFT: 8;
    readonly VELOCITY_MASK: 65280;
    /** Flags: bits 0-7 */
    readonly FLAGS_MASK: 255;
};
/**
 * SEQ_FLAGS field bit positions.
 * Format: (sequence << 8) | flags_extended
 */
export declare const SEQ: {
    /** Sequence counter: bits 8-31 (24-bit counter) */
    readonly SEQ_SHIFT: 8;
    readonly SEQ_MASK: 4294967040;
    /** Extended flags: bits 0-7 */
    readonly FLAGS_EXT_MASK: 255;
};
/**
 * Node flags (lower 8 bits of PACKED_A).
 *
 * NOTE: Node liveness tracking is handled by LAST_PASS_ID (generation-based),
 * not by flag bits. Do not add a TOUCHED flag.
 */
export declare const FLAG: {
    /** Node is active (not deleted) */
    readonly ACTIVE: 1;
    /** Node is muted (skip during playback) */
    readonly MUTED: 2;
    /** Write in progress (consumer should spin/skip) */
    readonly DIRTY: 4;
    /** [RFC-047] Packed Expression ID (4 bits: 0-15) */
    readonly EXPRESSION_SHIFT: 4;
    readonly EXPRESSION_MASK: 240;
};
/**
 * Node opcodes (upper 8 bits of PACKED_A).
 */
export declare const OPCODE: {
    /** Note event */
    readonly NOTE: 1;
    /** Rest (silent duration) */
    readonly REST: 2;
    /** Control change */
    readonly CC: 3;
    /** Pitch bend */
    readonly BEND: 4;
};
/**
 * COMMIT_FLAG states for structural edit synchronization.
 */
export declare const COMMIT: {
    /** No pending structural changes */
    readonly IDLE: 0;
    /** Structural change complete, awaiting ACK */
    readonly PENDING: 1;
    /** Consumer acknowledged, Linker can clear */
    readonly ACK: 2;
};
/**
 * ERROR_FLAG values.
 */
export declare const ERROR: {
    /** No error */
    readonly OK: 0;
    /** Heap exhausted (no free nodes) */
    readonly HEAP_EXHAUSTED: 1;
    /** Safe zone violation (edit too close to playhead) */
    readonly SAFE_ZONE: 2;
    /** Invalid pointer encountered */
    readonly INVALID_PTR: 3;
    /** [v1.5] Kernel panic: mutex deadlock or catastrophic failure */
    readonly KERNEL_PANIC: 4;
    /** [v1.5] Identity Table load factor exceeded 75% warning */
    readonly LOAD_FACTOR_WARNING: 5;
    /** [RFC-045-04] Free list corruption detected */
    readonly FREE_LIST_CORRUPT: 6;
    /** [RFC-045-04] Unknown command opcode received */
    readonly UNKNOWN_OPCODE: 7;
};
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
export declare const ID_TABLE: {
    /** Entry size in i32 units (TID + NodePtr) */
    readonly ENTRY_SIZE_I32: 2;
    /** Entry size in bytes */
    readonly ENTRY_SIZE_BYTES: 8;
    /** Default capacity (4096 entries = 32KB) */
    readonly DEFAULT_CAPACITY: 4096;
    /** Load factor threshold for warnings (0.75 = 75%) */
    readonly LOAD_FACTOR_WARNING: 0.75;
    /** Empty slot marker */
    readonly EMPTY_TID: 0;
    /** Tombstone marker (deleted entry) */
    readonly TOMBSTONE_TID: -1;
};
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
export declare const SYM_TABLE: {
    /** Entry size in i32 units (fileHash + lineCol) */
    readonly ENTRY_SIZE_I32: 2;
    /** Entry size in bytes */
    readonly ENTRY_SIZE_BYTES: 8;
    /** Empty entry marker (fileHash = 0 indicates no location) */
    readonly EMPTY_ENTRY: 0;
    /** Line shift for packing into lineCol field */
    readonly LINE_SHIFT: 16;
    /** Column mask for extracting from lineCol field */
    readonly COLUMN_MASK: 65535;
    /** Maximum line number (16 bits = 65535) */
    readonly MAX_LINE: 65535;
    /** Maximum column number (16 bits = 65535) */
    readonly MAX_COLUMN: 65535;
};
/**
 * Concurrency control constants for lock-free and mutex-based operations.
 */
export declare const CONCURRENCY: {
    /** Chain Mutex: Unlocked state */
    readonly MUTEX_UNLOCKED: 0;
    /** Chain Mutex: Locked state */
    readonly MUTEX_LOCKED: 1;
    /** CPU yield threshold: yield after this many spins */
    readonly YIELD_AFTER_SPINS: 100;
    /** Dead-Man's Switch: panic after this many mutex acquisition attempts (~200ms with 1ms yields) */
    readonly MUTEX_PANIC_THRESHOLD: 200;
    /** [RFC-045-04] Maximum spins for audio-safe try-lock (~300ns, sub-microsecond) */
    readonly AUDIO_SAFE_MAX_SPINS: 3;
};
/**
 * Source ID range constants for positive Int32 enforcement.
 *
 * SourceIds must fit in the positive Int32 range (1 to 2^31-1).
 * After 2,147,483,647 IDs, the counter wraps around to MIN.
 */
export declare const SOURCE_ID: {
    /** Minimum valid source ID (0 is reserved for NULL) */
    readonly MIN: 1;
    /** Maximum valid source ID (Int32 positive range) */
    readonly MAX: 2147483647;
    /** Wraparound point: restart from MIN when MAX is exceeded */
    readonly WRAP_THRESHOLD: 2147483647;
};
/**
 * Command Ring Buffer constants for zero-blocking structural edits.
 *
 * The Command Ring is a fixed-stride circular buffer that queues structural
 * operations (INSERT, DELETE, PATCH, CLEAR) from the Main Thread to the Worker.
 *
 * Each command occupies exactly 4 × i32 (16 bytes) for alignment:
 * [OPCODE, PARAM_1, PARAM_2, RESERVED]
 */
export declare const COMMAND: {
    /** Command stride in bytes (16 bytes for 4 × i32) */
    readonly STRIDE_BYTES: 16;
    /** Command stride in i32 units (4 words) */
    readonly STRIDE_I32: 4;
    /** Default ring buffer size in bytes (64KB = 4096 commands) */
    readonly DEFAULT_RING_SIZE_BYTES: 65536;
};
/**
 * Synapse Table constants for the "Silicon Brain" Neural Audio Processor.
 *
 * The Synapse Table is a 1.25MB linear-probe hash table that connects musical
 * "Axons" (Clips) via probabilistic "Synapses" (Connections). This enables
 * non-linear, generative music where clips trigger each other based on weights,
 * jitter, and plasticity.
 *
 * Each Synapse occupies exactly 20 bytes (5 × i32) with tightly packed fields:
 * - SOURCE_PTR: The trigger node (end of clip) - used as hash key
 * - TARGET_PTR: The destination node (start of next clip)
 * - WEIGHT_DATA: Packed [Weight (16b) | Jitter (16b)]
 * - META_NEXT: Packed [Plasticity Flags (8b) | Next Synapse Ptr (24b)]
 * - NEXT_SAME_TARGET: Slot index for reverse index linked list (synapses TO same target)
 */
export declare const SYNAPSE_TABLE: {
    /** Synapse Table size in bytes (~1.25MB for 65536 × 20 bytes) */
    readonly SIZE_BYTES: 1310720;
    /** Maximum number of synapses */
    readonly MAX_CAPACITY: 65536;
    /** Synapse stride in bytes (20 bytes for 5 × i32) */
    readonly STRIDE_BYTES: 20;
    /** Synapse stride in i32 units (5 words) */
    readonly STRIDE_I32: 5;
    /** Trigger compaction when tombstones exceed this ratio (ISSUE-021) */
    readonly COMPACTION_THRESHOLD: 0.5;
    /** Minimum slots before compaction is worthwhile (ISSUE-021) */
    readonly COMPACTION_MIN_SLOTS: 100;
};
/**
 * Synapse structure offsets (5 × i32 = 20 bytes per synapse).
 *
 * The Synapse struct represents a connection between two Axons (clips) in the
 * neural topology. It is tightly packed for cache efficiency and atomic operations.
 *
 * Layout:
 * - [+0] SOURCE_PTR: Byte offset to trigger node (hash key for lookup)
 * - [+1] TARGET_PTR: Byte offset to destination node
 * - [+2] WEIGHT_DATA: Packed (weight << 0) | (jitter << 16)
 * - [+3] META_NEXT: Packed (plasticity << 0) | (nextSynapse << 8)
 * - [+4] NEXT_SAME_TARGET: Slot index for reverse index linked list (-1 = end)
 */
export declare const SYNAPSE: {
    /** Source node pointer (trigger point, used as hash key) */
    readonly SOURCE_PTR: 0;
    /** Target node pointer (destination for signal propagation) */
    readonly TARGET_PTR: 1;
    /** Packed weight (0-1000) and jitter (0-65535) data */
    readonly WEIGHT_DATA: 2;
    /** Packed plasticity flags (8 bits) and next synapse pointer (24 bits) for SOURCE chain */
    readonly META_NEXT: 3;
    /** Slot index of next synapse with same TARGET (reverse index), -1 = end of list */
    readonly NEXT_SAME_TARGET: 4;
};
/**
 * Synapse packing constants for atomic bit manipulation.
 *
 * These constants enable efficient packing/unpacking of multiple fields into
 * single 32-bit integers for cache-aligned, atomic operations.
 *
 * WEIGHT_DATA packing (i32 at offset 2):
 * - Bits 0-15:  Weight (0-1000 fixed-point probability/intensity)
 * - Bits 16-31: Jitter (0-65535 micro-timing deviation in ticks)
 *
 * META_NEXT packing (i32 at offset 3):
 * - Bits 0-7:   Plasticity flags (learning/potentiation state)
 * - Bits 8-31:  Next synapse pointer (24-bit collision chain index)
 */
export declare const SYN_PACK: {
    /** Weight field: bits 0-15 (0-1000 fixed-point, 0.0 to 1.0) */
    readonly WEIGHT_MASK: 65535;
    readonly WEIGHT_SHIFT: 0;
    /** Jitter field: bits 16-31 (0-65535 ticks micro-timing deviation) */
    readonly JITTER_MASK: 65535;
    readonly JITTER_SHIFT: 16;
    /** Plasticity flags: bits 0-7 (learning state, potentiation markers) */
    readonly PLASTICITY_MASK: 255;
    readonly PLASTICITY_SHIFT: 0;
    /** Next synapse pointer: bits 8-31 (24-bit index for collision chain) */
    readonly NEXT_PTR_MASK: 16777215;
    readonly NEXT_PTR_SHIFT: 8;
};
/**
 * Synapse execution safety quotas to prevent infinite loops in Audio Thread.
 *
 * The Kernel tracks how many synapses have fired in the current audio block.
 * If this quota is exceeded, synaptic resolution aborts to guarantee real-time
 * performance (prevents runaway feedback loops or recursive synapse chains).
 */
export declare const SYNAPSE_QUOTA: {
    /** Maximum synapses that can fire per audio block (default: 64) */
    readonly MAX_FIRES_PER_BLOCK: 64;
};
/**
 * Reverse Index constants for O(k) disconnectAllToTarget() (RFC-045-04 ISSUE-016).
 *
 * The Reverse Index is a hash table that maps TARGET_PTR → linked list of synapses.
 * This enables O(k) disconnect operations where k = number of synapses pointing
 * to a target, instead of O(65536) full table scan.
 *
 * Memory Layout:
 * - 256 buckets × 4 bytes = 1KB total
 * - Each bucket stores the head slot index of a linked list
 * - Synapses in the same bucket are chained via NEXT_SAME_TARGET field
 */
export declare const REVERSE_INDEX: {
    /** Number of hash buckets (power of 2 for fast modulo) */
    readonly BUCKET_COUNT: 256;
    /** Bitmask for bucket index calculation (BUCKET_COUNT - 1) */
    readonly BUCKET_MASK: 255;
    /** Stride per bucket in i32 units (1 word = slot index) */
    readonly STRIDE_I32: 1;
    /** Sentinel value for empty bucket or end of list */
    readonly EMPTY: -1;
};
/**
 * Calculate the byte offset to the Reverse Index table in the SAB.
 *
 * Layout: [Header][Nodes][IdTable][SymTable][RingBuffer][SynapseTable][ReverseIndex]
 *
 * @param nodeCapacity - Number of nodes in the SAB
 * @returns Byte offset to the start of the Reverse Index table
 */
export declare function getReverseIndexOffset(nodeCapacity: number): number;
/**
 * SiliconBridge error codes (zero-allocation error handling).
 * Methods return these instead of throwing exceptions.
 */
export declare const BRIDGE_ERR: {
    /** Operation succeeded */
    readonly OK: 0;
    /** Source/target ID not found in Identity Table */
    readonly NOT_FOUND: -1;
    /** Synapse Table full */
    readonly TABLE_FULL: -2;
    /** Invalid pointer */
    readonly INVALID_PTR: -3;
};
/**
 * SynapseAllocator error codes (zero-allocation error handling).
 * connect() returns these instead of throwing exceptions.
 */
export declare const SYNAPSE_ERR: {
    /** Operation succeeded (positive value is SynapsePtr) */
    readonly OK: 0;
    /** Invalid source or target pointer */
    readonly INVALID_PTR: -1;
    /** Synapse Table full */
    readonly TABLE_FULL: -2;
    /** Infinite loop detected in chain traversal */
    readonly CHAIN_LOOP: -3;
};
/**
 * LocalAllocator error codes (zero-allocation error handling).
 * alloc() returns these instead of throwing exceptions.
 */
export declare const ALLOC_ERR: {
    /** Zone B heap exhausted */
    readonly EXHAUSTED: -1;
};
/**
 * Default number of commands that can be queued (64KB / 16 bytes).
 */
export declare const DEFAULT_RING_CAPACITY: number;
/**
 * Command opcodes for Ring Buffer protocol (RFC-044).
 *
 * These opcodes are written to the Command Ring Buffer by the Main Thread
 * and processed by the Worker Thread to perform deferred structural operations.
 *
 * **Protocol:**
 * - Main Thread: Allocates node in Zone B, writes data, enqueues command
 * - Worker Thread: Dequeues command, links node into chain, updates Identity Table
 *
 * Each command has the format: [OPCODE, PARAM_1, PARAM_2, RESERVED]
 */
export declare const CMD: {
    /** Insert a floating node into the chain at a specific position */
    readonly INSERT: 1;
    /** Delete a node from the chain (returns to Zone A free list) */
    readonly DELETE: 2;
    /** Patch node attributes atomically (deferred/batched updates) */
    readonly PATCH: 3;
    /** Clear all nodes from the chain (mass delete) */
    readonly CLEAR: 4;
};
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
export declare function getZoneSplitIndex(nodeCapacity: number): number;
/**
 * Calculate total SAB size needed for given node capacity.
 *
 * Layout:
 * - Header + Registers + Command Ring Header: 144 bytes (36 × i32)
 * - Node Heap: nodeCapacity × 32 bytes
 * - Identity Table: nodeCapacity × 2 × 8 bytes (RFC-047-50: 2x capacity for load factor)
 * - Symbol Table: nodeCapacity × 8 bytes (fileHash + lineCol per entry)
 * - Groove Templates: 1024 bytes (fixed)
 * - Command Ring Buffer: 64KB (RFC-044)
 * - Synapse Table: 1MB (RFC-045) - Neural connection graph
 *
 * @param nodeCapacity - Maximum number of nodes
 * @returns Total bytes needed for SharedArrayBuffer
 */
export declare function calculateSABSize(nodeCapacity: number): number;
/**
 * Calculate byte offset where node heap begins.
 * Header (64) + Registers (64) + Command Ring Header (16) = 144 bytes.
 * Indices 0-35 = 36 × 4 bytes = 144 bytes.
 */
export declare const HEAP_START_OFFSET = 144;
/**
 * Calculate i32 index where node heap begins.
 */
export declare const HEAP_START_I32: number;
/**
 * Calculate byte offset where Identity Table begins.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Identity Table
 */
export declare function getIdentityTableOffset(nodeCapacity: number): number;
/**
 * Calculate byte offset where Symbol Table begins.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Symbol Table
 */
export declare function getSymbolTableOffset(nodeCapacity: number): number;
/**
 * Calculate byte offset where Groove Templates begin.
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Groove Templates
 */
export declare function getGrooveTemplateOffset(nodeCapacity: number): number;
/**
 * Calculate byte offset where Command Ring Buffer data begins (RFC-044).
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Command Ring Buffer data region
 */
export declare function getRingBufferOffset(nodeCapacity: number): number;
/**
 * Calculate byte offset where Synapse Table begins (RFC-045).
 *
 * The Synapse Table is a 1MB linear-probe hash table that stores neural
 * connections between Axons (clips). It resides immediately after the
 * Command Ring Buffer in the SharedArrayBuffer.
 *
 * @param nodeCapacity - Maximum number of nodes
 * @returns Byte offset to Synapse Table
 */
export declare function getSynapseTableOffset(nodeCapacity: number): number;
export type Opcode = (typeof OPCODE)[keyof typeof OPCODE];
export type CommitState = (typeof COMMIT)[keyof typeof COMMIT];
export type ErrorCode = (typeof ERROR)[keyof typeof ERROR];
export type NodeFlag = (typeof FLAG)[keyof typeof FLAG];
//# sourceMappingURL=constants.d.ts.map