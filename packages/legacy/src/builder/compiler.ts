// =============================================================================
// SymphonyScript - Builder-to-VM Compiler (RFC-040)
// Tree-Based Compilation with Structural Opcode Support
// =============================================================================

import { OP } from '../vm/constants'
import { BUILDER_OP } from './constants'
import type {
  ExtractedEvent,
  HumanizeContext,
  QuantizeContext,
  GrooveContext,
  BuilderNode,
  EventNode,
  LoopNode,
  StackNode,
  BranchNode,
  BuilderTree
} from './types'

/**
 * Result of bytecode-to-bytecode compilation.
 */
export interface CompileResult {
  /** VM bytecode (relative timing) */
  vmBuf: number[]
  /** Total ticks (for TOTAL_LENGTH register) */
  totalTicks: number
}

/**
 * Compile Builder Bytecode to VM Bytecode.
 * 
 * Tree-based compilation phases:
 * 1. Extract tree from Builder bytecode (with transform contexts)
 * 2. Apply transforms to tree (Quantize → Groove → Humanize)
 * 3. Emit VM bytecode with structural opcodes and REST gaps
 * 
 * @param builderBuf - Builder bytecode buffer
 * @param ppq - Pulses per quarter note
 * @param seed - Seed for deterministic humanization
 * @param grooveTemplates - Registered groove templates for atomic groove
 * @param unroll - If true, expand loops instead of using LOOP_START/END
 */
export function compileBuilderToVM(
  builderBuf: number[],
  ppq: number,
  seed: number,
  grooveTemplates: readonly number[][],
  unroll: boolean = false
): CompileResult {
  // Phase 1: Extract tree from Builder bytecode
  const parseState: ParseState = {
    buf: builderBuf,
    pos: 0,
    grooveTemplates,
    humanizeStack: [],
    quantizeStack: [],
    grooveStack: [],
    eventIndex: 0
  }
  const tree = extractTree(parseState)

  // Phase 2: Apply transforms to tree
  // If unroll=true, store originalChildren for loops before transforming
  applyTransformsToTree(tree, ppq, seed, unroll)

  // Phase 3: Emit VM bytecode
  const vmBuf: number[] = []
  const currentTick = { value: 0 }
  emitNodes(tree, vmBuf, 0, currentTick, { ppq, seed, unroll })

  // Add EOF
  vmBuf.push(OP.EOF)

  // Calculate total ticks from the tree
  const totalTicks = calculateTotalTicks(tree)

  return { vmBuf, totalTicks }
}

// =============================================================================
// Phase 1: Extract Tree
// =============================================================================

interface ParseState {
  buf: number[]
  pos: number
  grooveTemplates: readonly number[][]
  humanizeStack: HumanizeContext[]
  quantizeStack: QuantizeContext[]
  grooveStack: GrooveContext[]
  eventIndex: number
}

/**
 * Recursively extract a tree of BuilderNodes from Builder bytecode.
 * 
 * @param state - Parse state with buffer position and context stacks
 * @param terminator - Optional opcode that terminates this scope
 * @returns Array of BuilderNode at this scope level
 */
