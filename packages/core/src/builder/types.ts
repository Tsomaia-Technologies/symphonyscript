// =============================================================================
// SymphonyScript - Builder Types (RFC-040)
// =============================================================================

import type { GrooveTemplate } from '../groove/types'
import type { NoteDuration } from '../types/primitives'

/**
 * Options for the build() method.
 */
export interface BuildOptions {
  /** Tempo in BPM (default: 120) */
  bpm?: number
  /** Pulses per quarter note (default: 96) */
  ppq?: number
  /** Event buffer capacity (default: 10000) */
  eventCapacity?: number
  /** Tempo buffer capacity (default: 100) */
  tempoCapacity?: number
  /** Seed for deterministic humanization (default: Date.now()) */
  seed?: number
  /** 
   * If true, loops are "unrolled" (expanded) instead of using LOOP_START/END opcodes.
   * Each unrolled iteration gets fresh humanization with a unique seed.
   * (default: false)
   */
  unroll?: boolean
}

/**
 * Settings for humanization transform.
 */
export interface HumanizeSettings {
  /** Timing variation as fraction of PPQ (0-1, e.g., 0.05 = 5%) */
  timing?: number
  /** Velocity variation as fraction of 127 (0-1, e.g., 0.1 = 10%) */
  velocity?: number
}

/**
 * Options for quantization transform.
 */
export interface QuantizeOptions {
  /** Quantize strength (0-1, where 1 = full snap to grid) */
  strength?: number
}

/**
 * Context for humanize transform (from block or atomic).
 */
export interface HumanizeContext {
  /** Timing variation in parts-per-thousand of PPQ */
  timingPpt: number
  /** Velocity variation in parts-per-thousand of 127 */
  velocityPpt: number
}

/**
 * Context for quantize transform (from block or atomic).
 */
export interface QuantizeContext {
  /** Grid size in ticks */
  gridTicks: number
  /** Strength as percentage (0-100) */
  strengthPct: number
}

/**
 * Context for groove transform (from block or atomic).
 */
export interface GrooveContext {
  /** Offset values in ticks (signed) */
  offsets: number[]
}

/**
 * An extracted event from Builder bytecode with transform contexts.
 * Used during bytecode-to-bytecode compilation.
 */
export interface ExtractedEvent {
  /** Original opcode (NOTE, REST, TEMPO, CC, BEND) */
  opcode: number
  /** Absolute tick position */
  tick: number
  /** Opcode arguments (without tick) */
  args: number[]
  /** Index in original event order (for deterministic humanization) */
  originalIndex: number
  /** Final tick after transform application */
  finalTick?: number
  /** Humanize context (from block OR atomic, atomic wins) */
  humanizeContext?: HumanizeContext
  /** Quantize context (from block OR atomic, atomic wins) */
  quantizeContext?: QuantizeContext
  /** Groove context (from block OR atomic, atomic wins) */
  grooveContext?: GrooveContext
}

/**
 * A structural event that passes through to VM bytecode.
 */
export interface StructuralEvent {
  /** Opcode (LOOP_START, LOOP_END, STACK_START, etc.) */
  opcode: number
  /** Absolute tick (for LOOP_START, STACK_START) */
  tick?: number
  /** Arguments (count for LOOP/STACK) */
  args: number[]
}

/**
 * Groove template interface for the builder.
 */
export interface BuilderGrooveTemplate {
  /** Get offset values in ticks */
  getOffsets(): number[]
}

// =============================================================================
// Tree Node Types (for compiler AST)
// =============================================================================

/**
 * An event node in the builder AST.
 */
export interface EventNode {
  type: 'event'
  event: ExtractedEvent
}

/**
 * A loop node in the builder AST.
 */
export interface LoopNode {
  type: 'loop'
  /** Number of iterations */
  count: number
  /** Tick when loop starts */
  startTick: number
  /** Children after transforms applied */
  children: BuilderNode[]
  /** 
   * Original children BEFORE transforms (used for unroll mode).
   * Deep clone of children stored when storeOriginals=true in applyTransformsToTree.
   */
  originalChildren?: BuilderNode[]
}

/**
 * A stack node in the builder AST (parallel branches).
 */
export interface StackNode {
  type: 'stack'
  /** Tick when stack starts */
  startTick: number
  /** Branches to execute in parallel */
  branches: BranchNode[]
}

/**
 * A branch node in the builder AST.
 */
export interface BranchNode {
  type: 'branch'
  /** Children within this branch */
  children: BuilderNode[]
}

/**
 * Union of all builder AST node types.
 */
export type BuilderNode = EventNode | LoopNode | StackNode | BranchNode

/**
 * A tree of builder nodes (array of top-level nodes).
 */
export type BuilderTree = BuilderNode[]

/**
 * Re-export for convenience.
 */
export type { NoteDuration, GrooveTemplate }
