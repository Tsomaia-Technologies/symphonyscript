// =============================================================================
// SymphonyScript - Silicon Linker Module (RFC-043)
// =============================================================================
// Direct-to-Silicon Mirroring for zero-latency live coding.

// Main class
export { SiliconSynapse } from './silicon-synapse'

// Constants
export {
  // Magic & Version
  SL_MAGIC,
  SL_VERSION,
  // Defaults
  DEFAULT_PPQ,
  DEFAULT_BPM,
  DEFAULT_SAFE_ZONE_TICKS,
  NULL_PTR,
  // Hash constant (RFC-045)
  KNUTH_HASH_CONST,
  // Header offsets
  HDR,
  // Register offsets
  REG,
  // Node structure
  NODE,
  NODE_SIZE_I32,
  NODE_SIZE_BYTES,
  // Packed field layouts
  PACKED,
  SEQ,
  // Flags
  FLAG,
  // Opcodes
  OPCODE,
  // Commit protocol
  COMMIT,
  // Error codes
  ERROR,
  // Memory calculation
  calculateSABSize,
  HEAP_START_OFFSET,
  HEAP_START_I32,
  // RFC-044: Command Ring & Zone Partitioning
  COMMAND,
  CMD,
  DEFAULT_RING_CAPACITY,
  getZoneSplitIndex,
  getRingBufferOffset,
  // RFC-045: Synapse Table & Reverse Index (ISSUE-016)
  SYNAPSE_TABLE,
  SYNAPSE,
  REVERSE_INDEX,
  getReverseIndexOffset,

  SYN_PACK,
  SYNAPSE_QUOTA,

  getSynapseTableOffset,
} from './constants'

// Types from constants
export type { Opcode, CommitState, ErrorCode, NodeFlag } from './constants'

// Types from types module
export type {
  NodePtr,
  SynapsePtr,
  PlasticityCallback,
  SynapseResolutionCallback,
  LinkerConfig,
  EditResult,
  ISiliconLinker
} from './types'

// RFC-045-04: Error classes removed - using error codes via ERROR constant instead

// Initialization
export {
  createLinkerSAB,
  validateLinkerSAB,
  getLinkerConfig,
  resetLinkerSAB,
  writeGrooveTemplate,
  readGrooveTemplate
} from './init'

// Low-level components (for advanced use)
export { FreeList } from './free-list'
export { AttributePatcher } from './patch'

// RFC-044: Command Ring Architecture
export { LocalAllocator } from './local-allocator'
export { RingBuffer } from './ring-buffer'

// RFC-045: Synapse Graph (Neural Audio Processor)
export { SynapseAllocator } from './synapse-allocator'

// Testing utilities
export { MockConsumer } from './mock-consumer'
export type { ConsumerNoteEvent } from './mock-consumer'

// Silicon Bridge (RFC-043 Phase 4)
export { SiliconBridge, createSiliconBridge } from './silicon-bridge'
export type {
  SourceLocation,
  EditorNoteData,
  PatchType,
  SiliconBridgeOptions,
  // RFC-045: Synapse Graph types
  SynapseOptions,

// RFC-045-04: Zero-allocation snapshot types
  BrainSnapshotArrays,
} from './silicon-bridge'
