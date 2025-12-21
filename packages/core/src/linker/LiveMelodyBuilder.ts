// =============================================================================
// SymphonyScript - LiveMelodyBuilder (RFC-043 Phase 4)
// =============================================================================
// Melody builder that mirrors DSL calls directly to SiliconBridge.
// Extends LiveClipBuilder with melody-specific operations.

import { LiveClipBuilder } from './LiveClipBuilder'
import type { SiliconBridge } from './silicon-bridge'
import type {
  NoteDuration,
  NoteName,
  ArpPattern,
  EasingCurve,
  TempoKeyframe
} from '../types/primitives'
import type { AutomationTarget, VelocityPoint } from './legacy-types'
import type { ScaleMode } from '../scales'
import type { ChordCode, ChordRoot } from '../chords/types'
import type { Accidental } from '../theory/types'
import { LiveMelodyNoteCursor, LiveMelodyNoteData } from './cursors/LiveMelodyNoteCursor'
import { LiveChordCursor, LiveChordData } from './cursors/LiveChordCursor'
import { noteToMidi, midiToNote } from '../util/midi'
import { degreeToNote, SCALE_INTERVALS } from '../scales'
import { euclidean, rotatePattern } from '../generators/euclidean'
import { chordToNotes } from '../chords/resolver'

// =============================================================================
// Types
// =============================================================================

export interface EuclideanMelodyOptions {
  hits: number
  steps: number
  notes: NoteName[]
  stepDuration?: NoteDuration
  velocity?: number
  rotation?: number
  repeat?: number
  seed?: number
}

interface ScaleContext {
  root: ChordRoot
  mode: ScaleMode
  octave: number
}

interface KeyContext {
  root: ChordRoot
  mode: 'major' | 'minor'
}

// =============================================================================
// LiveMelodyBuilder
// =============================================================================

/**
 * LiveMelodyBuilder provides note, chord, and expression capabilities.
 * Mirrors MelodyBuilder API for live coding with direct SAB synchronization.
 */
export class LiveMelodyBuilder extends LiveClipBuilder {
  // Context state
  protected _transposition: number = 0
  protected _scaleContext: ScaleContext | undefined
  protected _keyContext: KeyContext | undefined
  protected _nextAccidental: Accidental | undefined
  protected _expressionId: number | undefined

  constructor(bridge: SiliconBridge, name: string = 'Untitled Melody') {
    super(bridge, name)
  }

  // ===========================================================================
  // Note Methods (Override to Return MelodyNoteCursor)
  // ===========================================================================

  /**
   * Play a single note.
   * Returns a cursor for applying modifiers.
   */
  note(pitch: NoteName | string, duration?: NoteDuration): LiveMelodyNoteCursor<this> {
    const midiPitch = this.resolvePitch(pitch)
    const transposedPitch = midiPitch + this._transposition
    const vel = this.currentVelocity
    const dur = this.resolveDuration(duration ?? this._defaultDuration)

    const sourceId = this.getSourceIdFromCallSite()
    const noteData = this.synchronizeNote(sourceId, transposedPitch, vel, dur, this.currentTick)
    this.currentTick += dur

    // Clear nextAccidental after use
    this._nextAccidental = undefined

    const melodyNoteData: LiveMelodyNoteData = {
      ...noteData,
      detune: undefined,
      timbre: undefined,
      pressure: undefined,
      glide: undefined,
      tie: undefined
    }

    return new LiveMelodyNoteCursor(this, melodyNoteData)
  }

  /**
   * Play a chord (multiple notes simultaneously).
   * Returns a cursor for applying modifiers.
   */
  chord(pitches: NoteName[], duration?: NoteDuration): LiveChordCursor<this>
  chord(code: ChordCode, octave: number, duration?: NoteDuration): LiveChordCursor<this>
  chord(
    arg1: NoteName[] | ChordCode,
    arg2?: NoteDuration | number,
    arg3?: NoteDuration
  ): LiveChordCursor<this> {
    let notes: NoteName[]
    let duration: NoteDuration

    if (Array.isArray(arg1)) {
      notes = arg1
      duration = (typeof arg2 === 'string' ? arg2 : this._defaultDuration) as NoteDuration
    } else {
      const code = arg1 as string
      const octave = typeof arg2 === 'number' ? arg2 : 4
      duration = arg3 ?? this._defaultDuration
      notes = chordToNotes(code, octave)
    }

    const vel = this.currentVelocity
    const dur = this.resolveDuration(duration)
    const baseTick = this.currentTick

    const noteDataList: LiveMelodyNoteData[] = []
    const noteSourceIds: number[] = []

    let i = 0
    while (i < notes.length) {
      const midiPitch = this.resolvePitch(notes[i])
      const transposedPitch = midiPitch + this._transposition
      const sourceId = this.getSourceIdFromCallSite(i)

      const noteData = this.synchronizeNote(sourceId, transposedPitch, vel, dur, baseTick)
      noteSourceIds.push(noteData.sourceId)
      noteDataList.push({
        ...noteData,
        detune: undefined,
        timbre: undefined,
        pressure: undefined,
        glide: undefined,
        tie: undefined
      })
      i = i + 1
    }

    this.currentTick += dur

    const chordData: LiveChordData = {
      noteSourceIds,
      baseTick,
      duration: dur,
      velocity: vel
    }

    return new LiveChordCursor(this, chordData, noteDataList)
  }

