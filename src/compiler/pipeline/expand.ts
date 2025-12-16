import type { ClipNode, ClipOperation } from '../../clip/types'
import type { BlockMarker, ExpandedSequence, PipelineMarker, PipelineOp } from './types'

// Union type for the processing stack (can be original Op or Marker)
type ExpandableOp = ClipOperation | PipelineMarker | import('../../clip/types').ScopeOp

export type ExpansionLimitType = 'depth' | 'loops' | 'operations'

export class ExpansionError extends Error {
  constructor(
    message: string,
    public readonly limitType: ExpansionLimitType,
    public readonly sourceClip: string
  ) {
    super(message)
    this.name = 'ExpansionError'
  }
}

export interface ExpansionLimits {
  maxDepth?: number           // Default: 1000
  maxLoopExpansions?: number  // Default: 10000 (loop iterations)
  maxOperations?: number      // NEW: Default: 100000 (output ops)
}

const DEFAULT_LIMITS: Required<ExpansionLimits> = {
  maxDepth: 1000,
  maxLoopExpansions: 10000,
  maxOperations: 100000
}

interface ExpandFrame {
  ops: readonly ExpandableOp[]
  pc: number
  depth: number
  sourceClip: string
  loopRemaining?: number
  loopIteration?: number
  swing?: number
  groove?: any // GrooveTemplate
}

/**
 * Expand clip into flat operation sequence with markers.
 * Uses ONLY iterative stack — NO recursion.
 * Flattens stacks into Start -> Branches -> End sequence.
 */
