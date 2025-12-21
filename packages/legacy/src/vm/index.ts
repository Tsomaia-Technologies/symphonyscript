// =============================================================================
// SymphonyScript - VM Module (RFC-038)
// =============================================================================
// Symphony Bytecode (SBC) Virtual Machine with unified memory architecture.

// --- Assembler ---
export { assembleToBytecode } from './assembler'

// --- Runtime ---
export { BytecodeVM } from './runtime'

// --- Consumer ---
export { SBCConsumer } from './consumer'

// --- Constants ---
export {
  // Magic and version
  SBC_MAGIC,
  SBC_VERSION,
  DEFAULT_PPQ,
  DEFAULT_BPM,

  // Register offsets
  REG,

  // Region offsets
  REGION,

  // Frame sizes
  STACK_FRAME_SIZE,
  LOOP_FRAME_SIZE,
  EVENT_SIZE,
  TEMPO_ENTRY_SIZE,
  MAX_STACK_FRAMES,
  MAX_LOOP_FRAMES,
  MAX_TRANSPOSE_DEPTH,

  // VM states
  STATE,

  // Event types
  EVENT_TYPE,

  // Opcodes
  OP
} from './constants'

// --- Types ---
export type {
  VMEvent,
  VMNoteEvent,
  VMControlEvent,
  VMBendEvent,
  AssemblerOptions,
  VMStateValue
} from './types'

export type {
  OpCode,
  StateCode,
  EventTypeCode
} from './constants'