function extractTree(state: ParseState, terminator?: number): BuilderTree {
  const nodes: BuilderNode[] = []

  while (state.pos < state.buf.length) {
    const opcode = state.buf[state.pos]

    // Check for terminator
    if (terminator !== undefined && opcode === terminator) {
      state.pos++ // consume terminator
      break
    }

    switch (opcode) {
      // --- Transform Context (Block-Scoped) ---
      case BUILDER_OP.HUMANIZE_PUSH:
        state.humanizeStack.push({
          timingPpt: state.buf[state.pos + 1],
          velocityPpt: state.buf[state.pos + 2]
        })
        state.pos += 3
        break

      case BUILDER_OP.HUMANIZE_POP:
        state.humanizeStack.pop()
        state.pos += 1
        break

      case BUILDER_OP.QUANTIZE_PUSH:
        state.quantizeStack.push({
          gridTicks: state.buf[state.pos + 1],
          strengthPct: state.buf[state.pos + 2]
        })
        state.pos += 3
        break

      case BUILDER_OP.QUANTIZE_POP:
        state.quantizeStack.pop()
        state.pos += 1
        break

      case BUILDER_OP.GROOVE_PUSH: {
        const len = state.buf[state.pos + 1]
        const offsets = state.buf.slice(state.pos + 2, state.pos + 2 + len)
        state.grooveStack.push({ offsets })
        state.pos += 2 + len
        break
      }

      case BUILDER_OP.GROOVE_POP:
        state.grooveStack.pop()
        state.pos += 1
        break

      // --- Event: NOTE ---
      case OP.NOTE: {
        const event: ExtractedEvent = {
          opcode: OP.NOTE,
          tick: state.buf[state.pos + 1],
          args: [state.buf[state.pos + 2], state.buf[state.pos + 3], state.buf[state.pos + 4]],
          originalIndex: state.eventIndex++,
          humanizeContext: state.humanizeStack.length > 0
            ? { ...state.humanizeStack[state.humanizeStack.length - 1] }
            : undefined,
          quantizeContext: state.quantizeStack.length > 0
            ? { ...state.quantizeStack[state.quantizeStack.length - 1] }
            : undefined,
          grooveContext: state.grooveStack.length > 0
            ? { offsets: [...state.grooveStack[state.grooveStack.length - 1].offsets] }
            : undefined
        }
        state.pos += 5

        // Check for NOTE_MOD_* — ATOMIC OVERRIDES BLOCK
        while (state.pos < state.buf.length) {
          const nextOp = state.buf[state.pos]
          if (nextOp === BUILDER_OP.NOTE_MOD_HUMANIZE) {
            event.humanizeContext = {
              timingPpt: state.buf[state.pos + 1],
              velocityPpt: state.buf[state.pos + 2]
            }
            state.pos += 3
          } else if (nextOp === BUILDER_OP.NOTE_MOD_QUANTIZE) {
            event.quantizeContext = {
              gridTicks: state.buf[state.pos + 1],
              strengthPct: state.buf[state.pos + 2]
            }
            state.pos += 3
          } else if (nextOp === BUILDER_OP.NOTE_MOD_GROOVE) {
            const grooveIdx = state.buf[state.pos + 1]
            if (grooveIdx < state.grooveTemplates.length) {
              event.grooveContext = {
                offsets: [...state.grooveTemplates[grooveIdx]]
              }
            }
            state.pos += 2
          } else {
            break
          }
        }

        nodes.push({ type: 'event', event })
        break
      }

      // --- Event: REST ---
      case OP.REST: {
        nodes.push({
          type: 'event',
          event: {
            opcode: OP.REST,
            tick: state.buf[state.pos + 1],
            args: [state.buf[state.pos + 2]],
            originalIndex: state.eventIndex++
          }
        })
        state.pos += 3
        break
      }

      // --- Event: TEMPO ---
      case OP.TEMPO: {
        nodes.push({
          type: 'event',
          event: {
            opcode: OP.TEMPO,
            tick: state.buf[state.pos + 1],
            args: [state.buf[state.pos + 2]],
            originalIndex: state.eventIndex++
          }
        })
        state.pos += 3
        break
      }

      // --- Event: CC ---
      case OP.CC: {
        nodes.push({
          type: 'event',
          event: {
            opcode: OP.CC,
            tick: state.buf[state.pos + 1],
            args: [state.buf[state.pos + 2], state.buf[state.pos + 3]],
            originalIndex: state.eventIndex++
          }
        })
        state.pos += 4
        break
      }

      // --- Event: BEND ---
      case OP.BEND: {
        nodes.push({
          type: 'event',
          event: {
            opcode: OP.BEND,
            tick: state.buf[state.pos + 1],
            args: [state.buf[state.pos + 2]],
            originalIndex: state.eventIndex++
          }
        })
        state.pos += 3
        break
      }

      // --- Structural: LOOP_START ---
      case OP.LOOP_START: {
        const startTick = state.buf[state.pos + 1]
        const count = state.buf[state.pos + 2]
        state.pos += 3

        // Recursively extract loop body until LOOP_END
        const children = extractTree(state, OP.LOOP_END)

        nodes.push({
          type: 'loop',
          count,
          startTick,
          children
        })
        break
      }

      // --- Structural: STACK_START ---
      case OP.STACK_START: {
        const startTick = state.buf[state.pos + 1]
        const branchCount = state.buf[state.pos + 2]
        state.pos += 3

        const branches: BranchNode[] = []

        // Extract each branch
        for (let i = 0; i < branchCount; i++) {
          // Expect BRANCH_START
          if (state.buf[state.pos] === OP.BRANCH_START) {
            state.pos++ // consume BRANCH_START
            const branchChildren = extractTree(state, OP.BRANCH_END)
            branches.push({ type: 'branch', children: branchChildren })
          }
        }

        // Consume STACK_END
        if (state.buf[state.pos] === OP.STACK_END) {
          state.pos++
        }

        nodes.push({
          type: 'stack',
          startTick,
          branches
        })
        break
      }

      // --- Structural: LOOP_END, BRANCH_END, STACK_END (handled as terminators) ---
      case OP.LOOP_END:
      case OP.BRANCH_END:
      case OP.STACK_END:
        // If we hit these without a terminator being set, just skip them
        state.pos++
        break

      default:
        // Unknown opcode, skip
        state.pos++
        break
    }
  }

  return nodes
}

