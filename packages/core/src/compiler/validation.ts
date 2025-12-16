import type { SessionNode } from '../session/types'
import type { ClipNode, ClipOperation } from '../clip/types'
import { Instrument } from '../instrument/Instrument'

export interface ValidationIssue {
  level: 'warning' | 'error'
  code: string
  message: string
  location?: { clip: string; opIndex?: number }
}

export function validateSession(session: SessionNode): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const instruments = new Set<Instrument>()
  const instrumentNames = new Map<string, Instrument>()

  // 1. Collect Instruments & Check Names
  session.tracks.forEach(track => {
    const inst = track.instrument
    instruments.add(inst)

    if (inst.name) {
      const existing = instrumentNames.get(inst.name)
      if (existing && existing !== inst) {
        issues.push({
          level: 'warning',
          code: 'DUPLICATE_INSTRUMENT_NAME',
          message: `Instrument name '${inst.name}' is used by multiple different instruments.`,
        })
      } else {
        instrumentNames.set(inst.name, inst)
      }
    }
  })

  // 2. Validate Sidechain References
  instruments.forEach(inst => {
    const sc = inst.sidechainConfig
    if (sc) {
      if (!instruments.has(sc.source)) {
        issues.push({
          level: 'warning',
          code: 'SIDECHAIN_SOURCE_NOT_IN_SESSION',
          message: `Instrument '${inst.name ?? 'Untitled'}' uses a sidechain source that is not in the session.`,
        })
      }
    }
  })

  // 3. Validate Tracks & Clips (Iterative DFS)
  session.tracks.forEach(track => {
    validateClipIterative(track.clip, issues)
  })

  return issues
}

interface ValidationFrame {
  ops: ClipOperation[]
  pc: number
  contextClipName: string
  path: Set<ClipNode>
}

function validateClipIterative(rootClip: ClipNode, issues: ValidationIssue[]) {
  // Check root clip for empty
  if (rootClip.operations.length === 0) {
    issues.push({
      level: 'warning',
      code: 'EMPTY_CLIP',
      message: `Clip '${rootClip.name}' has no operations.`,
      location: { clip: rootClip.name }
    })
  } else if (rootClip.operations.length > 20000) {
    issues.push({
      level: 'warning',
      code: 'MAX_OPERATIONS_PER_CLIP',
      message: `Clip '${rootClip.name}' has ${rootClip.operations.length} operations. Limit is 20000.`,
      location: { clip: rootClip.name }
    })
  }

  const stack: ValidationFrame[] = [
    {
      ops: rootClip.operations,
      pc: 0,
      contextClipName: rootClip.name,
      path: new Set([rootClip])
    }
  ]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]

    if (frame.pc >= frame.ops.length) {
      stack.pop()
      continue
    }

    const op = frame.ops[frame.pc]
    const currentIndex = frame.pc
    frame.pc++

    // Local Checks
    if (op.kind === 'loop') {
      if (op.count > 1000) {
        issues.push({
          level: 'warning',
          code: 'LARGE_LOOP_COUNT',
          message: `Loop count ${op.count} is very large.`,
          location: { clip: frame.contextClipName, opIndex: currentIndex }
        })
      }
      // Recurse into loop body (same clip context)
      stack.push({
        ops: op.operations,
        pc: 0,
        contextClipName: frame.contextClipName,
        path: frame.path // Same path since no new ClipNode
      })
    } else if (op.kind === 'stack') {
      // Recurse into stack body (same clip context)
      stack.push({
        ops: op.operations,
        pc: 0,
        contextClipName: frame.contextClipName,
        path: frame.path
      })
    } else if (op.kind === 'transpose') {
      if (Math.abs(op.semitones) > 48) {
        issues.push({
          level: 'warning',
          code: 'EXTREME_TRANSPOSITION',
          message: `Transposition of ${op.semitones} semitones is unusually large.`,
          location: { clip: frame.contextClipName, opIndex: currentIndex }
        })
      }
      // Recurse into transposition body
      stack.push({
        ops: [op.operation],
        pc: 0,
        contextClipName: frame.contextClipName,
        path: frame.path
      })
    } else if (op.kind === 'scope') {
      // Recurse into scope body
      stack.push({
        ops: [op.operation],
        pc: 0,
        contextClipName: frame.contextClipName,
        path: frame.path
      })
    } else if (op.kind === 'clip') {
      const childClip = op.clip
      if (frame.path.has(childClip)) {
        issues.push({
          level: 'error',
          code: 'CIRCULAR_CLIP_REFERENCE',
          message: `Circular reference detected: Clip '${frame.contextClipName}' includes itself (or an ancestor) '${childClip.name}'.`,
          location: { clip: frame.contextClipName, opIndex: currentIndex }
        })
      } else {
        if (childClip.operations.length === 0) {
          issues.push({
            level: 'warning',
            code: 'EMPTY_CLIP',
            message: `Clip '${childClip.name}' has no operations.`,
            location: { clip: childClip.name }
          })
        }

        const newPath = new Set(frame.path)
        newPath.add(childClip)

        stack.push({
          ops: childClip.operations,
          pc: 0,
          contextClipName: childClip.name,
          path: newPath
        })
      }
    }
  }
}
