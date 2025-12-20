// =============================================================================
// SymphonyScript - Session Types
// =============================================================================

import type { ClipNode } from '../../../../../symphonyscript-legacy/src/legacy/clip/types'

// Forward reference - Instrument is imported at runtime in Track.ts
// This avoids circular dependency while preserving type safety
import type { Instrument } from '../instrument/Instrument'
import type { SchemaVersion } from '../schema/version'
import type { InsertEffect, SendConfig, EffectBusConfig } from '../effects/types'

/** A track binds a clip to an instrument */
export interface TrackNode {
  readonly _version: SchemaVersion
  kind: 'track'
  instrument: Instrument
  clip: ClipNode
  /** Track name for debugging/display */
  name?: string
  /** Override instrument's MIDI channel. */
  midiChannel?: number
  /** Track-level initial tempo override */
  tempo?: number
  /** Track-level time signature override */
  timeSignature?: import('../types/primitives').TimeSignatureString
  /** Track-level default duration context */
  defaultDuration?: import('../types/primitives').NoteDuration
  /** Insert effects in signal chain (processed in order) */
  inserts?: InsertEffect[]
  /** Send configurations to effect buses */
  sends?: SendConfig[]
}

/** A session is a collection of tracks with optional effect bus routing */
export interface SessionNode {
  readonly _version: SchemaVersion
  kind: 'session'
  tracks: TrackNode[]
  /** Effect bus definitions for parallel processing */
  effectBuses?: EffectBusConfig[]
  /** Session-level initial tempo */
  tempo?: number
  /** Session-level time signature */
  timeSignature?: import('../types/primitives').TimeSignatureString
  /** Session-level default duration context */
  defaultDuration?: import('../types/primitives').NoteDuration
}