// =============================================================================
// Phase 2: Apply Transforms to Tree
// =============================================================================

/**
 * Simple seeded random number generator (Mulberry32).
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Apply transforms to all events in a tree.
 * Pipeline order: Quantize → Groove → Humanize
 * 
 * @param nodes - Tree nodes to transform
 * @param ppq - Pulses per quarter note
 * @param seed - Base seed for humanization
 * @param storeOriginals - If true, store originalChildren for LoopNodes before transforming
 */
function applyTransformsToTree(
  nodes: BuilderNode[],
  ppq: number,
  seed: number,
  storeOriginals: boolean = false
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'event':
        node.event.finalTick = applyTransformsToEvent(node.event, ppq, seed)
        break

      case 'loop':
        // If storeOriginals, deep clone children BEFORE transforming
        if (storeOriginals) {
          node.originalChildren = deepCloneNodes(node.children)
        }
        applyTransformsToTree(node.children, ppq, seed, storeOriginals)
        break

      case 'stack':
        for (const branch of node.branches) {
          applyTransformsToTree(branch.children, ppq, seed, storeOriginals)
        }
        break

      case 'branch':
        applyTransformsToTree(node.children, ppq, seed, storeOriginals)
        break
    }
  }
}

/**
 * Apply transforms to a single event in pipeline order: Quantize → Groove → Humanize.
 * 
 * @returns Final tick position after all transforms
 */
function applyTransformsToEvent(
  event: ExtractedEvent,
  ppq: number,
  seed: number
): number {
  let tick = event.tick
  const random = seededRandom(seed + event.originalIndex)

  // 1. QUANTIZE (snap to grid)
  if (event.quantizeContext) {
    const { gridTicks, strengthPct } = event.quantizeContext
    if (gridTicks > 0) {
      const quantized = Math.round(tick / gridTicks) * gridTicks
      tick = tick + Math.round((quantized - tick) * strengthPct / 100)
    }
  }

  // 2. GROOVE (systematic offset based on beat position)
  if (event.grooveContext && event.grooveContext.offsets.length > 0) {
    const { offsets } = event.grooveContext
    const beatIndex = Math.floor(tick / ppq) % offsets.length
    tick += offsets[beatIndex]
  }

  // 3. HUMANIZE (random variation)
  if (event.humanizeContext) {
    const { timingPpt, velocityPpt } = event.humanizeContext

    // Timing humanization
    if (timingPpt > 0) {
      const maxTimingOffset = (timingPpt / 1000) * ppq
      tick += Math.round((random() - 0.5) * 2 * maxTimingOffset)
    }

    // Velocity humanization (modifies event.args in place)
    if (velocityPpt > 0 && event.opcode === OP.NOTE) {
      const maxVelOffset = (velocityPpt / 1000) * 127
      event.args[1] = Math.max(1, Math.min(127,
        Math.round(event.args[1] + (random() - 0.5) * 2 * maxVelOffset)
      ))
    }
  }

  return Math.max(0, tick)
}

