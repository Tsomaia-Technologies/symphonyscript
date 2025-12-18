// =============================================================================
// SymphonyScript - Builder Constants (RFC-040)
// =============================================================================
// Transform context opcodes and note modifier opcodes for the zero-allocation
// bytecode builder. These are processed at build() time and do NOT appear in
// VM bytecode.

/**
 * Builder-specific opcodes for transforms.
 * These are processed during bytecode-to-bytecode compilation.
 */
export const BUILDER_OP = {
  // --- Transform Context Opcodes (Block-Scoped: 0x60-0x6F) ---
  /** Push humanize context onto stack */
  HUMANIZE_PUSH: 0x60,
  /** Pop humanize context from stack */
  HUMANIZE_POP: 0x61,
  /** Push quantize context onto stack */
  QUANTIZE_PUSH: 0x62,
  /** Pop quantize context from stack */
  QUANTIZE_POP: 0x63,
  /** Push groove context onto stack */
  GROOVE_PUSH: 0x64,
  /** Pop groove context from stack */
  GROOVE_POP: 0x65,

  // --- Note Modifier Opcodes (Atomic: 0x70-0x7F) ---
  /** Atomic humanize modifier for preceding NOTE */
  NOTE_MOD_HUMANIZE: 0x70,
  /** Atomic quantize modifier for preceding NOTE */
  NOTE_MOD_QUANTIZE: 0x71,
  /** Atomic groove modifier for preceding NOTE (uses registered index) */
  NOTE_MOD_GROOVE: 0x72,
} as const

/**
 * Type for builder opcode values.
 */
export type BuilderOpCode = typeof BUILDER_OP[keyof typeof BUILDER_OP]

/**
 * Check if an opcode is a transform context opcode (0x60-0x6F).
 */
export function isTransformContextOp(opcode: number): boolean {
  return opcode >= 0x60 && opcode <= 0x6f
}

/**
 * Check if an opcode is a note modifier opcode (0x70-0x7F).
 */
export function isNoteModifierOp(opcode: number): boolean {
  return opcode >= 0x70 && opcode <= 0x7f
}
