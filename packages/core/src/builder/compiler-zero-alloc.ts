// =============================================================================
// SymphonyScript - Zero-Allocation Bytecode Compiler (RFC-041)
// =============================================================================
// This compiler achieves ZERO heap allocations during compile() by using
// pre-allocated Int32Array buffers. All working memory is allocated once
// at instantiation and reused across calls.
//
// DO NOT MODIFY compiler.ts - this is a separate implementation for comparison.
// =============================================================================

import { OP } from '../vm/constants'
import { BUILDER_OP } from './constants'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for zero-allocation compilation.
 */
export interface ZeroAllocCompileOptions {
  /** Pulses per quarter note (default: 96) */
  ppq: number
  /** Seed for deterministic humanization */
  seed: number
  /** Registered groove templates */
  grooveTemplates: readonly number[][]
  /** If true, expand loops instead of emitting LOOP_START/END */
  unroll: boolean
}

/**
 * Result of zero-allocation compilation.
 */
export interface ZeroAllocCompileResult {
  /** VM bytecode as Int32Array view (NOT a copy - do not modify!) */
  vmBytecode: Int32Array
  /** Total duration in ticks */
  totalTicks: number
}

// =============================================================================
// Constants
// =============================================================================

const MAX_EVENTS = 65536
const MAX_SCOPES = 256
const EVENT_STRIDE = 7  // [finalTick, opcode, arg0, arg1, arg2, scopeId, insertionOrder]
const SCOPE_STRIDE = 9  // [structOp, count, startTick, eventStart, eventEnd, parent, firstChild, nextSibling, insertionEventIdx]

// Scratch buffer size (supports ~2,340 events per scope, 64 KB memory)
const SCRATCH_BUF_SIZE = 16384

// Inline groove constants
const MAX_INLINE_GROOVES = 32   // Max nested inline grooves
const MAX_GROOVE_OFFSETS = 16   // Max offsets per groove
const INLINE_GROOVE_STRIDE = 1 + MAX_GROOVE_OFFSETS  // [len, offset0, ..., offset15]

// Context stack depth limits
const MAX_HUMANIZE_DEPTH = 32   // Max nested humanize blocks (64 / 2 pairs)
const MAX_QUANTIZE_DEPTH = 32   // Max nested quantize blocks (64 / 2 pairs)
const MAX_GROOVE_DEPTH = 32     // Max nested groove blocks

// Event buffer offsets
const EV_FINAL_TICK = 0
const EV_OPCODE = 1
const EV_ARG0 = 2
const EV_ARG1 = 3
const EV_ARG2 = 4
const EV_SCOPE_ID = 5
const EV_INSERTION_ORDER = 6

// Scope table offsets
const SC_STRUCT_OP = 0
const SC_COUNT = 1
const SC_START_TICK = 2
const SC_EVENT_START = 3
const SC_EVENT_END = 4
const SC_PARENT = 5
const SC_FIRST_CHILD = 6
const SC_NEXT_SIBLING = 7
const SC_INSERTION_EVENT_IDX = 8

// =============================================================================
// ZeroAllocCompiler Class
// =============================================================================

/**
 * Zero-allocation bytecode compiler.
 * 
 * Pre-allocates all working memory at instantiation. The compile() method
 * can be called repeatedly without triggering garbage collection.
 * 
 * @example
 * ```typescript
 * const compiler = new ZeroAllocCompiler()
 * const result = compiler.compile(builderBuf, { ppq: 96, seed: 12345, grooveTemplates: [], unroll: false })
 * ```
 */
export class ZeroAllocCompiler {
  // === Event Buffer ===
  // [finalTick, opcode, arg0, arg1, arg2, scopeId, insertionOrder] × MAX_EVENTS
  private readonly eventBuf = new Int32Array(MAX_EVENTS * EVENT_STRIDE)
  private eventCount = 0
  private insertionCounter = 0

  // === Context Stacks ===
  // Humanize: pairs of [timingPpt, velocityPpt]
  private readonly humanizeStack = new Int32Array(64)
  private humanizeTop = 0

  // Quantize: pairs of [gridTicks, strengthPct]
  private readonly quantizeStack = new Int32Array(64)
  private quantizeTop = 0

  // Groove: indices (positive = template index, negative = inline groove index)
  private readonly grooveStack = new Int32Array(32)
  private grooveTop = 0

  // === Inline Groove Buffer ===
  // Stores inline groove offsets in a flat buffer
  // Format: [len, offset0, ..., offset15] per groove
  // Negative indices in grooveStack point here: -(inlineIdx + 1)
  private readonly inlineGrooveBuf = new Int32Array(MAX_INLINE_GROOVES * INLINE_GROOVE_STRIDE)
  private inlineGrooveTop = 0

  // === Scope Table ===
  // [structOp, count, startTick, eventStart, eventEnd, parent, firstChild, nextSibling, insertionEventIdx]
  private readonly scopeTable = new Int32Array(MAX_SCOPES * SCOPE_STRIDE)
  private scopeCount = 0

  // Auxiliary: tracks last child of each scope for O(1) sibling linking
  private readonly lastChildOfScope = new Int32Array(MAX_SCOPES)

  // === Sort Workspace ===
  private readonly sortIndices = new Int32Array(MAX_EVENTS)