export function expandClip(
  clip: ClipNode,
  limits: ExpansionLimits = {}
): ExpandedSequence {
  const config = { ...DEFAULT_LIMITS, ...limits }
  const result: PipelineOp[] = []

  // Initial frame from root clip
  const stack: ExpandFrame[] = [{
    ops: clip.operations,
    pc: 0,
    depth: 0,
    sourceClip: clip.name ?? 'root',
    swing: clip.swing,
    groove: clip.groove
  }]

  let totalLoops = 0
  let maxDepthSeen = 0
  let clipCount = 1
  let seqId = 0

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    maxDepthSeen = Math.max(maxDepthSeen, frame.depth)

    if (frame.depth > config.maxDepth) {
      throw new ExpansionError(
        `Max depth ${config.maxDepth} exceeded in '${frame.sourceClip}'`,
        'depth',
        frame.sourceClip
      )
    }

    // Operation count limit (NEW)
    if (result.length >= config.maxOperations) {
      throw new ExpansionError(
        `Max operations ${config.maxOperations} exceeded. ` +
        `Composition would produce ${result.length}+ operations. ` +
        `Reduce loop counts or increase maxOperations limit.`,
        'operations',
        frame.sourceClip
      )
    }

    // Frame Complete?
    if (frame.pc >= frame.ops.length) {
      if (frame.loopRemaining && frame.loopRemaining > 0) {
        frame.loopRemaining--
        frame.loopIteration = (frame.loopIteration ?? 0) + 1
        frame.pc = 0
        totalLoops++
        if (totalLoops > config.maxLoopExpansions) {
          throw new ExpansionError(
            `Max loop expansions ${config.maxLoopExpansions} exceeded`,
            'loops',
            frame.sourceClip
          )
        }
        continue
      }
      stack.pop()
      continue
    }

    const op = frame.ops[frame.pc++]

    // Handle Markers (pass through)
    if (isMarker(op)) {
      result.push(op)
      continue
    }

    // Handle Clip Operations
    switch (op.kind) {
      case 'scope': {
        const scopeOp = op as import('../../clip/types').ScopeOp

        const flattenedOps: ExpandableOp[] = []

        const scopeStart: PipelineMarker = {
          kind: 'scope_start',
          depth: frame.depth,
          delta: {},
          isolate: scopeOp.isolate
        }
        flattenedOps.push(scopeStart)

        flattenedOps.push(scopeOp.operation)

        flattenedOps.push({
          kind: 'scope_end',
          depth: frame.depth,
          isolate: scopeOp.isolate
        })

        stack.push({
          ops: flattenedOps,
          pc: 0,
          depth: frame.depth,
          sourceClip: frame.sourceClip,
          swing: frame.swing,
          groove: frame.groove
        })
        break
      }

      case 'loop':
        if (op.count > 0) {
          stack.push({
            ops: op.operations,
            pc: 0,
            depth: frame.depth + 1,
            sourceClip: frame.sourceClip,
            loopRemaining: op.count - 1,
            loopIteration: 0,
            swing: frame.swing,
            groove: frame.groove
          })
        }
        break

      case 'clip':
        clipCount++

        // Default Isolation Logic:
        // Unless explicitly opted out via inheritTempo: true, we wrap nested clips in a tempo scope.
        const shouldIsolateTempo = !op.inheritTempo

        if (shouldIsolateTempo) {
          // Wrapped expansion: ScopeStart -> Clip -> ScopeEnd
          const flattenedOps: ExpandableOp[] = []

          flattenedOps.push({
            kind: 'scope_start',
            depth: frame.depth,
            delta: {},
            isolate: { tempo: true }
          })

          // We can't push the op itself again or we infinite loop if we aren't careful.
          // But here we are pushing a NEW frame with the wrapped sequence.
          // Wait, if we push the 'op' again, we hit this case again.
          // We need to push the clip's OPERATIONS directly into the scope sandwich?
          // OR mark the op as "already processed" or "raw"?
          // Better: The 'clip' case logic is normally: push clip.operations.
          // So here we push [ScopeStart, ...clip.operations, ScopeEnd]

          // However, we want to maintain the stack frame properties (sourceClip name etc) correctly.
          // If we flatten here, we might lose the "Clip boundary" semantics if not careful?
          // Actually, standard expansion just pushes operations.

          // Let's do:
          // Stack push:
          // [ScopeEnd]
          // ...clip.operations...
          // [ScopeStart]
          // (Stack is LIFO, so we push in reverse order? No, stack frames are popped.
          // But `frame.ops` is iterated linearly.
          // So we construct a new list of ops: Start, ...ops, End.

          // BUT `frame.ops` is readonly in the type def usually, but we are creating a new frame.

          const innerOps = [
            {
              kind: 'scope_start',
              depth: frame.depth + 1,
              delta: {},
              isolate: { tempo: true }
            } as PipelineMarker,
            ...op.clip.operations,
            {
              kind: 'scope_end',
              depth: frame.depth + 1,
              isolate: { tempo: true }
            } as PipelineMarker
          ]

          stack.push({
            ops: innerOps,
            pc: 0,
            depth: frame.depth + 1,
            sourceClip: op.clip.name ?? 'anonymous',
            swing: op.clip.swing ?? frame.swing,
            groove: op.clip.groove ?? frame.groove
          })

        } else {
          // Legacy behavior (Inherited Tempo)
          stack.push({
            ops: op.clip.operations,
            pc: 0,
            depth: frame.depth + 1,
            sourceClip: op.clip.name ?? 'anonymous',
            swing: op.clip.swing ?? frame.swing,
            groove: op.clip.groove ?? frame.groove
          })
        }
        break

      case 'stack': {
        // Flatten stack into markers + children
        // Structure: StackStart -> (BranchStart -> Child -> BranchEnd)* -> StackEnd
        const flattenedOps: ExpandableOp[] = []

        const stackStart: PipelineMarker = { kind: 'stack_start', depth: frame.depth }
        flattenedOps.push(stackStart)

        for (const child of op.operations) {
          const branchStart: PipelineMarker = { kind: 'branch_start', depth: frame.depth + 1 }
          const branchEnd: PipelineMarker = { kind: 'branch_end', depth: frame.depth + 1 }

          flattenedOps.push(branchStart)

          // Optimization: If child is a clip, just push the clip op (let next loop expand it)
          // If child is a stack, push the stack op (let next loop expand it recursively)
          // This keeps the "ops" list flat-ish
          flattenedOps.push(child)

          flattenedOps.push(branchEnd)
        }

        const stackEnd: PipelineMarker = { kind: 'stack_end', depth: frame.depth }
        flattenedOps.push(stackEnd)

        // Push new frame to process this flattened sequence
        stack.push({
          ops: flattenedOps,
          pc: 0,
          depth: frame.depth, // Same depth (logical) or +1? Markers have depth.
          sourceClip: frame.sourceClip,
          swing: frame.swing,
          groove: frame.groove
        })
        break
      }

      case 'transpose': {
        // Flatten: ScopeStart -> Operation -> ScopeEnd
        const flattenedOps: ExpandableOp[] = []

        const scopeStart: PipelineMarker = {
          kind: 'scope_start',
          depth: frame.depth,
          delta: { transposition: op.semitones }
        }
        flattenedOps.push(scopeStart)

        flattenedOps.push(op.operation)

        flattenedOps.push({
          kind: 'scope_end',
          depth: frame.depth
        })

        stack.push({
          ops: flattenedOps,
          pc: 0,
          depth: frame.depth,
          sourceClip: frame.sourceClip,
          swing: frame.swing,
          groove: frame.groove
        })
        break
      }

      case 'block': {
        // Emit BlockMarker - do NOT traverse into block
        const marker: BlockMarker = {
          kind: 'block_marker',
          block: op.block,
          depth: frame.depth
        }
        result.push(marker)
        break
      }

      default:
        // Atomic Ops
        result.push({
          kind: 'op',
          original: op,
          depth: frame.depth,
          sourceClip: frame.sourceClip,
          loopIteration: frame.loopIteration,
          sequenceId: seqId++,
          swing: frame.swing,
          groove: frame.groove
        })
    }
  }

  return {
    operations: result,
    metadata: {
      totalLoopExpansions: totalLoops,
      maxDepth: maxDepthSeen,
      clipCount,
      operationCount: result.length
    }
  }
}

function isMarker(op: ExpandableOp): op is PipelineMarker {
  return 'kind' in op && (
    op.kind === 'stack_start' ||
    op.kind === 'stack_end' ||
    op.kind === 'branch_start' ||
    op.kind === 'branch_end' ||
    op.kind === 'scope_start' ||
    op.kind === 'scope_end' ||
    op.kind === 'block_marker'
  )
}
