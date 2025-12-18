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

// Re-export serialized types with explicit names to avoid conflicts
export type {
  SerializedSynthConfig,
  SerializedSamplerConfig,
  SerializedInstrumentConfig,
  SerializedSidechainConfig
} from './types'

// Import for factory namespace
import {sampler, synth} from './Instrument'

/** Instrument factory namespace */
export const InstrumentFactory = {
  synth,
  sampler
}