  // === Output Buffer ===
  // Worst case: REST(2) + NOTE(4) + structural overhead = ~7 slots per event
  private readonly vmBuf = new Int32Array(MAX_EVENTS * 7)
  private vmBufLen = 0

  // === Scratch Buffer ===
  private readonly scratchBuf = new Int32Array(SCRATCH_BUF_SIZE)

  // === PRNG State ===
  private prngState = 0

  // === Event Index Counter (for PRNG seeding) ===
  // This must be global across all parseScope calls to match tree-based compiler
  private eventIndex = 0

  // === Groove Templates Reference ===
  private grooveTemplates: readonly number[][] = []
  private ppq = 96

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Compile Builder Bytecode to VM Bytecode with ZERO heap allocations.
   * 
   * All working memory is pre-allocated. This method can be called
   * frequently in live performance without GC pressure.
   */
  compile(builderBuf: number[], options: ZeroAllocCompileOptions): ZeroAllocCompileResult {
    const { ppq, seed, grooveTemplates, unroll } = options

    // Store options for use during parsing
    this.grooveTemplates = grooveTemplates
    this.ppq = ppq

    // Reset all state (no allocations - just index resets)
    this.reset()

    // Create root scope (scopeId = 0)
    const rootScopeId = this.allocateScope(0, 0, 0, -1)

    // Phase 1: Parse and transform
    this.parseScope(builderBuf, 0, builderBuf.length, rootScopeId, seed, unroll)

    // Finalize root scope
    this.finalizeScope(rootScopeId)

    // Phase 2: Sort events within each scope
    this.sortAllScopes()

    // Phase 3: Emit VM bytecode
    this.emitScope(rootScopeId)
    this.vmBuf[this.vmBufLen++] = OP.EOF

    // Calculate total ticks
    const totalTicks = this.calculateTotalTicks()

    return {
      vmBytecode: this.vmBuf.subarray(0, this.vmBufLen),
      totalTicks
    }
  }

  // ==========================================================================
  // Reset
  // ==========================================================================

  private reset(): void {
    this.eventCount = 0
    this.insertionCounter = 0
    this.humanizeTop = 0
    this.quantizeTop = 0
    this.grooveTop = 0
    this.inlineGrooveTop = 0
    this.scopeCount = 0
    this.vmBufLen = 0
    this.eventIndex = 0
    // Note: We do NOT clear the arrays, just reset indices
  }

  // ==========================================================================
  // PRNG (Mulberry32 - No Closure Allocation)
  // ==========================================================================

  private prngSeed(seed: number): void {
    this.prngState = seed | 0
  }

