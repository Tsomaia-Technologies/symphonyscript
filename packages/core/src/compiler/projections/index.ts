/**
 * RFC-026: Event Sourcing Compiler - Projections Module
 * 
 * Public API for the projection-based compiler architecture.
 */

// Types
export type {
  Projection,
  ProjectionContext,
  ExpandProjection,
  TimeProjection,
  TieProjection,
  EmitProjection,
  PipelineConfig,
  ComposedPipeline
} from './types'

// Phase wrappers
export {
  expandProjection,
  timeProjection,
  tieProjection,
  emitProjection,
  buildTempoMapFromSequence
} from './phases'

// Composition
export {
  compose,
  compileClipV2
} from './compose'