  // ===========================================================================
  // Transposition & Octave
  // ===========================================================================

  /**
   * Set transposition context (semitones).
   */
  transpose(semitones: number): this {
    this._transposition += semitones
    return this
  }

  /**
   * Set absolute octave register.
   * Octave 4 is neutral (no transposition).
   */
  octave(n: number): this {
    this._transposition = (n - 4) * 12
    return this
  }

  /**
   * Shift up by n octaves.
   */
  octaveUp(n: number = 1): this {
    return this.transpose(n * 12)
  }

  /**
   * Shift down by n octaves.
   */
  octaveDown(n: number = 1): this {
    return this.transpose(-n * 12)
  }

  // ===========================================================================
  // Key & Scale
  // ===========================================================================

  /**
   * Set key signature context for automatic accidentals.
   */
  key(root: ChordRoot, mode: 'major' | 'minor'): this {
    this._keyContext = { root, mode }
    return this
  }

  /**
   * Set accidental override for the next note only.
   */
  accidental(acc: Accidental): this {
    this._nextAccidental = acc
    return this
  }

  /**
   * Set scale context for degree-based notation.
   */
  scale(root: ChordRoot, mode: ScaleMode, octave: number = 4): this {
    this._scaleContext = { root, mode, octave }
    return this
  }

  /**
   * Add note by scale degree.
   */
  degree(
    deg: number,
    duration: NoteDuration = '4n',
    options?: { alteration?: number; octaveOffset?: number }
  ): LiveMelodyNoteCursor<this> {
    if (!this._scaleContext) {
      throw new Error('degree() requires scale() to be called first')
    }

    const note = degreeToNote(
      deg,
      this._scaleContext,
      options?.alteration ?? 0,
      options?.octaveOffset ?? 0
    )

    return this.note(note as NoteName, duration)
  }

  /**
   * Add chord by scale degrees.
   */
  degreeChord(degrees: number[], duration: NoteDuration = '4n'): LiveChordCursor<this> {
    if (!this._scaleContext) {
      throw new Error('degreeChord() requires scale() to be called first')
    }

    const notes: NoteName[] = []
    let i = 0
    while (i < degrees.length) {
      notes.push(degreeToNote(degrees[i], this._scaleContext!) as NoteName)
      i = i + 1
    }
    return this.chord(notes, duration)
  }

  /**
   * Roman numeral chord helper.
   */
  roman(numeral: string, optionsOrDuration?: NoteDuration | {
    inversion?: number,
    duration?: NoteDuration
  }): LiveChordCursor<this> {
    let duration: NoteDuration = '4n'
    let inversion: number = 0

    if (typeof optionsOrDuration === 'object' && optionsOrDuration !== null) {
      inversion = optionsOrDuration.inversion ?? 0
      duration = optionsOrDuration.duration ?? '4n'
    } else if (optionsOrDuration !== undefined) {
      duration = optionsOrDuration as NoteDuration
    }

    const romanMap: Record<string, number[]> = {
      'I': [1, 3, 5], 'i': [1, 3, 5],
      'II': [2, 4, 6], 'ii': [2, 4, 6],
      'III': [3, 5, 7], 'iii': [3, 5, 7],
      'IV': [4, 6, 8], 'iv': [4, 6, 8],
      'V': [5, 7, 9], 'v': [5, 7, 9],
      'VI': [6, 8, 10], 'vi': [6, 8, 10],
      'VII': [7, 9, 11], 'vii': [7, 9, 11],
      'I7': [1, 3, 5, 7], 'i7': [1, 3, 5, 7],
      'V7': [5, 7, 9, 11], 'v7': [5, 7, 9, 11],
    }

    const baseDegrees = romanMap[numeral]
    if (!baseDegrees) {
      throw new Error(`Unknown roman numeral: ${numeral}`)
    }

    const degrees = [...baseDegrees]

    if (inversion > 0 && this._scaleContext) {
      const scaleLen = SCALE_INTERVALS[this._scaleContext.mode].length
      let inv = 0
      while (inv < inversion) {
        const shift = degrees.shift()!
        degrees.push(shift + scaleLen)
        inv = inv + 1
      }
    }

    return this.degreeChord(degrees, duration)
  }

