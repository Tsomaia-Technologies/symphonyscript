import type {ClipNode} from '../../clip/types'
import type {TimeSignatureString} from '../../types/primitives'
import type {BlockEndState, CompiledBlock} from './types'
import type {PlaybackManifest} from '../pipeline/types'
import {compileClip} from '../pipeline/index'
import {hashClipNode} from './hash'
import {type BlockCache, getDefaultCache} from './cache'

export interface BlockCompileOptions {
  /** Initial tempo (required - blocks don't inherit) */
  bpm: number

  /** Initial time signature */
  timeSignature?: TimeSignatureString

  /** Initial transposition offset */
  transposition?: number

  /** Cache to use (defaults to global cache) */
  cache?: BlockCache
}

/**
 * Compile a clip into a reusable, cacheable block.
 */
export function compileBlock(
  clip: ClipNode,
  options: BlockCompileOptions
): CompiledBlock {
  const cache = options.cache ?? getDefaultCache()
  const hash = hashClipNode(clip)

  // Check cache first
  const cached = cache.get(hash)
  if (cached) {
    return cached
  }

  // Compile normally
  const compiled = compileClip(clip, {
    bpm: options.bpm,
    timeSignature: options.timeSignature ?? '4/4'
  })

  // Extract end state
  const endState = extractEndState(compiled, options)

  // Create empty manifest if none exists
  const manifest: PlaybackManifest = compiled.manifest ?? {
    pitchBendRange: 2,
    controllersUsed: [],
    instruments: {}
  }

  // Package as block
  const block: CompiledBlock = {
    kind: 'compiled_block',
    sourceName: clip.name,
    hash,
    durationBeats: compiled.durationBeats,
    durationSeconds: compiled.durationSeconds,
    events: compiled.events,
    tempoMap: compiled.tempoMap,
    endState,
    manifest
  }

  cache.set(hash, block)
  return block
}

function extractEndState(
  compiled: { durationBeats: number; tempoMap: { getBpmAt(beat: number): number } },
  options: BlockCompileOptions
): BlockEndState {
  const finalTempo = compiled.tempoMap.getBpmAt(compiled.durationBeats)

  return {
    tempo: finalTempo,
    transposition: 0,
    timeSignature: options.timeSignature ?? '4/4',
    velocityMultiplier: 1
  }
}