// =============================================================================
// Phase 3: Emit VM Bytecode
// =============================================================================

interface EmitOptions {
  ppq: number
  seed: number
  unroll: boolean
}

/**
 * Emit VM bytecode from tree nodes.
 * Handles structural opcodes (LOOP, STACK, BRANCH) and REST gaps.
 * 
 * @param nodes - Tree nodes to emit
 * @param vmBuf - Output buffer
 * @param scopeStartTick - Absolute tick where this scope starts
 * @param currentTick - Mutable reference to current tick position (relative to scope)
 * @param options - Emit options
 */
function emitNodes(
  nodes: BuilderNode[],
  vmBuf: number[],
  scopeStartTick: number,
  currentTick: { value: number },
  options: EmitOptions
): void {
  // Sort EventNodes within this scope by finalTick (stable sort)
  const sortedNodes = sortNodesInScope(nodes)

  for (const node of sortedNodes) {
    switch (node.type) {
      case 'event':
        emitEvent(node.event, vmBuf, scopeStartTick, currentTick)
        break

      case 'loop':
        emitLoop(node, vmBuf, scopeStartTick, currentTick, options)
        break

      case 'stack':
        emitStack(node, vmBuf, scopeStartTick, currentTick, options)
        break

      case 'branch':
        // Branches are emitted inside emitStack
        emitNodes(node.children, vmBuf, scopeStartTick, currentTick, options)
        break
    }
  }
}

/**
 * Sort nodes in scope: EventNodes sorted by finalTick, structural nodes stay in order.
 * Uses stable sort with originalIndex as tiebreaker.
 */
function sortNodesInScope(nodes: BuilderNode[]): BuilderNode[] {
  // Separate events and structural nodes
  const events: EventNode[] = []
  const structural: { index: number; node: BuilderNode }[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === 'event') {
      events.push(node)
    } else {
      structural.push({ index: i, node })
    }
  }

  // Sort events by finalTick (stable)
  events.sort((a, b) => {
    const tickA = a.event.finalTick ?? a.event.tick
    const tickB = b.event.finalTick ?? b.event.tick
    if (tickA !== tickB) return tickA - tickB
    return a.event.originalIndex - b.event.originalIndex
  })

  // Merge back: events first (in sorted order), then structural (in original order)
  const result: BuilderNode[] = [...events]
  for (const s of structural) {
    result.push(s.node)
  }

  return result
}

/**
 * Emit a single event with REST gap if needed.
 */
function emitEvent(
  event: ExtractedEvent,
  vmBuf: number[],
  scopeStartTick: number,
  currentTick: { value: number }
): void {
  const targetTick = (event.finalTick ?? event.tick) - scopeStartTick

  // Insert REST to reach target tick (if needed)
  if (targetTick > currentTick.value) {
    vmBuf.push(OP.REST, targetTick - currentTick.value)
    currentTick.value = targetTick
  }

  // Emit event in VM format (without tick field)
  switch (event.opcode) {
    case OP.NOTE:
      vmBuf.push(OP.NOTE, event.args[0], event.args[1], event.args[2])
      currentTick.value += event.args[2] // Advance by duration
      break

    case OP.REST:
      vmBuf.push(OP.REST, event.args[0])
      currentTick.value += event.args[0]
      break

    case OP.TEMPO:
      vmBuf.push(OP.TEMPO, event.args[0])
      break

    case OP.CC:
      vmBuf.push(OP.CC, event.args[0], event.args[1])
      break

    case OP.BEND:
      vmBuf.push(OP.BEND, event.args[0])
      break
  }
}

/**
 * Emit a loop node.
 * If unroll=true, expand the loop; otherwise emit LOOP_START/END.
 */