  private prngNext(): number {
    let t = (this.prngState += 0x6d2b79f5) | 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // ==========================================================================
  // Scope Management
  // ==========================================================================

  private allocateScope(
    structOp: number,
    count: number,
    startTick: number,
    parentScopeId: number
  ): number {
    if (this.scopeCount >= MAX_SCOPES) {
      throw new Error(`SymphonyCompilerOverflow: MAX_SCOPES (${MAX_SCOPES}) reached. Consider splitting into multiple clips.`)
    }

    const scopeId = this.scopeCount++
    const base = scopeId * SCOPE_STRIDE

    // Initialize scope table entry
    this.scopeTable[base + SC_STRUCT_OP] = structOp
    this.scopeTable[base + SC_COUNT] = count
    this.scopeTable[base + SC_START_TICK] = startTick
    this.scopeTable[base + SC_EVENT_START] = this.eventCount
    this.scopeTable[base + SC_EVENT_END] = this.eventCount  // Will be finalized later
    this.scopeTable[base + SC_PARENT] = parentScopeId
    this.scopeTable[base + SC_FIRST_CHILD] = -1
    this.scopeTable[base + SC_NEXT_SIBLING] = -1
    this.scopeTable[base + SC_INSERTION_EVENT_IDX] = this.insertionCounter

    // Initialize lastChildOfScope for this new scope
    this.lastChildOfScope[scopeId] = -1

    // Link into parent's child list
    if (parentScopeId >= 0) {
      const lastChild = this.lastChildOfScope[parentScopeId]
      if (lastChild < 0) {
        // First child of parent
        const parentBase = parentScopeId * SCOPE_STRIDE
        this.scopeTable[parentBase + SC_FIRST_CHILD] = scopeId
      } else {
        // Append to sibling list
        const lastChildBase = lastChild * SCOPE_STRIDE
        this.scopeTable[lastChildBase + SC_NEXT_SIBLING] = scopeId
      }
      this.lastChildOfScope[parentScopeId] = scopeId
    }

    return scopeId
  }

  private finalizeScope(scopeId: number): void {
    const base = scopeId * SCOPE_STRIDE
    this.scopeTable[base + SC_EVENT_END] = this.eventCount
  }

  // ==========================================================================
  // Event Management
  // ==========================================================================

  private addEvent(
    finalTick: number,
    opcode: number,
    arg0: number,
    arg1: number,
    arg2: number,
    scopeId: number
  ): void {
    if (this.eventCount >= MAX_EVENTS) {
      throw new Error(`SymphonyCompilerOverflow: MAX_EVENTS (${MAX_EVENTS}) reached. Consider splitting into multiple clips.`)
    }

    const base = this.eventCount * EVENT_STRIDE
    this.eventBuf[base + EV_FINAL_TICK] = finalTick
    this.eventBuf[base + EV_OPCODE] = opcode
    this.eventBuf[base + EV_ARG0] = arg0
    this.eventBuf[base + EV_ARG1] = arg1
    this.eventBuf[base + EV_ARG2] = arg2
    this.eventBuf[base + EV_SCOPE_ID] = scopeId
    this.eventBuf[base + EV_INSERTION_ORDER] = this.insertionCounter++

    this.eventCount++
  }

  // ==========================================================================
  // Opcode Length Helper
  // ==========================================================================

  private getOpcodeLength(buf: number[], pos: number): number {
    const op = buf[pos]

    switch (op) {
      // VM opcodes (Builder format includes tick)
      case OP.NOTE: return 5           // [op, tick, pitch, vel, dur]
      case OP.REST: return 3           // [op, tick, dur]
      case OP.TEMPO: return 3          // [op, tick, bpm]
      case OP.CC: return 4             // [op, tick, ctrl, val]
      case OP.BEND: return 3           // [op, tick, val]
      case OP.LOOP_START: return 3     // [op, tick, count]
      case OP.LOOP_END: return 1       // [op]
      case OP.STACK_START: return 3    // [op, tick, branchCount]
      case OP.STACK_END: return 1      // [op]
      case OP.BRANCH_START: return 1   // [op]
      case OP.BRANCH_END: return 1     // [op]

      // Builder transform opcodes
      case BUILDER_OP.HUMANIZE_PUSH: return 3   // [op, timingPpt, velPpt]
      case BUILDER_OP.HUMANIZE_POP: return 1    // [op]
      case BUILDER_OP.QUANTIZE_PUSH: return 3   // [op, gridTicks, strengthPct]
      case BUILDER_OP.QUANTIZE_POP: return 1    // [op]
      case BUILDER_OP.GROOVE_PUSH: return 2 + buf[pos + 1]  // [op, len, ...offsets]
      case BUILDER_OP.GROOVE_POP: return 1      // [op]
      case BUILDER_OP.NOTE_MOD_HUMANIZE: return 3  // [op, timingPpt, velPpt]
      case BUILDER_OP.NOTE_MOD_QUANTIZE: return 3  // [op, gridTicks, strengthPct]
      case BUILDER_OP.NOTE_MOD_GROOVE: return 2    // [op, grooveIdx]

      default: return 1
    }
  }

  // ==========================================================================
  // Find Matching End Opcode
  // ==========================================================================

  private findMatchingEnd(buf: number[], start: number, endOp: number): number {
    const startOp = endOp === OP.LOOP_END ? OP.LOOP_START :
                    endOp === OP.STACK_END ? OP.STACK_START :
                    endOp === OP.BRANCH_END ? OP.BRANCH_START :
                    0

    let depth = 1
    let pos = start

    while (pos < buf.length && depth > 0) {
      const op = buf[pos]

      if (op === startOp) {
        depth++
      } else if (op === endOp) {
        depth--
        if (depth === 0) return pos
      }

      pos += this.getOpcodeLength(buf, pos)
    }

    return pos
  }

  // ==========================================================================
  // Calculate Body Duration
  // ==========================================================================

  private calculateBodyDuration(buf: number[], start: number, end: number): number {
    let totalDuration = 0
    let pos = start

    while (pos < end) {
      const op = buf[pos]

      if (op === OP.NOTE) {
        const duration = buf[pos + 4]
        totalDuration += duration
        pos += 5
        // Skip atomic modifiers
        while (pos < end) {
          const modOp = buf[pos]
          if (modOp === BUILDER_OP.NOTE_MOD_HUMANIZE) pos += 3
          else if (modOp === BUILDER_OP.NOTE_MOD_QUANTIZE) pos += 3
          else if (modOp === BUILDER_OP.NOTE_MOD_GROOVE) pos += 2
          else break
        }
      } else if (op === OP.REST) {
        const duration = buf[pos + 2]
        totalDuration += duration
        pos += 3
      } else if (op === OP.LOOP_START) {
        const count = buf[pos + 2]
        pos += 3
        const bodyEnd = this.findMatchingEnd(buf, pos, OP.LOOP_END)
        const innerDuration = this.calculateBodyDuration(buf, pos, bodyEnd)
        totalDuration += innerDuration * count
        pos = bodyEnd + 1
      } else if (op === OP.STACK_START) {
        const branchCount = buf[pos + 2]
        pos += 3
        let maxBranchDuration = 0
        for (let b = 0; b < branchCount && pos < end; b++) {
          if (buf[pos] === OP.BRANCH_START) {
            pos++
            const branchEnd = this.findMatchingEnd(buf, pos, OP.BRANCH_END)
            const branchDuration = this.calculateBodyDuration(buf, pos, branchEnd)
            if (branchDuration > maxBranchDuration) maxBranchDuration = branchDuration
            pos = branchEnd + 1
          }
        }
        if (buf[pos] === OP.STACK_END) pos++
        totalDuration += maxBranchDuration
      } else {
        pos += this.getOpcodeLength(buf, pos)
      }
    }

    return totalDuration
  }

  // ==========================================================================
  // Phase 1: Parse and Transform
  // ==========================================================================

  private parseScope(
    buf: number[],
    start: number,
    end: number,
    currentScopeId: number,
    baseSeed: number,
    unroll: boolean
  ): void {
    let pos = start

    while (pos < end) {
      const opcode = buf[pos]

      switch (opcode) {
        // === Transform Context Management ===
        case BUILDER_OP.HUMANIZE_PUSH: {
          // Check for stack overflow (each entry uses 2 slots)
          if (this.humanizeTop >= MAX_HUMANIZE_DEPTH * 2) {
            throw new Error(
              `SymphonyCompilerOverflow: Too many nested humanize blocks. ` +
              `Max depth: ${MAX_HUMANIZE_DEPTH}`
            )
          }
          this.humanizeStack[this.humanizeTop++] = buf[pos + 1]  // timingPpt
          this.humanizeStack[this.humanizeTop++] = buf[pos + 2]  // velocityPpt
          pos += 3
          break
        }

        case BUILDER_OP.HUMANIZE_POP:
          this.humanizeTop -= 2
          pos += 1
          break

        case BUILDER_OP.QUANTIZE_PUSH: {
          // Check for stack overflow (each entry uses 2 slots)
          if (this.quantizeTop >= MAX_QUANTIZE_DEPTH * 2) {
            throw new Error(
              `SymphonyCompilerOverflow: Too many nested quantize blocks. ` +
              `Max depth: ${MAX_QUANTIZE_DEPTH}`
            )
          }
          this.quantizeStack[this.quantizeTop++] = buf[pos + 1]  // gridTicks
          this.quantizeStack[this.quantizeTop++] = buf[pos + 2]  // strengthPct
          pos += 3
          break
        }

        case BUILDER_OP.QUANTIZE_POP:
          this.quantizeTop -= 2
          pos += 1
          break

        case BUILDER_OP.GROOVE_PUSH: {
          // GROOVE_PUSH stores groove data inline: [op, len, offset0, ..., offsetN-1]
          const len = buf[pos + 1]

          // Check for grooveStack overflow
          if (this.grooveTop >= MAX_GROOVE_DEPTH) {
            throw new Error(
              `SymphonyCompilerOverflow: Too many nested groove blocks. ` +
              `Max depth: ${MAX_GROOVE_DEPTH}`
            )
          }

          if (len === 0) {
            // Empty groove - push sentinel
            this.grooveStack[this.grooveTop++] = -1
          } else {
            // Check for inline groove buffer overflow
            if (this.inlineGrooveTop >= MAX_INLINE_GROOVES) {
              throw new Error(
                `SymphonyCompilerOverflow: Too many nested inline grooves. ` +
                `Max: ${MAX_INLINE_GROOVES}`
              )
            }
            if (len > MAX_GROOVE_OFFSETS) {
              throw new Error(
                `SymphonyCompilerOverflow: Groove has too many offsets. ` +
                `Found: ${len}, Max: ${MAX_GROOVE_OFFSETS}`
              )
            }

            // Store inline groove offsets
            const base = this.inlineGrooveTop * INLINE_GROOVE_STRIDE
            this.inlineGrooveBuf[base] = len  // Store length first
            for (let i = 0; i < len; i++) {
              this.inlineGrooveBuf[base + 1 + i] = buf[pos + 2 + i]
            }

            // Push encoded index: -(inlineGrooveTop + 1) to distinguish from template indices
            // Negative means inline (but -1 is sentinel for empty), positive means template
            this.grooveStack[this.grooveTop++] = -(this.inlineGrooveTop + 2)
            this.inlineGrooveTop++
          }
          pos += 2 + len
          break
        }

        case BUILDER_OP.GROOVE_POP: {
          if (this.grooveTop > 0) {
            const idx = this.grooveStack[this.grooveTop - 1]
            // If it was an inline groove (negative, not -1 sentinel), decrement inlineGrooveTop
            if (idx < -1) {
              this.inlineGrooveTop--
            }
          }
          this.grooveTop--
          pos += 1
          break
        }

        // === Event: NOTE ===
        case OP.NOTE: {
          const tick = buf[pos + 1]
          const pitch = buf[pos + 2]
          let velocity = buf[pos + 3]
          const duration = buf[pos + 4]
          pos += 5

          // Parse atomic modifiers (NOTE_MOD_*)
          let atomicHumTiming = -1, atomicHumVel = -1
          let atomicQuantGrid = -1, atomicQuantStr = -1
          let atomicGrooveIdx = -1

          while (pos < end) {
            const modOp = buf[pos]
            if (modOp === BUILDER_OP.NOTE_MOD_HUMANIZE) {
              atomicHumTiming = buf[pos + 1]
              atomicHumVel = buf[pos + 2]
              pos += 3
            } else if (modOp === BUILDER_OP.NOTE_MOD_QUANTIZE) {
              atomicQuantGrid = buf[pos + 1]
              atomicQuantStr = buf[pos + 2]
              pos += 3
            } else if (modOp === BUILDER_OP.NOTE_MOD_GROOVE) {
              atomicGrooveIdx = buf[pos + 1]
              pos += 2
            } else {
              break
            }
          }

          // Resolve contexts (atomic overrides block)
          const humTiming = atomicHumTiming >= 0 ? atomicHumTiming :
                            this.humanizeTop > 0 ? this.humanizeStack[this.humanizeTop - 2] : 0
          const humVel = atomicHumVel >= 0 ? atomicHumVel :
                         this.humanizeTop > 0 ? this.humanizeStack[this.humanizeTop - 1] : 0
          const quantGrid = atomicQuantGrid >= 0 ? atomicQuantGrid :
                            this.quantizeTop > 0 ? this.quantizeStack[this.quantizeTop - 2] : 0
          const quantStr = atomicQuantStr >= 0 ? atomicQuantStr :
                           this.quantizeTop > 0 ? this.quantizeStack[this.quantizeTop - 1] : 100
          const grooveIdx = atomicGrooveIdx >= 0 ? atomicGrooveIdx :
                            this.grooveTop > 0 ? this.grooveStack[this.grooveTop - 1] : -1

          // Apply transforms: Quantize → Groove → Humanize
          let finalTick = tick

          // 1. Quantize
          if (quantGrid > 0) {
            const quantized = Math.round(finalTick / quantGrid) * quantGrid
            finalTick = finalTick + Math.round((quantized - finalTick) * quantStr / 100)
          }

          // 2. Groove (supports both template and inline grooves)
          if (grooveIdx !== -1) {
            let offsetsLen = 0
            let offset = 0

            if (grooveIdx >= 0) {
              // Template groove (positive index)
              if (grooveIdx < this.grooveTemplates.length) {
                const templateOffsets = this.grooveTemplates[grooveIdx]
                offsetsLen = templateOffsets.length
                if (offsetsLen > 0) {
                  const beatIdx = ((finalTick / this.ppq) | 0) % offsetsLen
                  offset = templateOffsets[beatIdx]
                }
              }
            } else {
              // Inline groove (negative index, encoded as -(inlineIdx + 2))
              const inlineIdx = -(grooveIdx + 2)
              const base = inlineIdx * INLINE_GROOVE_STRIDE
              offsetsLen = this.inlineGrooveBuf[base]
              if (offsetsLen > 0) {
                const beatIdx = ((finalTick / this.ppq) | 0) % offsetsLen
                offset = this.inlineGrooveBuf[base + 1 + beatIdx]
              }
            }

            finalTick += offset
          }

          // 3. Humanize
          if (humTiming > 0 || humVel > 0) {
            this.prngSeed(baseSeed + this.eventIndex)

            if (humTiming > 0) {
              const maxOffset = (humTiming / 1000) * this.ppq
              finalTick += Math.round((this.prngNext() - 0.5) * 2 * maxOffset)
            }

            if (humVel > 0) {
              const maxVelOffset = (humVel / 1000) * 127
              velocity = Math.max(1, Math.min(127,
                Math.round(velocity + (this.prngNext() - 0.5) * 2 * maxVelOffset)
              ))
            }
          }

          finalTick = Math.max(0, finalTick)

          // Store event
          this.addEvent(finalTick, OP.NOTE, pitch, velocity, duration, currentScopeId)
          this.eventIndex++
          break
        }

        // === Event: REST ===
        case OP.REST: {
          const tick = buf[pos + 1]
          const duration = buf[pos + 2]
          pos += 3

          this.addEvent(tick, OP.REST, duration, 0, 0, currentScopeId)
          this.eventIndex++
          break
        }

        // === Event: TEMPO ===
        case OP.TEMPO: {
          const tick = buf[pos + 1]
          const bpm = buf[pos + 2]
          pos += 3

          this.addEvent(tick, OP.TEMPO, bpm, 0, 0, currentScopeId)
          this.eventIndex++
          break
        }

        // === Event: CC ===
        case OP.CC: {
          const tick = buf[pos + 1]
          const controller = buf[pos + 2]
          const value = buf[pos + 3]
          pos += 4

          this.addEvent(tick, OP.CC, controller, value, 0, currentScopeId)
          this.eventIndex++
          break
        }

        // === Event: BEND ===
        case OP.BEND: {
          const tick = buf[pos + 1]
          const value = buf[pos + 2]
          pos += 3

          this.addEvent(tick, OP.BEND, value, 0, 0, currentScopeId)
          this.eventIndex++
          break
        }

        // === Structural: LOOP_START ===
        case OP.LOOP_START: {
          const startTick = buf[pos + 1]
          const count = buf[pos + 2]
          pos += 3

          const bodyEnd = this.findMatchingEnd(buf, pos, OP.LOOP_END)

          if (unroll) {
            pos = this.parseUnrolledLoop(buf, pos, bodyEnd, count, startTick, baseSeed, currentScopeId)
          } else {
            pos = this.parseStructuralLoop(buf, pos, bodyEnd, count, startTick, baseSeed, currentScopeId)
          }
          break
        }

        // === Structural: STACK_START ===
        case OP.STACK_START: {
          const startTick = buf[pos + 1]
          const branchCount = buf[pos + 2]
          pos += 3

          pos = this.parseStack(buf, pos, branchCount, startTick, baseSeed, currentScopeId, unroll)
          break
        }

        // === Skip terminators (handled by parent) ===
        case OP.LOOP_END:
        case OP.STACK_END:
        case OP.BRANCH_START:
        case OP.BRANCH_END:
          pos++
          break

        default:
          pos++
          break
      }
    }
  }

  // ==========================================================================
  // Structural: LOOP (Non-Unroll Mode)
  // ==========================================================================

  private parseStructuralLoop(
    buf: number[],
    bodyStart: number,
    bodyEnd: number,
    count: number,
    startTick: number,
    baseSeed: number,
    parentScopeId: number
  ): number {
    // Save context stacks
    const savedHumTop = this.humanizeTop
    const savedQuantTop = this.quantizeTop
    const savedGrooveTop = this.grooveTop
    const savedInlineGrooveTop = this.inlineGrooveTop

    // Allocate LOOP scope
    const loopScopeId = this.allocateScope(OP.LOOP_START, count, startTick, parentScopeId)

    // Parse loop body (events will have loopScopeId)
    this.parseScope(buf, bodyStart, bodyEnd, loopScopeId, baseSeed, false)

    // Finalize loop scope
    this.finalizeScope(loopScopeId)

    // Restore context stacks
    this.humanizeTop = savedHumTop
    this.quantizeTop = savedQuantTop
    this.grooveTop = savedGrooveTop
    this.inlineGrooveTop = savedInlineGrooveTop

    return bodyEnd + 1  // Skip LOOP_END
  }

  // ==========================================================================
  // Structural: LOOP (Unroll Mode)
  // ==========================================================================

  private parseUnrolledLoop(
    buf: number[],
    bodyStart: number,
    bodyEnd: number,
    count: number,
    _startTick: number,  // Unused but kept for consistency
    baseSeed: number,
    parentScopeId: number
  ): number {
    // Calculate body duration
    const bodyDuration = this.calculateBodyDuration(buf, bodyStart, bodyEnd)

    // Save context stacks
    const savedHumTop = this.humanizeTop
    const savedQuantTop = this.quantizeTop
    const savedGrooveTop = this.grooveTop
    const savedInlineGrooveTop = this.inlineGrooveTop

    // Save eventIndex at loop start - each iteration resets to use the SAME indices
    // This matches tree-based compiler where cloned events keep their originalIndex
    const savedEventIndex = this.eventIndex

    for (let iter = 0; iter < count; iter++) {
      // Restore context stacks for each iteration
      this.humanizeTop = savedHumTop
      this.quantizeTop = savedQuantTop
      this.grooveTop = savedGrooveTop
      this.inlineGrooveTop = savedInlineGrooveTop

      // Restore eventIndex for each iteration (same indices, different baseSeed)
      // This ensures: seed = iterSeed + eventIndex gives unique seeds per iteration
      // iter 0: seeds = baseSeed + 0, baseSeed + 1, baseSeed + 2, ...
      // iter 1: seeds = baseSeed + 1000 + 0, baseSeed + 1000 + 1, ...
      this.eventIndex = savedEventIndex

      // Record event count before this iteration
      const iterEventStart = this.eventCount

      // Parse body with iteration-specific seed
      const iterSeed = baseSeed + iter * 1000
      this.parseScope(buf, bodyStart, bodyEnd, parentScopeId, iterSeed, true)

      // Offset all events from this iteration
      const iterOffset = bodyDuration * iter
      for (let e = iterEventStart; e < this.eventCount; e++) {
        const base = e * EVENT_STRIDE
        this.eventBuf[base + EV_FINAL_TICK] += iterOffset
      }
    }

    // Restore context stacks
    this.humanizeTop = savedHumTop
    this.quantizeTop = savedQuantTop
    this.grooveTop = savedGrooveTop
    this.inlineGrooveTop = savedInlineGrooveTop

    return bodyEnd + 1  // Skip LOOP_END
  }

  // ==========================================================================
  // Structural: STACK/BRANCH
  // ==========================================================================

  private parseStack(
    buf: number[],
    pos: number,
    branchCount: number,
    startTick: number,
    baseSeed: number,
    parentScopeId: number,
    unroll: boolean
  ): number {
    // Save context stacks
    const savedHumTop = this.humanizeTop
    const savedQuantTop = this.quantizeTop
    const savedGrooveTop = this.grooveTop
    const savedInlineGrooveTop = this.inlineGrooveTop

    // Allocate STACK scope
    const stackScopeId = this.allocateScope(OP.STACK_START, branchCount, startTick, parentScopeId)

    for (let b = 0; b < branchCount && pos < buf.length; b++) {
      // Expect BRANCH_START
      if (buf[pos] !== OP.BRANCH_START) break
      pos++  // Skip BRANCH_START

      // Restore context stacks for each branch (branches are independent)
      this.humanizeTop = savedHumTop
      this.quantizeTop = savedQuantTop
      this.grooveTop = savedGrooveTop
      this.inlineGrooveTop = savedInlineGrooveTop

      // Allocate BRANCH scope
      const branchScopeId = this.allocateScope(OP.BRANCH_START, 0, startTick, stackScopeId)

      // Find matching BRANCH_END
      const branchEnd = this.findMatchingEnd(buf, pos, OP.BRANCH_END)

      // Parse branch body
      this.parseScope(buf, pos, branchEnd, branchScopeId, baseSeed, unroll)

      // Finalize branch scope
      this.finalizeScope(branchScopeId)

      pos = branchEnd + 1  // Skip BRANCH_END
    }

    // Expect STACK_END
    if (pos < buf.length && buf[pos] === OP.STACK_END) pos++

    // Restore context stacks
    this.humanizeTop = savedHumTop
    this.quantizeTop = savedQuantTop
    this.grooveTop = savedGrooveTop
    this.inlineGrooveTop = savedInlineGrooveTop

    // Finalize stack scope
    this.finalizeScope(stackScopeId)

    return pos
  }

  // ==========================================================================
  // Phase 2: Sort Events Within Scopes
  // ==========================================================================

  private sortAllScopes(): void {
    for (let scopeId = 0; scopeId < this.scopeCount; scopeId++) {
      this.sortEventsInScope(scopeId)
    }
  }

  private sortEventsInScope(scopeId: number): void {
    const base = scopeId * SCOPE_STRIDE
    const eventStart = this.scopeTable[base + SC_EVENT_START]
    const eventEnd = this.scopeTable[base + SC_EVENT_END]

    // Collect events belonging to this scope
    let sortCount = 0
    for (let i = eventStart; i < eventEnd; i++) {
      const evBase = i * EVENT_STRIDE
      if (this.eventBuf[evBase + EV_SCOPE_ID] === scopeId) {
        this.sortIndices[sortCount++] = i
      }
    }

    if (sortCount <= 1) return

    // Check for scratchBuf overflow before sorting
    const scratchNeeded = sortCount * EVENT_STRIDE
    if (scratchNeeded > SCRATCH_BUF_SIZE) {
      const maxEvents = Math.floor(SCRATCH_BUF_SIZE / EVENT_STRIDE)
      throw new Error(
        `SymphonyCompilerOverflow: Too many events in single scope. ` +
        `Found: ${sortCount}, Max: ${maxEvents}. ` +
        `Consider splitting dense sections into separate loops or clips.`
      )
    }

    // Stable insertion sort by finalTick
    for (let i = 1; i < sortCount; i++) {
      const key = this.sortIndices[i]
      const keyBase = key * EVENT_STRIDE
      const keyTick = this.eventBuf[keyBase + EV_FINAL_TICK]
      const keyOrder = this.eventBuf[keyBase + EV_INSERTION_ORDER]

      let j = i - 1
      while (j >= 0) {
        const jIdx = this.sortIndices[j]
        const jBase = jIdx * EVENT_STRIDE
        const jTick = this.eventBuf[jBase + EV_FINAL_TICK]
        const jOrder = this.eventBuf[jBase + EV_INSERTION_ORDER]

        // Primary: finalTick ascending
        // Secondary: insertionOrder ascending (stable)
        if (jTick < keyTick || (jTick === keyTick && jOrder <= keyOrder)) break

        this.sortIndices[j + 1] = this.sortIndices[j]
        j--
      }
      this.sortIndices[j + 1] = key
    }

    // Apply permutation using scratch buffer (scratchNeeded already validated above)
    // Copy sorted events to scratch
    for (let i = 0; i < sortCount; i++) {
      const srcIdx = this.sortIndices[i]
      const srcBase = srcIdx * EVENT_STRIDE
      const dstBase = i * EVENT_STRIDE

      for (let k = 0; k < EVENT_STRIDE; k++) {
        this.scratchBuf[dstBase + k] = this.eventBuf[srcBase + k]
      }
    }

    // Copy back to event buffer at the scope's event positions
    // We need to track which positions in eventBuf belong to this scope
    let targetIdx = 0
    for (let i = eventStart; i < eventEnd; i++) {
      const evBase = i * EVENT_STRIDE
      if (this.eventBuf[evBase + EV_SCOPE_ID] === scopeId) {
        const srcBase = targetIdx * EVENT_STRIDE
        for (let k = 0; k < EVENT_STRIDE; k++) {
          this.eventBuf[evBase + k] = this.scratchBuf[srcBase + k]
        }
        targetIdx++
      }
    }
  }

  // ==========================================================================
  // Phase 3: Emit VM Bytecode
  // ==========================================================================

  private emitScope(scopeId: number): void {
    const base = scopeId * SCOPE_STRIDE
    const structOp = this.scopeTable[base + SC_STRUCT_OP]
    const count = this.scopeTable[base + SC_COUNT]
    const scopeStartTick = this.scopeTable[base + SC_START_TICK]
    const eventStart = this.scopeTable[base + SC_EVENT_START]
    const eventEnd = this.scopeTable[base + SC_EVENT_END]
    let childId = this.scopeTable[base + SC_FIRST_CHILD]

    // Count events in this scope for overflow check
    let scopeEventCount = 0
    for (let i = eventStart; i < eventEnd; i++) {
      if (this.eventBuf[i * EVENT_STRIDE + EV_SCOPE_ID] === scopeId) {
        scopeEventCount++
      }
    }

    // Pre-calculate maximum bytes this scope might emit
    // Worst case: 2 (START) + scopeEventCount * 6 (REST + NOTE) + 1 (END) + 1 (EOF)
    const maxBytesNeeded = 4 + scopeEventCount * 6
    if (this.vmBufLen + maxBytesNeeded > this.vmBuf.length) {
      throw new Error(
        `SymphonyCompilerOverflow: VM bytecode buffer exceeded. ` +
        `Position: ${this.vmBufLen}, Needed: ${maxBytesNeeded}, ` +
        `Capacity: ${this.vmBuf.length}. Consider splitting into multiple clips.`
      )
    }

    // === Emit START opcode ===
    if (structOp === OP.LOOP_START) {
      this.vmBuf[this.vmBufLen++] = OP.LOOP_START
      this.vmBuf[this.vmBufLen++] = count
    } else if (structOp === OP.STACK_START) {
      this.vmBuf[this.vmBufLen++] = OP.STACK_START
      this.vmBuf[this.vmBufLen++] = count
    } else if (structOp === OP.BRANCH_START) {
      this.vmBuf[this.vmBufLen++] = OP.BRANCH_START
    }

    // === Collect sorted event indices for this scope ===
    let sortCount = 0
    for (let i = eventStart; i < eventEnd; i++) {
      const evBase = i * EVENT_STRIDE
      if (this.eventBuf[evBase + EV_SCOPE_ID] === scopeId) {
        this.sortIndices[sortCount++] = i
      }
    }

    // === Tree-based emit order: ALL events first (sorted), THEN structural nodes ===
    // This matches the tree-based compiler's sortNodesInScope behavior
    let currentTick = 0

    // First: emit all events (sorted by finalTick)
    for (let sortIdx = 0; sortIdx < sortCount; sortIdx++) {
      const evIdx = this.sortIndices[sortIdx]
      const evBase = evIdx * EVENT_STRIDE
      // Make tick relative to scope start (for structural blocks)
      const finalTick = this.eventBuf[evBase + EV_FINAL_TICK] - scopeStartTick
      const opcode = this.eventBuf[evBase + EV_OPCODE]

      // Emit REST gap if needed
      if (finalTick > currentTick) {
        this.vmBuf[this.vmBufLen++] = OP.REST
        this.vmBuf[this.vmBufLen++] = finalTick - currentTick
        currentTick = finalTick
      }

      // Emit event
      switch (opcode) {
        case OP.NOTE:
          this.vmBuf[this.vmBufLen++] = OP.NOTE
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG0]  // pitch
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG1]  // velocity
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG2]  // duration
          currentTick += this.eventBuf[evBase + EV_ARG2]
          break

        case OP.REST:
          this.vmBuf[this.vmBufLen++] = OP.REST
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG0]  // duration
          currentTick += this.eventBuf[evBase + EV_ARG0]
          break

