// =============================================================================
// SymphonyScript - Builder Module (RFC-040)
// =============================================================================

// --- Classes ---
export { ClipBuilder } from './ClipBuilder'
export { MelodyBuilder } from './MelodyBuilder'
export { NoteCursor } from './NoteCursor'

// --- Constants ---
export { BUILDER_OP, isTransformContextOp, isNoteModifierOp } from './constants'
export type { BuilderOpCode } from './constants'

// --- Types ---
export type {
  BuildOptions,
  HumanizeSettings,
  QuantizeOptions,
  HumanizeContext,
  QuantizeContext,
  GrooveContext,
  ExtractedEvent,
  StructuralEvent,
  BuilderGrooveTemplate,
  NoteDuration
} from './types'

// --- Compiler ---
export { compileBuilderToVM } from './compiler'
export type { CompileResult } from './compiler'

// --- Zero-Allocation Compiler (RFC-041) ---
export {
  ZeroAllocCompiler,
  compileBuilderToVMZeroAlloc,
  getZeroAllocCompiler,
} from './compiler-zero-alloc'
export type {
  ZeroAllocCompileResult,
  ZeroAllocCompileOptions
} from './compiler-zero-alloc'

// --- Factory ---
import { ClipBuilder } from './ClipBuilder'
import { MelodyBuilder } from './MelodyBuilder'

/**
 * Factory object for creating zero-allocation builders.
 * 
 * @example
 * ```typescript
 * import { Clip } from '@symphonyscript/core/builder'
 * 
 * const sab = Clip.melody()
 *   .note('C4', '4n')
 *   .note('D4', '4n').velocity(0.8)
 *   .humanize({ timing: 0.05 }, b => {
 *     b.note('E4', '4n')
 *     b.note('F4', '4n')
 *   })
 *   .build()
 * ```
 */
export const Clip = {
  /**
   * Create a basic ClipBuilder.
   */
  create(): ClipBuilder {
    return new ClipBuilder()
  },

  /**
   * Create a MelodyBuilder with note/chord/transpose capabilities.
   */
  melody(): MelodyBuilder {
    return new MelodyBuilder()
  }
} as const
