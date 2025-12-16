// =============================================================================
// SymphonyScript - Core Module (Backward Compatibility Re-exports)
// =============================================================================

// Re-export from new locations for backward compatibility

// Clip Builders
export {ClipFactory as Clip, ClipFactory} from '../clip'
export {
  ClipBuilder,
  MelodyBuilder,
  KeyboardBuilder,
  StringBuilder,
  WindBuilder,
  DrumBuilder
} from '../clip'

// Actions
export {Actions} from '../clip'

// Track & Session
export {Track} from '../session'
export {Session, session} from '../session'

// Instrument classes - re-export from instrument domain
import {Instrument as InstrumentClass, Sampler, sampler, synth, Synth} from '../instrument'

export {InstrumentClass, Synth, Sampler}

// Instrument factory namespace
export const Instrument = {
  synth,
  sampler
}
