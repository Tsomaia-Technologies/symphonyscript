// =============================================================================
// SymphonyScript - Instrument Domain Exports
// =============================================================================

export {
  Instrument,
  Synth,
  Sampler,
  synth,
  sampler
} from './Instrument'

export * from './types'
export {InstrumentRegistry, globalRegistry} from './registry'

export type {
  InstrumentKind,
  Envelope,
  AudioRouting,
  SidechainConfig,
  SynthConfig,
  SamplerConfig,
  InstrumentConfig
} from './Instrument'

// Import for factory namespace
import {sampler, synth} from './Instrument'

/** Instrument factory namespace */
export const InstrumentFactory = {
  synth,
  sampler
}

