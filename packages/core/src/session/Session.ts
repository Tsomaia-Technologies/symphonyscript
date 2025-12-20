// =============================================================================
// SymphonyScript - Session (Track Collection with Effect Bus Routing)
// =============================================================================

import type { SessionNode, TrackNode } from './types'
import type { EffectType, EffectParamsFor, EffectBusConfig } from '../effects/types'
import { Track } from './Track'
import type { ClipBuilder } from '../../../../../symphonyscript-legacy/src/legacy/clip/ClipBuilder'
import type { ClipNode } from '../../../../../symphonyscript-legacy/src/legacy/clip/types'
import type { Instrument } from '../instrument/Instrument'
import { SCHEMA_VERSION } from '../schema/version'

/**
 * Session Builder - creates the final SessionNode.
 * Provides fluent API for configuration including effect buses.
 */
export class Session {
  readonly _version = SCHEMA_VERSION
  readonly kind = 'session'

  constructor(
    public readonly _tracks: TrackNode[],
    public readonly _effectBuses: EffectBusConfig[] = [],
    public readonly _tempo?: number,
    public readonly _timeSignature?: import('../types/primitives').TimeSignatureString,
    public readonly _defaultDuration?: import('../types/primitives').NoteDuration
  ) {
  }

  static create(): Session {
    return new Session([], [])
  }

  /** Build the final SessionNode */
  build(): SessionNode {
    return {
      _version: this._version,
      kind: 'session',
      tracks: this._tracks,
      effectBuses: this._effectBuses.length > 0 ? this._effectBuses : undefined,
      tempo: this._tempo,
      timeSignature: this._timeSignature,
      defaultDuration: this._defaultDuration
    }
  }

  // --- Backward Compatibility Accessors ---
  get tracks() { return this._tracks }
  get effectBuses() { return this._effectBuses }

  // --- Fluent Configuration ---

  /** Set session-level tempo */
  tempo(bpm: number): Session {
    return new Session(this._tracks, this._effectBuses, bpm, this._timeSignature, this._defaultDuration)
  }

  /** Set session-level time signature */
  timeSignature(signature: import('../types/primitives').TimeSignatureString): Session {
    return new Session(this._tracks, this._effectBuses, this._tempo, signature, this._defaultDuration)
  }

  /** Set session-level default duration */
  defaultDuration(duration: import('../types/primitives').NoteDuration): Session {
    return new Session(this._tracks, this._effectBuses, this._tempo, this._timeSignature, duration)
  }

  // --- Track Management ---

  /** Add a track to the session */
  add(track: Track | TrackNode): Session {
    const trackNode = (track instanceof Track) ? track.build() : track
    return new Session([...this._tracks, trackNode], this._effectBuses, this._tempo, this._timeSignature, this._defaultDuration)
  }

  /**
   * Add a named track to the session.
   * @param name - Track name
   * @param clip - Clip builder or built node
   * @param instrument - Instrument instance
   */
  track(name: string, clip: ClipBuilder<any> | ClipNode, instrument: Instrument): Session {
    return this.add(Track.from(clip, instrument, { name }))
  }

  // --- Effect Bus API (RFC-018) ---

  /**
   * Define an effect bus for parallel processing.
   * All tracks can send to this bus via Track.send().
   *
   * @param id - Unique bus identifier (used in Track.send())
   * @param type - Effect type ('reverb', 'delay', 'compressor', etc.)
   * @param params - Effect-specific parameters
   * @throws Error if bus ID is already defined
   */
  bus<T extends EffectType>(id: string, type: T, params: EffectParamsFor<T>): Session {
    // Check for duplicate bus ID
    if (this._effectBuses.some(b => b.id === id)) {
      throw new Error(`Duplicate bus ID: '${id}'. Each bus must have a unique identifier.`)
    }
    
    const busConfig: EffectBusConfig = { 
      id, 
      type, 
      params: params as Record<string, unknown> 
    }
    return new Session(
      this._tracks, 
      [...this._effectBuses, busConfig], 
      this._tempo, 
      this._timeSignature, 
      this._defaultDuration
    )
  }
}

// --- Factory ---

export function session(options?: { 
  tempo?: number
  timeSignature?: import('../types/primitives').TimeSignatureString
  defaultDuration?: import('../types/primitives').NoteDuration
}): Session {
  if (options?.tempo || options?.timeSignature || options?.defaultDuration) {
    return new Session([], [], options?.tempo, options?.timeSignature, options?.defaultDuration)
  }
  return Session.create()
}







