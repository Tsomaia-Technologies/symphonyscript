// =============================================================================
// SymphonyScript - Time Signature Resolver
// Implementation of RFC-016: Hierarchical Time Signature
// =============================================================================

import type { SessionNode, TrackNode } from '../../../../symphonyscript/packages/core/src/session/types'
import type { ClipNode } from '../clip/types'
import type { TimeSignatureString } from '../../../../symphonyscript/packages/core/src/types/primitives'

/**
 * Resolves the initial time signature for a track based on the hierarchy:
 * 1. Clip-level time signature operation (first relevant op)
 * 2. Track-level override
 * 3. Session-level global time signature
 * 4. Global default (4/4)
 */
export function resolveInitialTimeSignature(
  session: SessionNode,
  track: TrackNode,
  clip: ClipNode
): TimeSignatureString {
  // 1. Check for clip-level time signature operation
  // CRITICAL: Only time sig ops BEFORE the first musical content count as "initial."
  // If timeSignature() is called after notes have started, it's a mid-clip change,
  // not the initial context for compilation.
  
  // Find the index of the first musical content (note, rest, stack, or loop)
  const firstContentIndex = clip.operations.findIndex(op => {
    switch (op.kind) {
      case 'note':
      case 'rest':
      case 'stack':
      case 'loop':
        return true
      default:
        return false
    }
  })
  
  // Search for time sig op only BEFORE first musical content
  const searchRange = firstContentIndex === -1 
    ? clip.operations 
    : clip.operations.slice(0, firstContentIndex)
  
  const timeSigOp = searchRange.find(op => op.kind === 'time_signature')
  if (timeSigOp && timeSigOp.kind === 'time_signature') {
    return timeSigOp.signature
  }

  // 2. Check track-level override
  if (track.timeSignature !== undefined) {
    return track.timeSignature
  }

  // 3. Check session-level default
  if (session.timeSignature !== undefined) {
    return session.timeSignature
  }

  // 4. Global default
  return '4/4'
}
