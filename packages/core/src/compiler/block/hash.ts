import type {ClipNode, ClipOperation} from '../../clip/types'
import type {BlockHash} from './types'

/**
 * Generate a stable hash of a ClipNode for cache invalidation.
 */
export function hashClipNode(clip: ClipNode): BlockHash {
  const hasher = new Hasher()
  hashClip(hasher, clip)
  return hasher.digest() as BlockHash
}

class Hasher {
  private parts: string[] = []

  add(value: unknown): void {
    this.parts.push(JSON.stringify(value))
  }

  digest(): string {
    const str = this.parts.join('|')
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `block_${Math.abs(hash).toString(16)}`
  }
}

function hashClip(h: Hasher, clip: ClipNode): void {
  h.add(clip.name)
  h.add(clip.tempo)
  h.add(clip.timeSignature)
  h.add(clip.swing)

  for (const op of clip.operations) {
    hashOperation(h, op)
  }
}

function hashOperation(h: Hasher, op: ClipOperation): void {
  h.add(op.kind)

  switch (op.kind) {
    case 'note':
      h.add(op.note)
      h.add(op.duration)
      h.add(op.velocity)
      h.add(op.articulation)
      h.add(op.humanize)
      h.add(op.detune)
      h.add(op.timbre)
      h.add(op.pressure)
      break
    case 'rest':
      h.add(op.duration)
      break
    case 'loop':
      h.add(op.count)
      op.operations.forEach((child: ClipOperation) => hashOperation(h, child))
      break
    case 'clip':
      hashClip(h, op.clip)
      break
    case 'stack':
      op.operations.forEach((child: ClipOperation) => hashOperation(h, child))
      break
    case 'block':
      h.add(op.block.hash)
      break
    case 'transpose':
      h.add(op.semitones)
      break
    case 'control':
      h.add(op.controller)
      h.add(op.value)
      break
    case 'tempo':
      h.add(op.bpm)
      h.add(op.transition)
      break
    case 'time_signature':
      h.add(op.signature)
      break
    case 'dynamics':
      h.add(op.type)
      h.add(op.from)
      h.add(op.to)
      h.add(op.duration)
      h.add(op.curve)
      break
    case 'aftertouch':
      h.add(op.type)
      h.add(op.value)
      h.add(op.note)
      break
    case 'vibrato':
      h.add(op.depth)
      h.add(op.rate)
      break
    case 'automation':
      h.add(op.target)
      h.add(op.value)
      h.add(op.rampBeats)
      h.add(op.curve)
      break
    case 'pitch_bend':
      h.add(op.semitones)
      break
  }
}