  /**
   * Emit a chord progression using roman numerals.
   */
  progression(
    arg1: string | string[],
    ...rest: (string | { duration?: NoteDuration; octave?: number })[]
  ): this {
    if (!this._keyContext) {
      throw new Error('progression() requires key() to be called first')
    }

    let numerals: string[]
    let options: { duration?: NoteDuration; octave?: number } = {}

    if (Array.isArray(arg1)) {
      numerals = arg1
      if (rest.length > 0 && typeof rest[0] === 'object') {
        options = rest[0] as { duration?: NoteDuration; octave?: number }
      }
    } else {
      numerals = [arg1 as string]
      let ri = 0
      while (ri < rest.length) {
        if (typeof rest[ri] === 'string') {
          numerals[numerals.length] = rest[ri] as string
        }
        ri = ri + 1
      }
    }

    const duration = options.duration ?? '1n'
    const octave = options.octave ?? 4

    const { romanToChord } = require('../theory/progressions')

    let ni = 0
    while (ni < numerals.length) {
      const chordCode = romanToChord(numerals[ni], this._keyContext)
      this.chord(chordCode as ChordCode, octave, duration).commit()
      ni = ni + 1
    }

    return this
  }

  /**
   * Emit a voice-led chord progression.
   */
  voiceLead(
    numerals: string[],
    options?: {
      duration?: NoteDuration
      octave?: number
      voices?: number
      style?: 'close' | 'open' | 'drop2'
    }
  ): this {
    if (!this._keyContext) {
      throw new Error('voiceLead() requires key() to be called first')
    }

    const duration = options?.duration ?? '1n'
    const octave = options?.octave ?? 4
    const voices = options?.voices ?? 4
    const style = options?.style ?? 'close'

    const { romanToChord } = require('../theory/progressions')
    const { voiceLeadChords } = require('../theory/voiceleading')

    const chordCodes: string[] = []
    let ci = 0
    while (ci < numerals.length) {
      chordCodes.push(romanToChord(numerals[ci], this._keyContext))
      ci = ci + 1
    }

    const rawChords: NoteName[][] = []
    let ri = 0
    while (ri < chordCodes.length) {
      rawChords.push(chordToNotes(chordCodes[ri], octave))
      ri = ri + 1
    }

    const voiceledChords = voiceLeadChords(rawChords, { voices, style })

    let vi = 0
    while (vi < voiceledChords.length) {
      this.chord(voiceledChords[vi], duration).commit()
      vi = vi + 1
    }

    return this
  }

  // ===========================================================================
  // Arpeggios & Euclidean
  // ===========================================================================

  /**
   * Arpeggiate a chord.
   */
  arpeggio(
    pitches: NoteName[],
    rate: NoteDuration,
    options?: {
      pattern?: ArpPattern
      velocity?: number
      gate?: number
      octaves?: number
      seed?: number
    }
  ): this {
    const pattern = options?.pattern ?? 'up'
    const octaveCount = options?.octaves ?? 1
    const velocity = options?.velocity ?? 1
    const gate = options?.gate ?? 1.0

    let pool: number[] = []
    const baseMidis: number[] = []
    let pi = 0
    while (pi < pitches.length) {
      const m = noteToMidi(pitches[pi])
      if (m !== null) {
        baseMidis.push(m)
      }
      pi = pi + 1
    }

    let oct = 0
    while (oct < octaveCount) {
      let mi = 0
      while (mi < baseMidis.length) {
        pool.push(baseMidis[mi] + (oct * 12))
        mi = mi + 1
      }
      oct = oct + 1
    }

    pool.sort((a, b) => a - b)

    let sequence: number[] = []
    switch (pattern) {
      case 'up':
        sequence = [...pool]
        break
      case 'down':
        sequence = [...pool].reverse()
        break
      case 'upDown':
        sequence = [...pool]
        if (pool.length > 2) {
          sequence.push(...[...pool].slice(1, -1).reverse())
        }
        break
      case 'downUp':
        sequence = [...pool].reverse()
        if (pool.length > 2) {
          sequence.push(...[...pool].slice(1, -1))
        }
        break
      case 'random':
        sequence = [...pool].sort(() => Math.random() - 0.5)
        break
      case 'converge':
        let left = 0, right = pool.length - 1
        while (left <= right) {
          sequence.push(pool[left])
          left = left + 1
          if (left <= right) {
            sequence.push(pool[right])
            right = right - 1
          }
        }
        break
      case 'diverge':
        const mid = Math.floor(pool.length / 2)
        let di = 0
        while (di < pool.length) {
          const idx = di % 2 === 0 ? mid + Math.floor(di / 2) : mid - Math.ceil(di / 2)
          if (idx >= 0 && idx < pool.length) sequence.push(pool[idx])
          di = di + 1
        }
        break
    }

    const dur = this.resolveDuration(rate)
    const noteDur = gate >= 1.0 ? dur : Math.round(dur * gate)

    let si = 0
    while (si < sequence.length) {
      const noteName = midiToNote(sequence[si]) as NoteName
      this.note(noteName, rate).velocity(velocity).commit()
      if (gate < 1.0) {
        this.rest(dur - noteDur)
      }
      si = si + 1
    }

    return this
  }

