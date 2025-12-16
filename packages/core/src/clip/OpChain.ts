// =============================================================================
// SymphonyScript - Persistent OpChain (Cons-Cell)
// =============================================================================

import type {ClipOperation, StackOp, TransposeOp} from './types'

/**
 * A persistent, immutable linked list node for Clip operations.
 * Enables O(1) appends and efficient "modify last note" operations.
 */
export class OpChain {
  readonly length: number
  readonly lastNoteIndex: number

  constructor(
    public readonly op: ClipOperation,
    public readonly parent?: OpChain
  ) {
    this.length = (parent?.length ?? 0) + 1

    // Determine if this operation is a "note-containing" operation
    // that modifiers (staccato, accent, etc.) might want to target.
    if (isModifiable(op)) {
      this.lastNoteIndex = this.length - 1
    } else {
      this.lastNoteIndex = parent?.lastNoteIndex ?? -1
    }
  }

  /** Convert the chain to an array of operations (in correct order) */
  toArray(): ClipOperation[] {
    const result: ClipOperation[] = new Array(this.length)
    let current: OpChain | undefined = this
    let i = this.length - 1

    while (current) {
      result[i] = current.op
      current = current.parent
      i--
    }

    return result
  }
}

/** Check if an operation is a valid target for note modifiers */
function isModifiable(op: ClipOperation): boolean {
  if (op.kind === 'note') return true

  if (op.kind === 'stack') {
    const stack = op as StackOp
    return stack.operations.some(child => child.kind === 'note')
  }

  if (op.kind === 'transpose') {
    const trans = op as TransposeOp
    if (trans.operation.kind === 'note') return true
    if (trans.operation.kind === 'stack') {
      return (trans.operation as StackOp).operations.some(child => child.kind === 'note')
    }
  }

  return false
}






