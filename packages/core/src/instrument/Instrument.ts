// =============================================================================
// SymphonyScript - Instruments (Immutable)
// =============================================================================

import { InstrumentId, instrumentId, NoteName } from '../types/primitives'

// --- Config Types ---

export type InstrumentKind = 'synth' | 'sampler'

export interface Envelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

export interface AudioRouting {
  pan: number         // -1 (left) to 1 (right)
  volume: number      // 0 to 1
  outputBus?: string  // 'master' | custom
  sends?: Array<{ bus: string; amount: number }>
}

/** Sidechain configuration for ducking effects */
export interface SidechainConfig {
  source: Instrument    // Direct reference to instrument instance
  amount: number        // Ducking depth (0-1)
  attack?: number
  release?: number
}

export interface SynthConfig {
  kind: 'synth'
  oscillator: 'sine' | 'square' | 'sawtooth' | 'triangle'
  envelope: Envelope
  polyphony: number
  routing?: AudioRouting
  pitchBendRange?: number  // Semitones (default: 2)
  sidechain?: SidechainConfig
  midiChannel?: number
}

/**
 * Region in multi-sample instrument.
 */
export interface SampleRegion {
  sample: string
  rootPitch: import('../types/primitives').NoteName | number
  pitchRange?: {
    low: import('../types/primitives').NoteName | number;
    high: import('../types/primitives').NoteName | number
  }
  velocityRange?: { low: number; high: number }
  settings?: {
    transpose?: number
    detune?: number   // cents
    volume?: number   // dB
    loop?: { start: number; end: number }
  }
}

export interface SamplerConfig {
  kind: 'sampler'
  sampleMap: Record<string, string>  // Note -> URL
  baseUrl?: string
  playbackMode?: 'oneshot' | 'loop' | 'sustain'
  routing?: AudioRouting
  pitchBendRange?: number  // Semitones (default: 2)
  drumMap?: Record<string, NoteName>  // Drum name -> Note mapping
  sidechain?: SidechainConfig
  midiChannel?: number
  regions?: SampleRegion[]
}

export type InstrumentConfig = SynthConfig | SamplerConfig

// --- Base Instrument ---

/**
 * Immutable instrument configuration.
 *
 * NO identity in builder layer. Name is optional (debugging only).
 */
export abstract class Instrument {
  readonly id: InstrumentId

  constructor(public readonly name?: string) {
    this.id = name ? instrumentId(name) : instrumentId('anonymous_' + Math.random().toString(36).slice(2))
  }

  abstract get config(): InstrumentConfig

  abstract get kind(): InstrumentKind

  abstract get routing(): AudioRouting | undefined

  abstract get sidechainConfig(): SidechainConfig | undefined

  /**
   * Create a synthesizer instrument.
   * @param name - Display name (e.g. "Main Synth")
   */
  static synth(name?: string): Synth {
    return Synth.create(name)
  }

  /**
   * Create a sampler instrument.
   * @param name - Display name
   */
  static sampler(name?: string): Sampler {
    return Sampler.create(name)
  }
}

// --- Synth (Immutable) ---

export class Synth extends Instrument {
  private constructor(
    name: string | undefined,
    private readonly _osc: SynthConfig['oscillator'],
    private readonly _env: Envelope,
    private readonly _poly: number,
    private readonly _routing?: AudioRouting,
    private readonly _pitchBendRange?: number,
    private readonly _sidechain?: SidechainConfig,
    private readonly _midiChannel?: number
  ) {
    super(name)
  }

  get kind(): 'synth' {
    return 'synth'
  }

  get routing(): AudioRouting | undefined {
    return this._routing
  }

  get sidechainConfig(): SidechainConfig | undefined {
    return this._sidechain
  }

  get config(): SynthConfig {
    return {
      kind: 'synth',
      oscillator: this._osc,
      envelope: { ...this._env },
      polyphony: this._poly,
      routing: this._routing ? { ...this._routing } : undefined,
      pitchBendRange: this._pitchBendRange,
      sidechain: this._sidechain ? { ...this._sidechain } : undefined,
      midiChannel: this._midiChannel
    }
  }