function emitLoop(
  node: LoopNode,
  vmBuf: number[],
  scopeStartTick: number,
  currentTick: { value: number },
  options: EmitOptions
): void {
  if (options.unroll) {
    // UNROLL MODE: Flatten → Sort → Emit
    const unrolledEvents: ExtractedEvent[] = []
    const bodyDuration = calculateBodyDuration(node.originalChildren ?? node.children)

    // Use originalChildren if available (pre-transform), otherwise children
    const sourceChildren = node.originalChildren ?? node.children

    for (let i = 0; i < node.count; i++) {
      // Deep clone the source children for this iteration
      const clonedChildren = deepCloneNodes(sourceChildren)

      // Offset base ticks to iteration position
      const iterOffset = bodyDuration * i
      offsetEventTicks(clonedChildren, iterOffset)

      // Apply transforms with iteration-specific seed
      const iterSeed = options.seed + i * 1000
      applyTransformsToTree(clonedChildren, options.ppq, iterSeed, false)

      // Flatten into events list
      flattenEventsToList(clonedChildren, unrolledEvents)
    }

    // Sort ALL unrolled events by finalTick (handles overlap!)
    unrolledEvents.sort((a, b) => {
      const tickA = a.finalTick ?? a.tick
      const tickB = b.finalTick ?? b.tick
      if (tickA !== tickB) return tickA - tickB
      return a.originalIndex - b.originalIndex
    })

    // Emit as linear sequence with REST gaps
    for (const event of unrolledEvents) {
      emitEvent(event, vmBuf, scopeStartTick, currentTick)
    }
  } else {
    // STRUCTURAL MODE: Emit LOOP_START, body, LOOP_END
    vmBuf.push(OP.LOOP_START, node.count)

    // Loop body is emitted ONCE; VM repeats it
    // Tick within loop body is relative to loop start
    const loopTick = { value: 0 }
    emitNodes(node.children, vmBuf, node.startTick, loopTick, options)

    vmBuf.push(OP.LOOP_END)

    // After loop, currentTick advances by body duration * count
    const bodyDuration = calculateBodyDuration(node.children)
    currentTick.value += bodyDuration * node.count
  }
}

/**
 * Emit a stack node (parallel branches).
 */
