import type {TimeSignatureString} from '../../types/primitives'
import type {CompiledEvent, PlaybackManifest, TempoMap} from '../pipeline/types'

/**
 * Hash of a ClipNode for cache invalidation.
 */
export type BlockHash = string & { readonly __brand: 'BlockHash' }

/**
 * State captured at the end of a compiled block.
 */
export interface BlockEndState {
  tempo: number
  transposition: number
  timeSignature: TimeSignatureString
  velocityMultiplier: number
}

/**
 * A pre-compiled, cacheable unit of music.
 */
export interface CompiledBlock {
  kind: 'compiled_block'

  /** Source clip name (for debugging) */
  sourceName: string

  /** Hash for cache key */
  hash: BlockHash

  /** Duration in beats */
  durationBeats: number

  /** Duration in seconds (at block's internal tempo) */
  durationSeconds: number

  /** Events with times relative to block start */
  events: CompiledEvent[]

  /** Tempo map for this block (relative) */
  tempoMap: TempoMap

  /** State at block end */
  endState: BlockEndState

  /** Manifest for this block */
  manifest: PlaybackManifest
}