  static create(name?: string): Synth {
    return new Synth(
      name,
      'sine',
      { attack: 0.01, decay: 0.1, sustain: 0.5, release: 1 },
      8,
      undefined,
      undefined,
      undefined,
      undefined
    )
  }

  /** Set oscillator type */
  osc(type: SynthConfig['oscillator']): Synth {
    return new Synth(this.name, type, this._env, this._poly, this._routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Set envelope parameters */
  envelope(env: Partial<Envelope>): Synth {
    return new Synth(
      this.name,
      this._osc,
      { ...this._env, ...env },
      this._poly,
      this._routing,
      this._pitchBendRange,
      this._sidechain,
      this._midiChannel
    )
  }

  /** Set attack time */
  attack(val: number): Synth {
    return this.envelope({ attack: val })
  }

  /** Set decay time */
  decay(val: number): Synth {
    return this.envelope({ decay: val })
  }

  /** Set sustain level */
  sustainLevel(val: number): Synth {
    return this.envelope({ sustain: val })
  }

  /** Set release time */
  release(val: number): Synth {
    return this.envelope({ release: val })
  }

  /** Set polyphony (max simultaneous voices) */
  polyphony(count: number): Synth {
    return new Synth(this.name, this._osc, this._env, count, this._routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Set stereo pan position (-1 left, 0 center, 1 right) */
  pan(value: number): Synth {
    const routing: AudioRouting = {
      pan: Math.max(-1, Math.min(1, value)),
      volume: this._routing?.volume ?? 1,
      outputBus: this._routing?.outputBus,
      sends: this._routing?.sends
    }
    return new Synth(this.name, this._osc, this._env, this._poly, routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Set volume (0 to 1) */
  volume(value: number): Synth {
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: Math.max(0, Math.min(1, value)),
      outputBus: this._routing?.outputBus,
      sends: this._routing?.sends
    }
    return new Synth(this.name, this._osc, this._env, this._poly, routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Set output bus */
  output(bus: string): Synth {
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: this._routing?.volume ?? 1,
      outputBus: bus,
      sends: this._routing?.sends
    }
    return new Synth(this.name, this._osc, this._env, this._poly, routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Add a send to a bus */
  send(busId: string, amount: number): Synth {
    const currentSends = this._routing?.sends ?? []
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: this._routing?.volume ?? 1,
      outputBus: this._routing?.outputBus,
      sends: [...currentSends, { bus: busId, amount: Math.max(0, Math.min(1, amount)) }]
    }
    return new Synth(this.name, this._osc, this._env, this._poly, routing, this._pitchBendRange, this._sidechain, this._midiChannel)
  }

  /** Set pitch bend range in semitones (default: 2) */
  pitchBendRange(semitones: number): Synth {
    return new Synth(this.name, this._osc, this._env, this._poly, this._routing, semitones, this._sidechain, this._midiChannel)
  }

  /** Configure sidechain ducking from another instrument */
  sidechain(source: Instrument, amount: number, options?: { attack?: number; release?: number }): Synth {
    return new Synth(this.name, this._osc, this._env, this._poly, this._routing, this._pitchBendRange, {
      source,
      amount: Math.max(0, Math.min(1, amount)),
      ...options
    }, this._midiChannel)
  }

  /** Set MIDI channel */
  midiChannel(channel: number): Synth {
    return new Synth(this.name, this._osc, this._env, this._poly, this._routing, this._pitchBendRange, this._sidechain, channel)
  }
}

// --- Sampler (Immutable) ---

export class Sampler extends Instrument {
  private constructor(
    name: string | undefined,
    private readonly _map: Record<string, string>,
    private readonly _baseUrl?: string,
    private readonly _playbackMode?: SamplerConfig['playbackMode'],
    private readonly _routing?: AudioRouting,
    private readonly _pitchBendRange?: number,
    private readonly _drumMap?: Record<string, NoteName>,
    private readonly _sidechain?: SidechainConfig,
    private readonly _midiChannel?: number,
    private readonly _regions?: SampleRegion[]
  ) {
    super(name)
  }

  get kind(): 'sampler' {
    return 'sampler'
  }

  get routing(): AudioRouting | undefined {
    return this._routing
  }

  get sidechainConfig(): SidechainConfig | undefined {
    return this._sidechain
  }

  get config(): SamplerConfig {
    return {
      kind: 'sampler',
      sampleMap: { ...this._map },
      baseUrl: this._baseUrl,
      playbackMode: this._playbackMode,
      routing: this._routing ? { ...this._routing } : undefined,
      pitchBendRange: this._pitchBendRange,
      drumMap: this._drumMap ? { ...this._drumMap } : undefined,
      sidechain: this._sidechain ? { ...this._sidechain } : undefined,
      midiChannel: this._midiChannel,
      regions: this._regions ? [...this._regions] : undefined
    }
  }

  static create(name?: string): Sampler {
    return new Sampler(name, {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined)
  }

  /** Set base URL for samples */
  base(url: string): Sampler {
    return new Sampler(this.name, this._map, url, this._playbackMode, this._routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Add a sample mapping (note -> URL) */
  add(note: string, url: string): Sampler {
    return new Sampler(
      this.name,
      { ...this._map, [note]: url },
      this._baseUrl,
      this._playbackMode,
      this._routing,
      this._pitchBendRange,
      this._drumMap,
      this._sidechain,
      this._midiChannel,
      this._regions
    )
  }

  /** Set playback mode */
  playbackMode(mode: SamplerConfig['playbackMode']): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, mode, this._routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Set stereo pan position */
  pan(value: number): Sampler {
    const routing: AudioRouting = {
      pan: Math.max(-1, Math.min(1, value)),
      volume: this._routing?.volume ?? 1,
      outputBus: this._routing?.outputBus,
      sends: this._routing?.sends
    }
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Set volume */
  volume(value: number): Sampler {
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: Math.max(0, Math.min(1, value)),
      outputBus: this._routing?.outputBus,
      sends: this._routing?.sends
    }
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Set output bus */
  output(bus: string): Sampler {
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: this._routing?.volume ?? 1,
      outputBus: bus,
      sends: this._routing?.sends
    }
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Add a send to a bus */
  send(busId: string, amount: number): Sampler {
    const currentSends = this._routing?.sends ?? []
    const routing: AudioRouting = {
      pan: this._routing?.pan ?? 0,
      volume: this._routing?.volume ?? 1,
      outputBus: this._routing?.outputBus,
      sends: [...currentSends, { bus: busId, amount: Math.max(0, Math.min(1, amount)) }]
    }
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Set pitch bend range in semitones (default: 2) */
  pitchBendRange(semitones: number): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, this._routing, semitones, this._drumMap, this._sidechain, this._midiChannel, this._regions)
  }

  /** Set custom drum mapping (drum name -> note) */
  drumMap(mapping: Record<string, NoteName>): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, this._routing, this._pitchBendRange, { ...mapping }, this._sidechain, this._midiChannel, this._regions)
  }

  /** Configure sidechain ducking from another instrument */
  sidechain(source: Instrument, amount: number, options?: { attack?: number; release?: number }): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, this._routing, this._pitchBendRange, this._drumMap, {
      source,
      amount: Math.max(0, Math.min(1, amount)),
      ...options
    }, this._midiChannel, this._regions)
  }

  /** Set MIDI channel */
  midiChannel(channel: number): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, this._routing, this._pitchBendRange, this._drumMap, this._sidechain, channel, this._regions)
  }

  /** Set regions */
  regions(regions: SampleRegion[]): Sampler {
    return new Sampler(this.name, this._map, this._baseUrl, this._playbackMode, this._routing, this._pitchBendRange, this._drumMap, this._sidechain, this._midiChannel, regions)
  }
}

// --- Factories ---

export function synth(name?: string): Synth {
  return Synth.create(name)
}

export function sampler(name?: string): Sampler {
  return Sampler.create(name)
}






