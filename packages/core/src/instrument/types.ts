// =============================================================================
// SymphonyScript - Instrument Types
// =============================================================================

import type {Instrument} from './Instrument'
import type {InstrumentId, NoteName} from '../types/primitives'

/** Oscillator waveform types */
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle'

/** Filter types */
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch'

/** Instrument routing configuration */
export interface RoutingConfig {
  pan?: number              // -1 (left) to 1 (right)
  volume?: number           // 0-1
  sends?: SendConfig[]      // Bus sends
}

/** Send configuration for bus routing */
export interface SendConfig {
  busId: string
  amount: number  // 0-1
}

/** Sidechain compression configuration */
export interface SidechainConfig {
  source: Instrument        // Reference to sidechain source
  amount: number           // 0-1 compression amount
  attack?: number          // Attack time in ms
  release?: number         // Release time in ms
}

/**
 * Sidechain configuration with ID reference.
 * Used in serialized output.
 */
export interface SerializedSidechainConfig {
  sourceId: InstrumentId
  amount: number
  attack?: number
  release?: number
}

/** Synth-specific configuration (serialized format) */
export interface SerializedSynthConfig {
  type: 'synth'
  oscillator?: OscillatorType
  attack?: number
  decay?: number
  sustain?: number
  release?: number
  filter?: {
    type: FilterType
    frequency: number
    resonance?: number
  }
  pitchBendRange?: number
}

/** Sampler-specific configuration (serialized format) */
export interface SerializedSamplerConfig {
  type: 'sampler'
  samples?: Record<NoteName, string>  // Note to sample URL mapping
  drumMap?: Record<string, NoteName>  // Drum name to note mapping
  pitchBendRange?: number
}

/** Combined instrument configuration (serialized format) */
export type SerializedInstrumentConfigType = (SerializedSynthConfig | SerializedSamplerConfig) & {
  routing?: RoutingConfig
  sidechain?: SidechainConfig
}

/** Legacy instrument node (for compiler) */
export interface InstrumentNode {
  id: InstrumentId
  name: string
  config: SerializedInstrumentConfigType
}

/**
 * Serializable instrument configuration.
 */
export interface SerializedInstrumentConfig {
  type: 'synth' | 'sampler'
  name: string
  config: SerializedSynthConfig | SerializedSamplerConfig
  routing?: RoutingConfig
  sidechain?: SerializedSidechainConfig  // ID-based, not object
}