        case OP.TEMPO:
          this.vmBuf[this.vmBufLen++] = OP.TEMPO
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG0]  // bpm
          break

        case OP.CC:
          this.vmBuf[this.vmBufLen++] = OP.CC
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG0]  // controller
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG1]  // value
          break

        case OP.BEND:
          this.vmBuf[this.vmBufLen++] = OP.BEND
          this.vmBuf[this.vmBufLen++] = this.eventBuf[evBase + EV_ARG0]  // value
          break
      }
    }

    // Second: emit all structural children (in original order)
    while (childId >= 0) {
      this.emitScope(childId)
      childId = this.scopeTable[childId * SCOPE_STRIDE + SC_NEXT_SIBLING]
    }

    // === Emit END opcode ===
    if (structOp === OP.LOOP_START) {
      this.vmBuf[this.vmBufLen++] = OP.LOOP_END
    } else if (structOp === OP.STACK_START) {
      this.vmBuf[this.vmBufLen++] = OP.STACK_END
    } else if (structOp === OP.BRANCH_START) {
      this.vmBuf[this.vmBufLen++] = OP.BRANCH_END
    }
  }

  // ==========================================================================
  // Calculate Total Ticks
  // ==========================================================================

  private calculateTotalTicks(): number {
    let maxTick = 0

    for (let i = 0; i < this.eventCount; i++) {
      const base = i * EVENT_STRIDE
      const finalTick = this.eventBuf[base + EV_FINAL_TICK]
      const opcode = this.eventBuf[base + EV_OPCODE]

      let endTick = finalTick
      if (opcode === OP.NOTE) {
        endTick = finalTick + this.eventBuf[base + EV_ARG2]  // duration
      } else if (opcode === OP.REST) {
        endTick = finalTick + this.eventBuf[base + EV_ARG0]  // duration
      }

      if (endTick > maxTick) maxTick = endTick
    }

    return maxTick
  }

}

// =============================================================================
// Singleton and Export Functions
// =============================================================================

let compilerInstance: ZeroAllocCompiler | null = null

/**
 * Get the singleton ZeroAllocCompiler instance.
 * Creates one if it doesn't exist.
 */
export function getZeroAllocCompiler(): ZeroAllocCompiler {
  if (!compilerInstance) {
    compilerInstance = new ZeroAllocCompiler()
  }
  return compilerInstance
}

/**
 * Compile Builder Bytecode to VM Bytecode using the singleton compiler.
 * 
 * This is a convenience function that uses a shared compiler instance.
 * For multi-threaded scenarios, create separate ZeroAllocCompiler instances.
 */
export function compileBuilderToVMZeroAlloc(
  builderBuf: number[],
  options: ZeroAllocCompileOptions
): ZeroAllocCompileResult {
  return getZeroAllocCompiler().compile(builderBuf, options)
}
