/**
 * RFC-026: Event Sourcing Compiler - Pipeline Composition
 * 
 * Composes projections into a complete pipeline.
 */

import type { ClipNode } from '../../clip/types'
import type { CompiledClip } from '../pipeline/types'
import type { PipelineConfig, ComposedPipeline } from './types'
import type { AsciiOptions } from '../../debug/ascii'
import { renderPattern } from '../../debug/ascii'
import { ExpansionError, estimateExpansion } from '../pipeline'
import { generateManifest } from '../pipeline/manifest'

import {
  expandProjection,
  timeProjection,
  tieProjection,
  emitProjection,
  buildTempoMapFromSequence
} from './phases'

// =============================================================================
// Pipeline Composition
// =============================================================================

/**
 * Compose projections into a complete pipeline.
 * This is the V2 compilation function using the projection architecture.
 * 
 * Output is identical to compileClip() from pipeline/index.ts.
 */
export function compose(): ComposedPipeline {
  return {
    compile(clip: ClipNode, config: PipelineConfig): CompiledClip {
      return compileClipV2(clip, config)
    }
  }
}

/**
 * Compile clip through projection pipeline.
 * Produces identical output to compileClip().
 */
export function compileClipV2(clip: ClipNode, options: PipelineConfig): CompiledClip {
  // Pre-estimation check (optional)
  if (options.preEstimate) {
    const estimate = estimateExpansion(clip)
    const maxOps = options.maxOperations ?? 100000

    if (estimate.estimatedOperations > maxOps) {
      throw new ExpansionError(
        `Composition would produce ~${estimate.estimatedOperations.toLocaleString()} operations ` +
        `(limit: ${maxOps.toLocaleString()}). ` +
        (estimate.warnings.length > 0
          ? `Hints: ${estimate.warnings.join('; ')}`
          : 'Reduce loop counts or nested clips.'),
        'operations',
        clip.name ?? 'root'
      )
    }
  }

  // Phase 1: Expand
  const expanded = expandProjection.execute(clip, {
    maxDepth: options.maxDepth,
    maxLoopExpansions: options.maxLoopExpansions,
    maxOperations: options.maxOperations
  })

  // Phase 2: Timing
  const timed = timeProjection.execute(
    expanded, 
    (options.timeSignature ?? '4/4') as any
  )

  // Phase 3: Tie Coalescing
  const coalesced = tieProjection.execute(timed)

  // Build Tempo Map
  const tempoMap = buildTempoMapFromSequence(coalesced.sequence, options.bpm, {
    tempoPrecision: options.tempoPrecision,
    sampleRate: options.sampleRate
  })

  // Phase 4: Emit
  const result = emitProjection.execute(coalesced.sequence, tempoMap, {
    defaultVelocity: options.defaultVelocity,
    channel: options.channel,
    sampleRate: options.sampleRate,
    seed: options.seed
  })

  // Generate Manifest
  result.manifest = generateManifest(result.events)

  // Merge warnings
  if (coalesced.warnings.length > 0) {
    result.metadata.warnings.push(...coalesced.warnings.map(w => w.message))
  }

  // Attach debug methods
  result.print = (asciiOptions?: AsciiOptions) => {
    console.log(renderPattern(result.events, clip.name ?? 'Clip', {
      bpm: options.bpm,
      ...asciiOptions
    }))
  }

  result.toAscii = (asciiOptions?: AsciiOptions) => {
    return renderPattern(result.events, clip.name ?? 'Clip', {
      bpm: options.bpm,
      ...asciiOptions
    })
  }

  return result
}
