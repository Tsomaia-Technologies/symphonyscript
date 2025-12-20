// =============================================================================
// SymphonyScript - Core Module (Backward Compatibility Re-exports)
// =============================================================================

// Re-export from new locations for backward compatibility

// Clip Builders
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
