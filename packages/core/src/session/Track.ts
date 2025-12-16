// =============================================================================
// SymphonyScript - Track (Instrument + Clip + Effects)
// =============================================================================

import type { ClipNode } from '../clip/types'
import type { ClipBuilder } from '../clip/ClipBuilder'
import type { Instrument } from '../instrument/Instrument'
import type { EffectType, EffectParamsFor, InsertEffect, SendConfig } from '../effects/types'

import { SCHEMA_VERSION } from '../schema/version'
import type { TrackNode } from './types'

/**
 * Track Builder - creates the final TrackNode.
 * Supports fluent API for tempo, time signature, and effects configuration.
 */
export class Track {
  readonly _version = SCHEMA_VERSION
  readonly kind = 'track'
  public readonly _clip: ClipNode
  public readonly _tempo?: number
  public readonly _timeSignature?: import('../types/primitives').TimeSignatureString
  public readonly _defaultDuration?: import('../types/primitives').NoteDuration
  public readonly _inserts: InsertEffect[]
  public readonly _sends: SendConfig[]
  
  constructor(
    public readonly instrument: Instrument,
    clipSource: ClipBuilder<any> | ClipNode,
    public readonly name?: string,
    tempo?: number,
    timeSignature?: import('../types/primitives').TimeSignatureString,
    defaultDuration?: import('../types/primitives').NoteDuration,
    inserts: InsertEffect[] = [],
    sends: SendConfig[] = []
  ) {
    this._tempo = tempo
    this._timeSignature = timeSignature
    this._defaultDuration = defaultDuration
    this._inserts = inserts
    this._sends = sends

    if ('build' in clipSource && typeof clipSource.build === 'function') {
      this._clip = clipSource.build()
    } else {
      this._clip = clipSource as ClipNode
    }
  }

  /** Build the final TrackNode */
  build(): TrackNode {
    return {
      _version: this._version,
      kind: 'track',
      instrument: this.instrument,
      clip: this._clip,
      name: this.name,
      tempo: this._tempo,
      timeSignature: this._timeSignature,
      defaultDuration: this._defaultDuration,
      inserts: this._inserts.length > 0 ? this._inserts : undefined,
      sends: this._sends.length > 0 ? this._sends : undefined
    }
  }

  // --- Backward Compatibility Accessors ---
  get clip() { return this._clip }

  // --- Fluent Configuration ---

  /** Set track-level tempo */
  tempo(bpm: number): Track {
    return new Track(this.instrument, this._clip, this.name, bpm, this._timeSignature, this._defaultDuration, this._inserts, this._sends)
  }

  /** Set track-level time signature */
  timeSignature(signature: import('../types/primitives').TimeSignatureString): Track {
    return new Track(this.instrument, this._clip, this.name, this._tempo, signature, this._defaultDuration, this._inserts, this._sends)
  }

  /** Set track-level default duration */
  defaultDuration(duration: import('../types/primitives').NoteDuration): Track {
    return new Track(this.instrument, this._clip, this.name, this._tempo, this._timeSignature, duration, this._inserts, this._sends)
  }

  // --- Effects API (RFC-018) ---

  /**
   * Add an insert effect to the track's signal chain.
   * Effects are processed in order (series).
   * @param type - Effect type ('delay', 'reverb', 'distortion', etc.)
   * @param params - Effect-specific parameters
   */
  insert<T extends EffectType>(type: T, params: EffectParamsFor<T>): Track {
    const effect: InsertEffect = { type, params: params as Record<string, unknown> }
    return new Track(
      this.instrument, this._clip, this.name,
      this._tempo, this._timeSignature, this._defaultDuration,
      [...this._inserts, effect], this._sends
    )
  }

  /**
   * Send signal to an effect bus.
   * Amount is 0-1 (percentage of signal sent).
   * @param busId - Bus ID defined via session().bus()
   * @param amount - Send amount (0-1), clamped if out of range
   */
  send(busId: string, amount: number): Track {
    const clampedAmount = Math.max(0, Math.min(1, amount))
    const sendConfig: SendConfig = { bus: busId, amount: clampedAmount }
    return new Track(
      this.instrument, this._clip, this.name,
      this._tempo, this._timeSignature, this._defaultDuration,
      this._inserts, [...this._sends, sendConfig]
    )
  }

  /**
   * Create a track from a ClipBuilder and Instrument.
   * @param clip - The musical clip (from `Clip.melody`, `Clip.drums`, etc.) or built ClipNode
   * @param instrument - The sound source (`Instrument.synth`, `Instrument.sampler`)
   * @param options - Optional track configuration
   */
  static from(
    clip: ClipBuilder<any> | ClipNode,
    instrument: Instrument,
    options?: { 
      name?: string
      tempo?: number
      timeSignature?: import('../types/primitives').TimeSignatureString
      defaultDuration?: import('../types/primitives').NoteDuration
    }
  ): Track {
    const name = options?.name
    const tempo = options?.tempo
    const timeSignature = options?.timeSignature
    const defaultDuration = options?.defaultDuration
    return new Track(instrument, clip, name, tempo, timeSignature, defaultDuration)
  }
}