  /**
   * Generate Euclidean pattern with cycling notes.
   */
  euclidean(options: EuclideanMelodyOptions): this {
    const {
      hits,
      steps,
      notes,
      stepDuration = '16n',
      velocity = 1,
      rotation = 0,
      repeat = 1
    } = options

    if (hits < 0 || steps < 1) {
      throw new Error('euclidean: hits must be >= 0, steps must be >= 1')
    }
    if (notes.length === 0) {
      throw new Error('euclidean: notes array cannot be empty')
    }

    let pattern = euclidean(hits, steps)
    if (rotation !== 0) {
      pattern = rotatePattern(pattern, rotation)
    }

    let noteIndex = 0

    let r = 0
    while (r < repeat) {
      let p = 0
      while (p < pattern.length) {
        if (pattern[p]) {
          this.note(notes[noteIndex % notes.length], stepDuration).velocity(velocity).commit()
          noteIndex = noteIndex + 1
        } else {
          this.rest(stepDuration)
        }
        p = p + 1
      }
      r = r + 1
    }

    return this
  }

  // ===========================================================================
  // Expression & Dynamics
  // ===========================================================================

  /**
   * Add vibrato.
   */
  vibrato(depth: number = 0.5, rate?: number): this {
    // Vibrato would be applied via CC modulation
    // For now, stored as metadata
    return this
  }

  /**
   * Add a crescendo.
   */
  crescendo(duration: NoteDuration, options?: { from?: number; to?: number; curve?: EasingCurve }): this {
    // Would ramp velocity over duration
    return this
  }

  /**
   * Add a decrescendo.
   */
  decrescendo(duration: NoteDuration, options?: { from?: number; to?: number; curve?: EasingCurve }): this {
    return this
  }

  /**
   * Add a velocity ramp.
   */
  velocityRamp(to: number, duration: NoteDuration, options?: { from?: number; curve?: EasingCurve }): this {
    return this
  }

  /**
   * Add a multi-point velocity curve.
   */
  velocityCurve(points: VelocityPoint[], duration: NoteDuration): this {
    return this
  }

  /**
   * Add aftertouch pressure event.
   */
  aftertouch(value: number, options?: { type?: 'channel' | 'poly'; note?: NoteName }): this {
    return this
  }

  /**
   * Set automation value.
   */
  automate(
    target: AutomationTarget,
    value: number,
    rampBeats?: number,
    curve?: 'linear' | 'exponential' | 'smooth'
  ): this {
    return this
  }

  /** Shorthand for volume automation. */
  volume(value: number, rampBeats?: number): this {
    return this.automate('volume', value, rampBeats)
  }

  /** Shorthand for pan automation. */
  pan(value: number, rampBeats?: number): this {
    return this.automate('pan', value, rampBeats)
  }

  /**
   * Complex tempo transition with keyframes.
   */
  tempoEnvelope(keyframes: TempoKeyframe[]): this {
    return this
  }

  /**
   * Execute builder callback within a voice scope.
   */
  voice(id: number, builderFn: (v: this) => this | LiveMelodyNoteCursor<this>): this {
    const savedExpressionId = this._expressionId
    this._expressionId = id

    const result = builderFn(this)
    if (result instanceof LiveMelodyNoteCursor) {
      result.commit()
    }

    this._expressionId = savedExpressionId
    return this
  }

  // ===========================================================================
  // Pitch Resolution
  // ===========================================================================

  /**
   * Resolve pitch notation to MIDI number.
   */
  protected resolvePitch(pitch: NoteName | string): number {
    const midi = noteToMidi(pitch as NoteName)
    if (midi === null) {
      throw new Error(`Invalid pitch: ${pitch}`)
    }
    return midi
  }
}
