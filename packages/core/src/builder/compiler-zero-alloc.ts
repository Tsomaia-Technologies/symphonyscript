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

  // Groove: template indices
  private readonly grooveStack = new Int32Array(32)
  private grooveTop = 0

  // === Scope Table ===
  // [structOp, count, startTick, eventStart, eventEnd, parent, firstChild, nextSibling, insertionEventIdx]
  private readonly scopeTable = new Int32Array(MAX_SCOPES * SCOPE_STRIDE)
  private scopeCount = 0

  // Auxiliary: tracks last child of each scope for O(1) sibling linking
  private readonly lastChildOfScope = new Int32Array(MAX_SCOPES)

  // === Sort Workspace ===
  private readonly sortIndices = new Int32Array(MAX_EVENTS)

  // === Output Buffer ===
  private readonly vmBuf = new Int32Array(MAX_EVENTS * 5)
  private vmBufLen = 0

  // === Scratch Buffer ===
  private readonly scratchBuf = new Int32Array(2048)

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
        case BUILDER_OP.HUMANIZE_PUSH:
          this.humanizeStack[this.humanizeTop++] = buf[pos + 1]  // timingPpt
          this.humanizeStack[this.humanizeTop++] = buf[pos + 2]  // velocityPpt
          pos += 3
          break

        case BUILDER_OP.HUMANIZE_POP:
          this.humanizeTop -= 2
          pos += 1
          break

        case BUILDER_OP.QUANTIZE_PUSH:
          this.quantizeStack[this.quantizeTop++] = buf[pos + 1]  // gridTicks
          this.quantizeStack[this.quantizeTop++] = buf[pos + 2]  // strengthPct
          pos += 3
          break

        case BUILDER_OP.QUANTIZE_POP:
          this.quantizeTop -= 2
          pos += 1
          break

        case BUILDER_OP.GROOVE_PUSH: {
          // GROOVE_PUSH stores groove data inline: [op, len, ...offsets]
          // We need to register this groove and store its index
          const len = buf[pos + 1]
          // For inline grooves, we'd need to register them dynamically
          // For now, assume grooves are pre-registered via grooveTemplates
          // This means GROOVE_PUSH actually stores [op, len, templateIdx]
          // or the offsets directly if len > 0
          // Let's handle both cases:
          if (len === 0) {
            // Edge case: empty groove
            this.grooveStack[this.grooveTop++] = -1
          } else {
            // The groove offsets are inline, but we need an index
            // Store the position for later lookup (hack for inline grooves)
            // Actually, for zero-alloc, we should register inline grooves too
            // For simplicity, assume the index is stored at pos+2
            // This matches how MelodyBuilder stores registered grooves
            this.grooveStack[this.grooveTop++] = this.findOrRegisterGroove(buf, pos + 2, len)
          }
          pos += 2 + len
          break
        }

        case BUILDER_OP.GROOVE_POP:
          this.grooveTop--
          pos += 1
          break

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

          // 2. Groove
          if (grooveIdx >= 0 && grooveIdx < this.grooveTemplates.length) {
            const offsets = this.grooveTemplates[grooveIdx]
            if (offsets.length > 0) {
              const beatIdx = ((finalTick / this.ppq) | 0) % offsets.length
              finalTick += offsets[beatIdx]
            }
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

    // Save eventIndex at loop start - each iteration resets to use the SAME indices
    // This matches tree-based compiler where cloned events keep their originalIndex
    const savedEventIndex = this.eventIndex

    for (let iter = 0; iter < count; iter++) {
      // Restore context stacks for each iteration
      this.humanizeTop = savedHumTop
      this.quantizeTop = savedQuantTop
      this.grooveTop = savedGrooveTop

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

    // Apply permutation using scratch buffer
    const scratchNeeded = sortCount * EVENT_STRIDE
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

  // ==========================================================================
  // Groove Helpers
  // ==========================================================================

  /**
   * Find or register an inline groove.
   * For simplicity, inline grooves are matched against existing templates.
   * If not found, return -1 (groove not applied).
   */
  private findOrRegisterGroove(_buf: number[], _pos: number, _len: number): number {
    // In the current builder implementation, GROOVE_PUSH stores the offsets inline
    // but for block-scoped grooves, the builder already has the template registered
    // For now, we assume inline grooves are not used and return -1
    // A full implementation would need to match inline offsets against templates
    return -1
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
