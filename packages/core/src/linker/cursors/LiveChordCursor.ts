// =============================================================================
// SymphonyScript - LiveChordCursor (RFC-043 Phase 4)
// =============================================================================
// Cursor for chord operations with inversion support.
// Extends LiveMelodyNoteCursor with chord-specific modifiers.

import { LiveMelodyNoteCursor, LiveMelodyNoteData } from './LiveMelodyNoteCursor'
import type { SiliconBridge } from '../silicon-bridge'
import { noteToMidi, midiToNote } from '../../util/midi'
import type { NoteName } from '../../types/primitives'

// =============================================================================
// Types
// =============================================================================

/**
 * Chord data containing multiple note sourceIds.
 */
export interface LiveChordData {
  noteSourceIds: number[]  // All sourceIds in the chord
  baseTick: number
  duration: number
  velocity: number
}

// =============================================================================
// LiveChordCursor
// =============================================================================

/**
 * Cursor for chord operations.
 * Manages multiple notes as a single unit.
 */
export class LiveChordCursor<B extends {
  getBridge(): SiliconBridge
  note(pitch: any, duration?: any): LiveMelodyNoteCursor<B>
  chord(pitches: any, duration?: any): LiveChordCursor<B>
  chord(code: any, octave: number, duration?: any): LiveChordCursor<B>
  degree(deg: number, duration?: any, options?: any): LiveMelodyNoteCursor<B>
  degreeChord(degrees: number[], duration?: any): any
  roman(numeral: string, optionsOrDuration?: any): any
  transpose(semitones: number): B
  octave(n: number): B
  octaveUp(n?: number): B
  octaveDown(n?: number): B
  scale(root: any, mode: any, octave?: number): B
  euclidean(options: any): B
  arpeggio(pitches: any[], rate: any, options?: any): B
  vibrato(depth?: number, rate?: number): B
  crescendo(duration: any, options?: any): B
  decrescendo(duration: any, options?: any): B
  velocityRamp(to: number, duration: any, options?: any): B
  velocityCurve(points: any[], duration: any): B
  aftertouch(value: number, options?: any): B
  automate(target: any, value: number, rampBeats?: number, curve?: any): B
  volume(value: number, rampBeats?: number): B
  pan(value: number, rampBeats?: number): B
  tempoEnvelope(keyframes: any[]): B
  rest(duration: any): B
  tempo(bpm: number): B
  timeSignature(signature: any): B
  swing(amount: number): B
  groove(template: any): B
  defaultHumanize(settings: any): B
  quantize(grid: any, options?: any): B
  control(controller: number, value: number): B
  finalize(): void
}> {
  protected readonly builder: B
  protected readonly bridge: SiliconBridge
  protected readonly chordData: LiveChordData
  protected readonly noteDataList: LiveMelodyNoteData[]

  constructor(builder: B, chordData: LiveChordData, noteDataList: LiveMelodyNoteData[]) {
    this.builder = builder
    this.bridge = builder.getBridge()
    this.chordData = chordData
    this.noteDataList = noteDataList
  }

  // ===========================================================================
  // Chord-Specific Modifiers
  // ===========================================================================

  /**
   * Invert the chord by rotating notes.
   * @param steps Number of inversion steps (positive = up, negative = down)
   */
  inversion(steps: number): this {
    if (this.noteDataList.length < 2) return this

    const count = this.noteDataList.length
    const octaveShift = Math.floor(steps / count)
    const remainingSteps = ((steps % count) + count) % count  // positive mod

    // Apply global octave shift first
    if (octaveShift !== 0) {
      for (const noteData of this.noteDataList) {
        const newMidi = noteData.pitch + (octaveShift * 12)
        if (newMidi >= 0 && newMidi <= 127) {
          noteData.pitch = newMidi
          this.bridge.patchImmediate(noteData.sourceId, 'pitch', newMidi)
        }
      }
    }

    // Sort by pitch for proper inversion
    const sorted = [...this.noteDataList].sort((a, b) => a.pitch - b.pitch)

    // Apply remaining rotations (move lowest note up an octave)
    for (let i = 0; i < remainingSteps; i++) {
      const lowest = sorted[i]
      const newMidi = lowest.pitch + 12
      if (newMidi <= 127) {
        lowest.pitch = newMidi
        this.bridge.patchImmediate(lowest.sourceId, 'pitch', newMidi)
      }
    }

    return this
  }

  // ===========================================================================
  // Inherited Modifiers (Apply to All Notes)
  // ===========================================================================

  /**
   * Set velocity for all notes in chord.
   */
  velocity(v: number): this {
    const normalizedVelocity = v <= 1 ? Math.round(v * 127) : Math.round(v)
    const clamped = Math.max(0, Math.min(127, normalizedVelocity))

    for (const noteData of this.noteDataList) {
      noteData.velocity = clamped
      this.bridge.patchImmediate(noteData.sourceId, 'velocity', clamped)
    }
    this.chordData.velocity = clamped

    return this
  }

  /**
   * Apply staccato to all notes (50% duration).
   */
  staccato(): this {
    for (const noteData of this.noteDataList) {
      const newDuration = Math.round(noteData.duration * 0.5)
      noteData.duration = newDuration
      this.bridge.patchImmediate(noteData.sourceId, 'duration', newDuration)
    }
    this.chordData.duration = Math.round(this.chordData.duration * 0.5)
    return this
  }

  /**
   * Apply legato to all notes (105% duration).
   */
  legato(): this {
    for (const noteData of this.noteDataList) {
      const newDuration = Math.round(noteData.duration * 1.05)
      noteData.duration = newDuration
      this.bridge.patchImmediate(noteData.sourceId, 'duration', newDuration)
    }
    this.chordData.duration = Math.round(this.chordData.duration * 1.05)
    return this
  }

  /**
   * Apply accent to all notes.
   */
  accent(): this {
    for (const noteData of this.noteDataList) {
      const boosted = Math.min(127, Math.round(noteData.velocity * 1.2))
      noteData.velocity = boosted
      this.bridge.patchImmediate(noteData.sourceId, 'velocity', boosted)
    }
    return this
  }

  /**
   * Apply tenuto to all notes.
   */
  tenuto(): this {
    return this
  }

  /**
   * Apply marcato to all notes.
   */
  marcato(): this {
    for (const noteData of this.noteDataList) {
      const boosted = Math.min(127, Math.round(noteData.velocity * 1.3))
      noteData.velocity = boosted
      this.bridge.patchImmediate(noteData.sourceId, 'velocity', boosted)
    }
    return this
  }

  /**
   * Apply humanization to all notes.
   */
  humanize(options?: { timing?: number; velocity?: number }): this {
    for (const noteData of this.noteDataList) {
      noteData.humanize = options ?? { timing: 15, velocity: 0.05 }
    }
    return this
  }

  /**
   * Disable humanization for all notes.
   */
  precise(): this {
    for (const noteData of this.noteDataList) {
      noteData.humanize = null
      noteData.quantize = null
    }
    return this
  }

  // ===========================================================================
  // Expression Modifiers (Apply to All Notes)
  // ===========================================================================

  /**
   * Apply detune to all notes.
   */
  detune(cents: number): this {
    const clamped = Math.max(-1200, Math.min(1200, cents))
    for (const noteData of this.noteDataList) {
      noteData.detune = clamped
    }
    return this
  }

  /**
   * Apply timbre to all notes.
   */
  timbre(value: number): this {
    const clamped = Math.max(0, Math.min(1, value))
    for (const noteData of this.noteDataList) {
      noteData.timbre = clamped
    }
    return this
  }

  /**
   * Apply pressure to all notes.
   */
  pressure(value: number): this {
    const clamped = Math.max(0, Math.min(1, value))
    for (const noteData of this.noteDataList) {
      noteData.pressure = clamped
    }
    return this
  }

  /**
   * Apply expression params to all notes.
   */
  expression(params: { detune?: number; timbre?: number; pressure?: number }): this {
    if (params.detune !== undefined) this.detune(params.detune)
    if (params.timbre !== undefined) this.timbre(params.timbre)
    if (params.pressure !== undefined) this.pressure(params.pressure)
    return this
  }

  /**
   * Apply glide to all notes.
   */
  glide(time: any): this {
    for (const noteData of this.noteDataList) {
      noteData.glide = { time }
    }
    return this
  }

  /**
   * Mark all notes as part of a tie.
   */
  tie(type: 'start' | 'continue' | 'end'): this {
    for (const noteData of this.noteDataList) {
      noteData.tie = type
    }
    return this
  }

  // ===========================================================================
  // Escape Methods
  // ===========================================================================

  /**
   * Commit and return builder.
   */
  commit(): B {
    return this.builder
  }

  /**
   * Commit and add rest.
   */
  rest(duration: any): B {
    return this.commit().rest(duration)
  }

  /**
   * Commit and set tempo.
   */
  tempo(bpm: number): B {
    return this.commit().tempo(bpm)
  }

  /**
   * Commit and set time signature.
   */
  timeSignature(signature: any): B {
    return this.commit().timeSignature(signature)
  }

  /**
   * Commit and set swing.
   */
  swing(amount: number): B {
    return this.commit().swing(amount)
  }

  /**
   * Commit and set groove.
   */
  groove(template: any): B {
    return this.commit().groove(template)
  }

  /**
   * Commit and set default humanize.
   */
  defaultHumanize(settings: any): B {
    return this.commit().defaultHumanize(settings)
  }

  /**
   * Commit and set quantize.
   */
  quantize(grid: any, options?: any): B {
    return this.commit().quantize(grid, options)
  }

  /**
   * Commit and send control change.
   */
  control(controller: number, value: number): B {
    return this.commit().control(controller, value)
  }

  /**
   * Commit and finalize.
   */
  finalize(): void {
    this.commit().finalize()
  }

  // ===========================================================================
  // Relay Methods
  // ===========================================================================

  /**
   * Commit and start new note.
   */
  note(pitch: any, duration?: any): LiveMelodyNoteCursor<B> {
    return this.commit().note(pitch, duration)
  }

  /**
   * Commit and start new chord.
   */
  chord(pitches: any, duration?: any): LiveChordCursor<B>
  chord(code: any, octave: number, duration?: any): LiveChordCursor<B>
  chord(arg1: any, arg2?: any, arg3?: any): LiveChordCursor<B> {
    return this.commit().chord(arg1, arg2, arg3)
  }

  /**
   * Commit and start note by degree.
   */
  degree(deg: number, duration?: any, options?: any): LiveMelodyNoteCursor<B> {
    return this.commit().degree(deg, duration, options)
  }

  /**
   * Commit and start chord by degrees.
   */
  degreeChord(degrees: number[], duration?: any): LiveChordCursor<B> {
    return this.commit().degreeChord(degrees, duration)
  }

  /**
   * Commit and start roman numeral chord.
   */
  roman(numeral: string, optionsOrDuration?: any): LiveChordCursor<B> {
    return this.commit().roman(numeral, optionsOrDuration)
  }

  // ===========================================================================
  // Builder Method Escapes
  // ===========================================================================

  transpose(semitones: number): B { return this.commit().transpose(semitones) }
  octave(n: number): B { return this.commit().octave(n) }
  octaveUp(n?: number): B { return this.commit().octaveUp(n) }
  octaveDown(n?: number): B { return this.commit().octaveDown(n) }
  scale(root: any, mode: any, octave?: number): B { return this.commit().scale(root, mode, octave) }
  euclidean(options: any): B { return this.commit().euclidean(options) }
  arpeggio(pitches: any[], rate: any, options?: any): B { return this.commit().arpeggio(pitches, rate, options) }
  vibrato(depth?: number, rate?: number): B { return this.commit().vibrato(depth, rate) }
  crescendo(duration: any, options?: any): B { return this.commit().crescendo(duration, options) }
  decrescendo(duration: any, options?: any): B { return this.commit().decrescendo(duration, options) }
  velocityRamp(to: number, duration: any, options?: any): B { return this.commit().velocityRamp(to, duration, options) }
  velocityCurve(points: any[], duration: any): B { return this.commit().velocityCurve(points, duration) }
  aftertouch(value: number, options?: any): B { return this.commit().aftertouch(value, options) }
  automate(target: any, value: number, rampBeats?: number, curve?: any): B { return this.commit().automate(target, value, rampBeats, curve) }
  volume(value: number, rampBeats?: number): B { return this.commit().volume(value, rampBeats) }
  pan(value: number, rampBeats?: number): B { return this.commit().pan(value, rampBeats) }
  tempoEnvelope(keyframes: any[]): B { return this.commit().tempoEnvelope(keyframes) }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  getChordData(): LiveChordData {
    return { ...this.chordData }
  }

  getNoteDataList(): LiveMelodyNoteData[] {
    return this.noteDataList.map(n => ({ ...n }))
  }
}