function emitStack(
  node: StackNode,
  vmBuf: number[],
  _scopeStartTick: number,
  currentTick: { value: number },
  options: EmitOptions
): void {
  vmBuf.push(OP.STACK_START, node.branches.length)

  let maxBranchDuration = 0

  for (const branch of node.branches) {
    vmBuf.push(OP.BRANCH_START)

    // Each branch starts at the stack's start tick
    // Tick within branch is relative to stack start
    const branchTick = { value: 0 }
    emitNodes(branch.children, vmBuf, node.startTick, branchTick, options)

    if (branchTick.value > maxBranchDuration) {
      maxBranchDuration = branchTick.value
    }

    vmBuf.push(OP.BRANCH_END)
  }

  vmBuf.push(OP.STACK_END)

  // Stack advances tick by max branch duration
  currentTick.value += maxBranchDuration
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Deep clone an array of BuilderNodes.
 */
function deepCloneNodes(nodes: BuilderNode[]): BuilderNode[] {
  return nodes.map(node => {
    switch (node.type) {
      case 'event':
        return {
          type: 'event',
          event: {
            ...node.event,
            args: [...node.event.args],
            humanizeContext: node.event.humanizeContext
              ? { ...node.event.humanizeContext }
              : undefined,
            quantizeContext: node.event.quantizeContext
              ? { ...node.event.quantizeContext }
              : undefined,
            grooveContext: node.event.grooveContext
              ? { offsets: [...node.event.grooveContext.offsets] }
              : undefined
          }
        } as EventNode

      case 'loop':
        return {
          type: 'loop',
          count: node.count,
          startTick: node.startTick,
          children: deepCloneNodes(node.children),
          originalChildren: node.originalChildren
            ? deepCloneNodes(node.originalChildren)
            : undefined
        } as LoopNode

      case 'stack':
        return {
          type: 'stack',
          startTick: node.startTick,
          branches: node.branches.map(b => ({
            type: 'branch',
            children: deepCloneNodes(b.children)
          })) as BranchNode[]
        } as StackNode

      case 'branch':
        return {
          type: 'branch',
          children: deepCloneNodes(node.children)
        } as BranchNode
    }
  })
}

/**
 * Calculate the musical body duration of a set of nodes (uses original tick values).
 * Returns the total duration accounting for loop repetitions.
 */
function calculateBodyDuration(nodes: BuilderNode[]): number {
  let totalDuration = 0

  for (const node of nodes) {
    switch (node.type) {
      case 'event': {
        const duration = node.event.opcode === OP.NOTE ? node.event.args[2] : 
                        node.event.opcode === OP.REST ? node.event.args[0] : 0
        totalDuration += duration
        break
      }
      case 'loop': {
        // Recursively calculate inner body duration and multiply by count
        const innerDuration = calculateBodyDuration(node.children)
        totalDuration += innerDuration * node.count
        break
      }
      case 'stack': {
        // Stack duration is max of all branches
        let maxBranchDuration = 0
        for (const branch of node.branches) {
          const branchDuration = calculateBodyDuration(branch.children)
          if (branchDuration > maxBranchDuration) {
            maxBranchDuration = branchDuration
          }
        }
        totalDuration += maxBranchDuration
        break
      }
      case 'branch':
        totalDuration += calculateBodyDuration(node.children)
        break
    }
  }

  return totalDuration
}

/**
 * Add offset to all event ticks in a tree (mutates in place).
 */
function offsetEventTicks(nodes: BuilderNode[], offset: number): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'event':
        node.event.tick += offset
        break
      case 'loop':
        node.startTick += offset
        offsetEventTicks(node.children, offset)
        break
      case 'stack':
        node.startTick += offset
        for (const branch of node.branches) {
          offsetEventTicks(branch.children, offset)
        }
        break
      case 'branch':
        offsetEventTicks(node.children, offset)
        break
    }
  }
}

/**
 * Extract all events from tree into flat list (for unroll sorting).
 * IMPORTANT: Recursively unrolls nested loops!
 */
function flattenEventsToList(nodes: BuilderNode[], list: ExtractedEvent[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'event':
        list.push(node.event)
        break
      case 'loop':
        // Recursively unroll nested loops
        for (let i = 0; i < node.count; i++) {
          const cloned = deepCloneNodes(node.children)
          offsetEventTicks(cloned, calculateBodyDuration(node.children) * i)
          flattenEventsToList(cloned, list)
        }
        break
      case 'stack':
        for (const branch of node.branches) {
          flattenEventsToList(branch.children, list)
        }
        break
      case 'branch':
        flattenEventsToList(node.children, list)
        break
    }
  }
}

/**
 * Calculate total ticks from the tree (for TOTAL_LENGTH register).
 */
function calculateTotalTicks(nodes: BuilderNode[]): number {
  let maxTick = 0

  function scan(ns: BuilderNode[], baseOffset: number = 0): void {
    for (const node of ns) {
      switch (node.type) {
        case 'event': {
          const tick = (node.event.finalTick ?? node.event.tick)
          const duration = node.event.opcode === OP.NOTE ? node.event.args[2] :
                          node.event.opcode === OP.REST ? node.event.args[0] : 0
          const endTick = tick + duration
          if (endTick > maxTick) maxTick = endTick
          break
        }
        case 'loop': {
          // For loops, multiply body by count
          const bodyDuration = calculateBodyDuration(node.children)
          const loopEnd = node.startTick + bodyDuration * node.count
          if (loopEnd > maxTick) maxTick = loopEnd
          // Also scan children for any events that extend beyond
          scan(node.children, node.startTick)
          break
        }
        case 'stack': {
          for (const branch of node.branches) {
            scan(branch.children, node.startTick)
          }
          break
        }
        case 'branch':
          scan(node.children, baseOffset)
          break
      }
    }
  }

  scan(nodes)
  return maxTick
}
