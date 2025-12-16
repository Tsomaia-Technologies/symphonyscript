// =============================================================================
// SymphonyScript - Tempo Resolver
// Implementation of RFC-015: Hierarchical Tempo Inheritance
// =============================================================================

import type { SessionNode, TrackNode } from '../session/types'
import type { ClipNode } from '../clip/types'

/**
 * Resolves the initial tempo for a track based on the hierarchy:
 * 1. Clip-level tempo operation (first tempo op found)
 * 2. Track-level tempo override
 * 3. Session-level global tempo
 * 4. Default fallback (120 BPM)
 */
export function resolveInitialTempo(
  session: SessionNode,
  track: TrackNode,
  clip: ClipNode
): number {
  // 1. Check for clip-level tempo operation
  // CRITICAL: Only tempo ops BEFORE the first musical content count as "initial."
  // If tempo() is called after notes/chords have started, it's a mid-clip change,
  // not the initial tempo for compilation.
  
  // Find the index of the first musical content (note, rest, or structural op)
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
  
  // Search for static tempo op only BEFORE first musical content
  const searchRange = firstContentIndex === -1 
    ? clip.operations 
    : clip.operations.slice(0, firstContentIndex)
  
  const tempoOp = searchRange.find(op => op.kind === 'tempo' && !op.transition)
  if (tempoOp && tempoOp.kind === 'tempo') {
    return tempoOp.bpm
  }

  // 2. Check track-level override
  if (track.tempo !== undefined) {
    return track.tempo
  }

  // 3. Check session-level default
  if (session.tempo !== undefined) {
    return session.tempo
  }

  // 4. Global fallback
  return 120
}
