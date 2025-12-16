// =============================================================================
// SymphonyScript - Effect Types (RFC-018)
// =============================================================================

import type { NoteDuration } from '../types/primitives'

/**
 * Supported effect types for inserts and sends.
 */
export type EffectType =
  | 'delay'
  | 'reverb'
  | 'distortion'
  | 'filter'
  | 'compressor'
  | 'eq'
  | 'chorus'
  | 'custom'

// --- Base Parameters ---

export interface BaseEffectParams {
  /** Dry/wet mix (0-1). Default 1.0 for sends (100% wet). */
  mix?: number
  /** Bypass the effect. */
  bypass?: boolean
}

// --- Effect-Specific Parameters ---

export interface DelayParams extends BaseEffectParams {
  /** Delay time - tempo-synced ('8n', '4n.') or milliseconds (number). */
  time: NoteDuration | number
  /** Feedback amount (0-1). */
  feedback?: number
  /** Enable stereo ping-pong mode. */
  pingPong?: boolean
}

export interface ReverbParams extends BaseEffectParams {
  /** Decay time in seconds (0.5-10). */
  decay?: number
  /** Room size (0-1). */
  size?: number
  /** Pre-delay in milliseconds before reverb onset. */
  preDelay?: number
  /** High-frequency damping (0-1). */
  damping?: number
}

export interface DistortionParams extends BaseEffectParams {
  /** Distortion amount (0-1). */
  drive?: number
  /** Tone control (0-1, low to high). */
  tone?: number
  /** Distortion type. */
  type?: 'soft' | 'hard' | 'fuzz' | 'tube'
}

export interface FilterParams extends BaseEffectParams {
  /** Filter type. */
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch'
  /** Cutoff frequency in Hz. */
  frequency: number
  /** Resonance / Q factor (0.1-20). */
  resonance?: number
}

export interface CompressorParams extends BaseEffectParams {
  /** Threshold in dB (-60 to 0). */
  threshold?: number
  /** Compression ratio (1:1 to 20:1). */
  ratio?: number
  /** Attack time in milliseconds. */
  attack?: number
  /** Release time in milliseconds. */
  release?: number
  /** Makeup gain in dB. */
  makeupGain?: number
}

export interface EqParams extends BaseEffectParams {
  /** Low band gain in dB. */
  lowGain?: number
  /** Mid band gain in dB. */
  midGain?: number
  /** High band gain in dB. */
  highGain?: number
  /** Low band frequency in Hz. */
  lowFreq?: number
  /** High band frequency in Hz. */
  highFreq?: number
}

export interface ChorusParams extends BaseEffectParams {
  /** Modulation rate in Hz. */
  rate?: number
  /** Modulation depth (0-1). */
  depth?: number
  /** Delay time in milliseconds. */
  delayTime?: number
}

export interface CustomEffectParams extends BaseEffectParams {
  /** Custom effect name for runtime resolution. */
  name: string
  /** Arbitrary parameters. */
  params: Record<string, unknown>
}

// --- Type-Safe Parameter Mapping ---

/**
 * Maps EffectType to its corresponding parameter interface.
 * Provides type safety for effect configuration.
 */
export type EffectParamsFor<T extends EffectType> =
  T extends 'delay' ? DelayParams :
  T extends 'reverb' ? ReverbParams :
  T extends 'distortion' ? DistortionParams :
  T extends 'filter' ? FilterParams :
  T extends 'compressor' ? CompressorParams :
  T extends 'eq' ? EqParams :
  T extends 'chorus' ? ChorusParams :
  T extends 'custom' ? CustomEffectParams :
  BaseEffectParams

// --- Serialization Types (for TrackNode/SessionNode) ---

/**
 * An insert effect in a track's signal chain.
 */
export interface InsertEffect {
  type: EffectType
  params: Record<string, unknown>
}

/**
 * A send configuration connecting a track to an effect bus.
 */
export interface SendConfig {
  /** Bus ID to send to. */
  bus: string
  /** Send amount (0-1). */
  amount: number
}

/**
 * Configuration for a session-level effect bus.
 */
export interface EffectBusConfig {
  /** Unique bus identifier. */
  id: string
  /** Effect type. */
  type: EffectType
  /** Effect parameters. */
  params: Record<string, unknown>
}
