// Live Mirror pattern (RFC-043 Phase 4)
export { LiveClipBuilder } from './LiveClipBuilder'
export { LiveMelodyBuilder } from './LiveMelodyBuilder'
export { LiveDrumBuilder } from './LiveDrumBuilder'
export { LiveKeyboardBuilder } from './LiveKeyboardBuilder'
export { LiveStringsBuilder } from './LiveStringsBuilder'
export { LiveWindBuilder } from './LiveWindBuilder'
export { LiveSession, executeUserScript } from './LiveSession'
export { Clip } from './Clip'

// Live Cursors (RFC-043 Phase 4)
export {
  LiveNoteCursor,
  LiveMelodyNoteCursor,
  LiveChordCursor,
  LiveDrumHitCursor,
  type LiveNoteData,
  type LiveMelodyNoteData,
  type LiveChordData,
  type LiveDrumHitData
} from './cursors'

// RFC-045: Neural Playback Cursors
// ISSUE-024: SynapseResolutionResult DELETED - use SynapseResolutionCallback instead
export { SynapticCursor } from './cursors'

// ISSUE-024: Legacy types migrated from symphonyscript-legacy
export type {
  HumanizeSettings,
  QuantizeSettings,
  AutomationTarget,
  VelocityPoint
} from './legacy-types'
