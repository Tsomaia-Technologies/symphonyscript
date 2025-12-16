// =============================================================================
// SymphonyScript - MelodyBuilder (Notes, Chords, Transposition)
// =============================================================================

import { ClipBuilder } from './ClipBuilder'
import * as Actions from './actions'
import {
  ArpPattern,
  isNoteName,
  NoteDuration,
  NoteName,
  unsafeNoteName,
  EasingCurve
} from '../types/primitives'
import type { AutomationOp } from '../automation/types'
import type { ScaleMode } from '../scales'
import { degreeToNote, SCALE_INTERVALS } from '../scales'
import { euclidean, rotatePattern } from '../generators/euclidean'
import type {
  AftertouchOp,
  ClipOperation,
  DynamicsOp,
  MelodyParams,
  VelocityPoint
} from './types'
import { ParamUpdater } from './builder-types'
import { createRandom, SeededRandom } from '../util/random'
import { midiToNote, noteToMidi } from '../util/midi'
import { parseDuration as parseDur } from '../util/duration'
import type { AutomationTarget } from '../automation/types'
import { validate } from '../validation/runtime'
import { MelodyNoteCursor } from './cursors/MelodyNoteCursor'
import { MelodyChordCursor } from './cursors/MelodyChordCursor'
import { chordToNotes } from '../chords/resolver'
import type { ChordCode, ChordOptions, ChordRoot } from '../chords/types'
import { applyKeySignature } from '../theory/keys'
import type { Accidental } from '../theory/types'

export interface EuclideanMelodyOptions {
  hits: number
  steps: number
  /** Notes to cycle through on hits */
  notes: NoteName[]
  stepDuration?: NoteDuration
  velocity?: number
  rotation?: number
  repeat?: number
  seed?: number
}

/**
 * MelodyBuilder provides note, chord, and expression capabilities.
 * Extends ClipBuilder with melodic-specific operations.
 */
