/**
 * RFC-026.9: Incremental Compilation
 *
 * Public exports for incremental compilation module.
 */

// Types
export type {
  Section,
  ProjectionSnapshot,
  SerializedTieState,
  CompilationCache,
  CachedSection,
  InvalidationResult,
  IncrementalCompileOptions,
  IncrementalCompileResult
} from './types'

// Hash utilities
export {
  stableSerialize,
  hashOperation,
  hashOperations,
  hashClip,
  operationsEqual,
  isCascadingChange
} from './hash'

// Section detection
export {
  isSectionBoundary,
  detectSections,
  updateSectionBeats,
  findFirstChangedSection,
  getSectionOperations
} from './sections'

// State snapshots
export {
  initialProjectionState,
  captureSnapshot,
  captureSnapshotFromTimed,
  serializeActiveTies,
  deserializeActiveTies,
  advanceSnapshot,
  updateSnapshotTies,
  type NoteQueueItem,
  type InitialStateOptions,
  type SnapshotContext
} from './snapshot'

// Cache management
export {
  createCache,
  buildCache,
  updateCache,
  getCachedEvents,
  getCachedEntryState,
  isCacheValid,
  type BuildCacheOptions
} from './cache'

// Main compilation
export {
  incrementalCompile,
  findInvalidatedSections,
  compileFromState,
  type IncrementalPipelineOptions
} from './compile'
