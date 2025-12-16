import type { ClipNode, ClipOperation, LoopOp } from '../../clip/types'

export interface ExpansionEstimate {
  estimatedOperations: number
  estimatedDepth: number
  estimatedMemoryMB: number
  warnings: string[]
}

const BYTES_PER_OP = 300 // Conservative estimate

/**
 * Estimate expansion size without actually expanding.
 * Uses heuristics — may underestimate complex recursive patterns.
 */
export function estimateExpansion(clip: ClipNode): ExpansionEstimate {
  const warnings: string[] = []
  let ops = 0
  let maxDepth = 0

  interface EstimateFrame {
    operations: readonly ClipOperation[]
    index: number
    depth: number
    multiplier: number
  }

  const stack: EstimateFrame[] = [{
    operations: clip.operations,
    index: 0,
    depth: 0,
    multiplier: 1
  }]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    maxDepth = Math.max(maxDepth, frame.depth)

    if (frame.index >= frame.operations.length) {
      stack.pop()
      continue
    }

    const op = frame.operations[frame.index++]

    switch (op.kind) {
      case 'loop': {
        const shape = op as LoopOp
        const count = shape.count

        if (count > 100) {
          warnings.push(
            `Loop with ${count} iterations at depth ${frame.depth} — ` +
            `consider reducing or using patterns`
          )
        }

        stack.push({
          operations: shape.operations,
          index: 0,
          depth: frame.depth + 1,
          multiplier: frame.multiplier * count
        })
        break
      }
      case 'clip':
        stack.push({
          operations: op.clip.operations,
          index: 0,
          depth: frame.depth + 1,
          multiplier: frame.multiplier
        })
        break
      case 'stack':
        // For stack operations, we need to visit all children.
        // We can just push them all as separate frames.
        // Since it's a stack, pushing them in reverse order would process them in order,
        // but for estimation order doesn't strictly matter for the count.
        // However, to be nice and predictable, let's reverse iteration so the first one is at the top.
        for (let i = op.operations.length - 1; i >= 0; i--) {
          stack.push({
            operations: [op.operations[i]],
            index: 0,
            depth: frame.depth + 1,
            multiplier: frame.multiplier
          })
        }
        break
      default:
        ops += frame.multiplier
    }
  }

  const memoryMB = (ops * BYTES_PER_OP) / (1024 * 1024)

  if (memoryMB > 100) {
    warnings.push(
      `Estimated memory usage: ${memoryMB.toFixed(1)} MB — ` +
      `consider simplifying composition`
    )
  }

  return {
    estimatedOperations: ops,
    estimatedDepth: maxDepth,
    estimatedMemoryMB: memoryMB,
    warnings
  }
}