export class MelodyBuilder<P extends MelodyParams = MelodyParams>
  extends ClipBuilder<P> {

  constructor(params: P) {
    super(params)
  }

  // Accessor for backward compatibility / internal usage
  protected get _transposition(): number {
    return this._params.transposition ?? 0
  }

  /** Set transposition context (semitones) for subsequent notes */
  transpose(semitones: number): this {
    validate.inRange('transpose', 'semitones', semitones, -127, 127)
    return this._withParams({ transposition: this._transposition + semitones } as unknown as ParamUpdater<P>)
  }

  /**
   * Set absolute octave register.
   * Octave 4 is neutral (no transposition).
   * @param n Target octave (0-9)
   */
  octave(n: number): this {
    validate.inRange('octave', 'octave', n, 0, 9)
    const semitones = (n - 4) * 12
    return this._withParams({
      transposition: semitones
    } as unknown as ParamUpdater<P>)
  }

  /**
   * Shift up by n octaves.
   */
  octaveUp(n: number = 1): this {
    validate.inRange('octaveUp', 'octaves', n, 0, 10)
    return this.transpose(n * 12)
  }

  /**
   * Shift down by n octaves.
   */
  octaveDown(n: number = 1): this {
    validate.inRange('octaveDown', 'octaves', n, 0, 10)
    return this.transpose(-n * 12)
  }

  /**
   * Set key signature context for automatic accidentals.
   * 
   * When a key is set, notes written without accidentals will
   * automatically receive the key signature's accidentals.
   * 
   * @example
   * .key('G', 'major')
   * .note('F4')  // Becomes F#4 (G major has F#)
   * 
   * @param root - Key root (e.g., 'G', 'Bb')
   * @param mode - 'major' or 'minor'
   */
  key(root: ChordRoot, mode: 'major' | 'minor'): this {
    return this._withParams({
      keyContext: { root, mode }
    } as unknown as ParamUpdater<P>)
  }

  /**
   * Set accidental override for the next note only.
   * 
   * This is a single-use modifier that affects only the immediately
   * following note() call, then auto-clears.
   * 
   * @example
   * .key('G', 'major')
   * .accidental('natural')
   * .note('F4')  // F natural (overrides G major's F#)
   * .note('F4')  // F# again (accidental was consumed)
   * 
   * @param acc - 'sharp', 'flat', or 'natural'
   */
  accidental(acc: Accidental): this {
    return this._withParams({
      nextAccidental: acc
    } as unknown as ParamUpdater<P>)
  }

  /**
   * Play a single note.
   * Returns a cursor for applying modifiers.
   * 
   * If a key signature is set via key(), accidentals are applied automatically.
   * Use accidental('natural') before note() to override.
   */
  note(
    pitch: NoteName | string,
    duration?: NoteDuration
  ): MelodyNoteCursor {
    // Runtime validation for string inputs
    const validatedPitch = typeof pitch === 'string' && !isNoteName(pitch)
      ? (() => {
        validate.pitch('note', pitch)
        return unsafeNoteName(pitch)
      })()
      : pitch as NoteName

    // Apply key signature if set (with optional accidental override)
    const finalPitch = applyKeySignature(
      validatedPitch,
      this._params.keyContext,
      this._params.nextAccidental
    ) as NoteName

    const resolvedDuration = duration ?? this._params.defaultDuration ?? '4n'
    const op = Actions.note(finalPitch, resolvedDuration, 1)

    // Inherit humanize settings from clip context
    if (this._params.humanize) {
      op.humanize = this._params.humanize
    }

    // Inherit quantize settings from clip context
    if (this._params.quantize) {
      op.quantize = this._params.quantize
    }

    // Inherit expressionId from voice scope
    if (this._params.expressionId !== undefined) {
      op.expressionId = this._params.expressionId
    }

    // Clear nextAccidental after use (single-use pattern)
    // Note: The cursor will use the builder with cleared accidental
    const clearedBuilder = this._params.nextAccidental !== undefined
      ? this._withParams({ nextAccidental: undefined } as unknown as ParamUpdater<P>)
      : this

    return new MelodyNoteCursor(clearedBuilder, op)
  }

  /**
   * Play a chord (multiple notes simultaneously).
   * Returns a cursor for applying modifiers to the entire chord.
   */
  /**
   * Play a chord (multiple notes simultaneously).
   * Returns a cursor for applying modifiers to the entire chord.
   */
  chord(pitches: NoteName[], duration?: NoteDuration): MelodyChordCursor
  chord(code: ChordCode, octave: number, duration?: NoteDuration): MelodyChordCursor
  chord(
    arg1: NoteName[] | ChordCode,
    arg2?: NoteDuration | number,
    arg3?: NoteDuration
  ): MelodyChordCursor {
    if (Array.isArray(arg1)) {
      // Direct note array
      const pitches = arg1
      const defaultDur = this._params.defaultDuration ?? '4n'
      const duration = (typeof arg2 === 'string' ? arg2 : defaultDur) as NoteDuration
      
      pitches.forEach(p => validate.pitch('chord', p))
      const op = Actions.chord(pitches, duration, 1)

      // Inherit humanize
      if (this._params.humanize) {
        op.operations.forEach(o => {
          if (o.kind === 'note') (o as any).humanize = this._params.humanize
        })
      }

      // Inherit quantize
      if (this._params.quantize) {
        op.operations.forEach(o => {
          if (o.kind === 'note') (o as any).quantize = this._params.quantize
        })
      }

      return new MelodyChordCursor(this, op)
    } else {
      // Chord code
      const code = arg1 as string
      const octave = typeof arg2 === 'number' ? arg2 : 4
      const duration = arg3 ?? this._params.defaultDuration ?? '4n'
      
      const notes = chordToNotes(code, octave)
      
      // Reuse logic
      notes.forEach(p => validate.pitch('chord', p))
      const op = Actions.chord(notes, duration, 1)

      // Inherit humanize
      if (this._params.humanize) {
        op.operations.forEach(o => {
          if (o.kind === 'note') (o as any).humanize = this._params.humanize
        })
      }

      // Inherit quantize
      if (this._params.quantize) {
        op.operations.forEach(o => {
          if (o.kind === 'note') (o as any).quantize = this._params.quantize
        })
      }

      return new MelodyChordCursor(this, op)
    }
  }

  /**
   * Arpeggiate a chord (play notes sequentially).
   */
  arpeggio(
    pitches: NoteName[],
    rate: NoteDuration,
    options?: {
      pattern?: ArpPattern;
      velocity?: number;
      gate?: number;
      octaves?: number;
      seed?: number
    }
  ): this {
    pitches.forEach(p => validate.pitch('arpeggio', p))
    if (options?.velocity !== undefined) validate.velocity('arpeggio', options.velocity)

    // Defaults
    const pattern = options?.pattern ?? 'up'
    const octaveCount = options?.octaves ?? 1
    const velocity = options?.velocity ?? 1
    const gate = options?.gate ?? 1.0

    // 1. Expand octaves if requested
    let pool: number[] = []
    const baseMidis = pitches.map((p: string) => noteToMidi(p)).filter((m: number | null): m is number => m !== null)

    for (let oct = 0; oct < octaveCount; oct++) {
      baseMidis.forEach((m: number) => pool.push(m + (oct * 12)))
    }

    // 2. Sort/Arrange based on pattern
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
          const back = [...pool].slice(1, -1).reverse()
          sequence.push(...back)
        } else if (pool.length === 2) {
          sequence.push(pool[0])
        }
        break
      case 'downUp':
        sequence = [...pool].reverse()
        if (pool.length > 2) {
          const back = [...pool].slice(1, -1)
          sequence.push(...back)
        } else if (pool.length === 2) {
          sequence.push(pool[1])
        }
        break
      case 'random':
        // Use seeded random if provided
        const rng = options?.seed !== undefined
          ? new SeededRandom(options.seed)
          : createRandom()  // Fallback to time-based (backward compatible)

        sequence = [...pool]
        rng.shuffle(sequence)
        break
      case 'converge':
        let left = 0
        let right = pool.length - 1
        while (left <= right) {
          if (left === right) {
            sequence.push(pool[left])
            break
          }
          sequence.push(pool[left])
          sequence.push(pool[right])
          left++
          right--
        }
        break
      case 'diverge':
        const mid = Math.floor((pool.length - 1) / 2)
        let l = mid
        let r = mid + 1
        if (pool.length % 2 !== 0) {
          sequence.push(pool[l])
          l--
        }
        while (l >= 0 || r < pool.length) {
          if (r < pool.length) sequence.push(pool[r++])
          if (l >= 0) sequence.push(pool[l--])
        }
        break
    }

    // 3. Emit Notes
    let builder: this = this
    const stepBeats = parseDur(rate)

    sequence.forEach((midi: number) => {
      const noteName = midiToNote(midi) as NoteName

      if (gate >= 1.0) {
        // Must commit the cursor since note() returns a cursor
        builder = builder.note(noteName, rate).velocity(velocity).commit() as this
      } else {
        const noteBeats = stepBeats * gate
        const restBeats = stepBeats - noteBeats

        builder = builder.note(noteName, noteBeats).velocity(velocity).commit() as this

        if (restBeats > 0.0001) {
          builder = builder.rest(restBeats)
        }
      }
    })

    return builder
  }

  /**
   * Set scale context for degree-based notation.
   */
  scale(root: ChordRoot, mode: ScaleMode, octave: number = 4): this {
    return this._withParams({
      scaleContext: { root, mode, octave }
    } as unknown as ParamUpdater<P>)
  }

  /**
   * Add note by scale degree.
   * Requires scale() to be called first.
   */
  degree(
    deg: number,
    duration: NoteDuration = '4n',
    options?: { alteration?: number; octaveOffset?: number }
  ): MelodyNoteCursor {
    const ctx = this._params.scaleContext
    if (!ctx) {
      throw new Error('degree() requires scale() to be called first')
    }

    const note = degreeToNote(
      deg,
      ctx,
      options?.alteration ?? 0,
      options?.octaveOffset ?? 0
    )

    return this.note(note as NoteName, duration)
  }

  /**
   * Add chord by scale degrees.
   */
  degreeChord(
    degrees: number[],
    duration: NoteDuration = '4n'
  ): MelodyChordCursor {
    const ctx = this._params.scaleContext
    if (!ctx) {
      throw new Error('degreeChord() requires scale() to be called first')
    }

    const notes = degrees.map(deg => degreeToNote(deg, ctx) as NoteName)
    return this.chord(notes, duration)
  }

  /**
   * Roman numeral chord helper.
   */
  roman(numeral: string, optionsOrDuration?: NoteDuration | {
    inversion?: number,
    duration?: NoteDuration
  }): MelodyChordCursor {
    let duration: NoteDuration = '4n'
    let inversion: number = 0

    // Handle Overloads
    if (typeof optionsOrDuration === 'object' && optionsOrDuration !== null) {
      const opts = optionsOrDuration as { inversion?: number, duration?: NoteDuration }
      inversion = opts.inversion ?? 0
      duration = opts.duration ?? '4n'
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

    if (inversion > 0) {
      const ctx = this._params.scaleContext
      if (!ctx) throw new Error('roman() requires scale()')
      const scaleLen = SCALE_INTERVALS[ctx.mode].length
      for (let i = 0; i < inversion; i++) {
        const shift = degrees.shift()!
        degrees.push(shift + scaleLen)
      }
    }

    return this.degreeChord(degrees, duration)
  }

  /**
   * Emit a chord progression using roman numerals.
   * 
   * Requires a key context to be set via key().
   * Each chord is emitted sequentially with the specified duration.
   * 
   * @example
   * .key('C', 'major')
   * .progression('I', 'IV', 'V', 'I')  // C, F, G, C chords
   * 
   * @example
   * .key('G', 'major')
   * .progression(['ii', 'V7', 'I'], { duration: '2n' })
   * 
   * @param numerals - Roman numerals as spread args or array
   * @param options - Duration and octave options
   */
  progression(
    arg1: string | string[],
    ...rest: (string | { duration?: NoteDuration; octave?: number })[]
  ): this {
    const keyContext = this._params.keyContext
    if (!keyContext) {
      throw new Error('progression() requires key() to be called first')
    }

    let numerals: string[]
    let options: { duration?: NoteDuration; octave?: number } = {}

    if (Array.isArray(arg1)) {
      // progression(['I', 'IV', 'V'], options?)
      numerals = arg1
      if (rest.length > 0 && typeof rest[0] === 'object') {
        options = rest[0] as { duration?: NoteDuration; octave?: number }
      }
    } else {
      // progression('I', 'IV', 'V')
      numerals = [arg1, ...rest.filter(r => typeof r === 'string')] as string[]
    }

    const duration = options.duration ?? '1n'  // Default to 1 bar per chord
    const octave = options.octave ?? 4

    // Import progressions module
    const { romanToChord } = require('../theory/progressions')

    let current: this = this
    for (const numeral of numerals) {
      const chordCode = romanToChord(numeral, keyContext)
      current = current.chord(chordCode as ChordCode, octave, duration).commit() as this
    }

    return current
  }

  /**
   * Emit a voice-led chord progression.
   * 
   * Similar to progression(), but applies voice leading to minimize
   * voice movement between chords for smoother transitions.
   * 
   * Requires a key context to be set via key().
   * 
   * @example
   * .key('C', 'major')
   * .voiceLead(['ii', 'V7', 'I'])  // Smooth ii-V-I progression
   * 
   * @param numerals - Roman numerals
   * @param options - Voice leading and progression options
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
    const keyContext = this._params.keyContext
    if (!keyContext) {
      throw new Error('voiceLead() requires key() to be called first')
    }

    const duration = options?.duration ?? '1n'
    const octave = options?.octave ?? 4
    const voices = options?.voices ?? 4
    const style = options?.style ?? 'close'

    // Import modules
    const { romanToChord } = require('../theory/progressions')
    const { voiceLeadChords } = require('../theory/voiceleading')
    const { chordToNotes } = require('../chords/resolver')

    // Convert numerals to chord codes, then to note arrays
    const chordCodes = numerals.map(num => romanToChord(num, keyContext))
    const rawChords = chordCodes.map((code: string) => chordToNotes(code, octave))

    // Apply voice leading
    const voiceledChords = voiceLeadChords(rawChords, { voices, style })

    // Emit chords
    let current: this = this
    for (const chord of voiceledChords) {
      current = current.chord(chord, duration).commit() as this
    }

    return current
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

    let builder: this = this
    let noteIndex = 0

    for (let r = 0; r < repeat; r++) {
      for (const isHit of pattern) {
        if (isHit) {
          // Use cursor and commit
          builder = builder.note(notes[noteIndex % notes.length], stepDuration).velocity(velocity).commit() as this
          noteIndex++
        } else {
          builder = builder.rest(stepDuration)
        }
      }
    }

    return builder
  }

  /**
   * Add vibrato (modulation).
   * Note: This is an escape operation (commits pending note if any, then adds vibrato op).
   */
  vibrato(depth: number = 0.5, rate?: number): this {
    validate.inRange('vibrato', 'depth', depth, 0, 1)
    return this.play(Actions.vibrato(depth, rate))
  }

  /**
   * Add a crescendo (gradual increase in volume).
   */
  crescendo(duration: NoteDuration, options?: { from?: number; to?: number; curve?: EasingCurve }): this {
    const op: DynamicsOp = {
      kind: 'dynamics',
      type: 'crescendo',
      from: options?.from ?? 0.3,
      to: options?.to ?? 1.0,
      duration,
      curve: options?.curve
    }
    return this.addOp(op)
  }

  /**
   * Add a decrescendo (gradual decrease in volume).
   */
  decrescendo(duration: NoteDuration, options?: { from?: number; to?: number; curve?: EasingCurve }): this {
    const op: DynamicsOp = {
      kind: 'dynamics',
      type: 'decrescendo',
      from: options?.from ?? 1.0,
      to: options?.to ?? 0.3,
      duration,
      curve: options?.curve
    }
    return this.addOp(op)
  }

  /**
   * Add a velocity ramp.
   */
  velocityRamp(to: number, duration: NoteDuration, options?: { from?: number; curve?: EasingCurve }): this {
    validate.velocity('velocityRamp', to)
    const op: DynamicsOp = {
      kind: 'dynamics',
      type: 'ramp',
      from: options?.from,
      to,
      duration,
      curve: options?.curve
    }
    return this.addOp(op)
  }

  /**
   * Add a multi-point velocity curve.
   */
  velocityCurve(points: VelocityPoint[], duration: NoteDuration): this {
    const op: DynamicsOp = {
      kind: 'dynamics',
      type: 'curve',
      points,
      duration
    }
    return this.addOp(op)
  }

  /**
   * Add aftertouch pressure event (channel pressure).
   */
  aftertouch(value: number, options?: { type?: 'channel' | 'poly'; note?: NoteName }): this {
    validate.inRange('aftertouch', 'value', value, 0, 1)
    const op: AftertouchOp = {
      kind: 'aftertouch',
      type: options?.type ?? 'channel',
      value,
      note: options?.note
    }
    return this.addOp(op)
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
    return this.addOp(Actions.automation(target, value, rampBeats, curve))
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
  tempoEnvelope(keyframes: import('../types/primitives').TempoKeyframe[]): this {
    if (keyframes.length < 2) {
      throw new Error('tempoEnvelope validation error: need at least 2 keyframes')
    }
    const last = keyframes[keyframes.length - 1]

    return this.addOp(Actions.tempo(last.bpm, {
      duration: last.beat - keyframes[0].beat,
      envelope: { keyframes }
    }))
  }

  /**
   * Execute builder callback within a voice scope.
   * All notes created inside inherit the expressionId.
   * Notes within the voice are SEQUENTIAL. For parallel voices, wrap in stack():
   *
   * @example
   * // Sequential voice (ties work correctly)
   * .voice(1, v => v.note('C4').tie('start').note('C4').tie('end'))
   *
   * // Parallel voices
   * .stack(s => s
   *   .voice(1, v => v.note('C4', '1n').tie('start').note('C4').tie('end'))
   *   .voice(2, v => v.note('C4', '4n').note('C4', '4n'))
   * )
   *
   * @param id - Voice identifier (1-15 for MPE)
   * @param builderFn - Builder function for the voice scope
   */
  voice(id: number, builderFn: (v: this) => this | MelodyNoteCursor): this {
    validate.inRange('voice', 'id', id, 1, 15)

    // Create a context with the expressionId set
    const voiceContext = this._createEmptyClone('VoiceContext')
      ._withParams({ expressionId: id } as unknown as ParamUpdater<P>)

    const result = builderFn(voiceContext)
    const voiceContent = (result instanceof MelodyNoteCursor) ? result.commit() : result

    // Append operations SEQUENTIALLY (not wrapped in stack)
    const operations = voiceContent._params.chain?.toArray() ?? []
    let current: this = this
    for (const op of operations) {
      current = current.addOp(op)
    }
    return current
  }

  protected _createEmptyClone(name: string): this {
    return super._createEmptyClone(name)
      ._withParams({ transposition: 0 } as unknown as ParamUpdater<P>)
  }

  protected addOp(op: ClipOperation): this {
    let finalOp = op

    // Apply transposition context to notes, stacks, and nested clips
    if (this._transposition !== 0 &&
      (op.kind === 'note' || op.kind === 'stack' || op.kind === 'clip')) {
      finalOp = {
        kind: 'transpose',
        semitones: this._transposition,
        operation: op
      }
    }

    return super.addOp(finalOp)
  }
}
