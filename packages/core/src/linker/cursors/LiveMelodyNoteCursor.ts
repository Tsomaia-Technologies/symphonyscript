// =============================================================================
// SymphonyScript - LiveMelodyNoteCursor (RFC-043 Phase 4)
// =============================================================================
// Cursor for melody notes with expression support.
// Extends LiveNoteCursor with melody-specific modifiers.

import { LiveNoteCursor, LiveNoteData, LiveBuilderBase } from './LiveNoteCursor'
import type { NoteDuration, NoteName, TempoKeyframe } from '../../types/primitives'
import type { AutomationTarget } from '../legacy-types'
import type { ScaleMode } from '../../scales'
import type { ChordCode, ChordRoot } from '../../chords/types'
import { noteToMidi, midiToNote } from '../../util/midi'

// =============================================================================
// Extended Types
// =============================================================================

/**
 * Extended note data for melody notes.
 */
export interface LiveMelodyNoteData extends LiveNoteData {
  detune?: number       // cents (-1200 to +1200)
  timbre?: number       // 0-1
  pressure?: number     // 0-1
  glide?: { time: NoteDuration }
  tie?: 'start' | 'continue' | 'end'
}

/**
 * Extended builder interface for melody cursor type constraints.
 */
export interface LiveMelodyBuilderBase extends LiveBuilderBase {
  note(pitch: NoteName | string, duration?: NoteDuration): LiveMelodyNoteCursor<any>
  chord(pitches: NoteName[], duration?: NoteDuration): any
  chord(code: ChordCode, octave: number, duration?: NoteDuration): any
  degree(deg: number, duration?: NoteDuration, options?: any): LiveMelodyNoteCursor<any>
  degreeChord(degrees: number[], duration?: NoteDuration): any
  roman(numeral: string, optionsOrDuration?: any): any
  transpose(semitones: number): this
  octave(n: number): this
  octaveUp(n?: number): this
  octaveDown(n?: number): this
  scale(root: ChordRoot, mode: ScaleMode, octave?: number): this
  euclidean(options: any): this
  arpeggio(pitches: NoteName[], rate: NoteDuration, options?: any): this
  vibrato(depth?: number, rate?: number): this
  crescendo(duration: NoteDuration, options?: any): this
  decrescendo(duration: NoteDuration, options?: any): this
  velocityRamp(to: number, duration: NoteDuration, options?: any): this
  velocityCurve(points: any[], duration: NoteDuration): this
  aftertouch(value: number, options?: any): this
  automate(target: AutomationTarget, value: number, rampBeats?: number, curve?: any): this
  volume(value: number, rampBeats?: number): this
  pan(value: number, rampBeats?: number): this
  tempoEnvelope(keyframes: TempoKeyframe[]): this
}

// =============================================================================
// LiveMelodyNoteCursor
// =============================================================================

/**
 * Cursor for melody notes with expression support.
 * Extends LiveNoteCursor with melody-specific modifiers.
 */
export class LiveMelodyNoteCursor<B extends LiveMelodyBuilderBase> extends LiveNoteCursor<B> {
  protected readonly melodyNoteData: LiveMelodyNoteData

  constructor(builder: B, noteData: LiveMelodyNoteData) {
    super(builder, noteData)
    this.melodyNoteData = noteData
  }

  // ===========================================================================
  // Expression Modifiers (Melody-Specific)
  // ===========================================================================

  /**
   * Microtonal pitch adjustment in cents (-1200 to +1200).
   * Note: Stored as metadata; SAB pitch is integer MIDI.
   */
  detune(cents: number): this {
    const clamped = Math.max(-1200, Math.min(1200, cents))
    this.melodyNoteData.detune = clamped
    // For SAB: could adjust pitch by semitones if cents >= 100
    // For now, store as metadata for future MPE support
    return this
  }

  /**
   * Set initial timbre/brightness (0-1).
   * Note: Stored as metadata for future MPE support.
   */
  timbre(value: number): this {
    const clamped = Math.max(0, Math.min(1, value))
    this.melodyNoteData.timbre = clamped
    return this
  }

  /**
   * Set initial pressure (0-1).
   * Note: Stored as metadata for future MPE support.
   */
  pressure(value: number): this {
    const clamped = Math.max(0, Math.min(1, value))
    this.melodyNoteData.pressure = clamped
    return this
  }

  /**
   * Apply multiple expression parameters.
   */
  expression(params: { detune?: number; timbre?: number; pressure?: number }): this {
    if (params.detune !== undefined) this.detune(params.detune)
    if (params.timbre !== undefined) this.timbre(params.timbre)
    if (params.pressure !== undefined) this.pressure(params.pressure)
    return this
  }

  /**
   * Add glide/portamento from previous pitch.
   * Note: Stored as metadata for future implementation.
   */
  glide(time: NoteDuration): this {
    this.melodyNoteData.glide = { time }
    return this
  }

  /**
   * Mark note as part of a tie.
   */
  tie(type: 'start' | 'continue' | 'end'): this {
    this.melodyNoteData.tie = type
    return this
  }

  /**
   * Force note to be natural (strip any accidentals).
   */
  natural(): this {
    const midi = this.melodyNoteData.pitch
    const noteName = midiToNote(midi)
    if (noteName) {
      const stripped = noteName.replace(/[#b]/, '')
      const match = stripped.match(/^([A-Ga-g])(\d+)$/)
      if (match) {
        const newMidi = noteToMidi(stripped as NoteName)
        if (newMidi !== null && newMidi !== midi) {
          this.melodyNoteData.pitch = newMidi
          this.bridge.patchDirect(this.melodyNoteData.sourceId, 'pitch', newMidi)
        }
      }
    }
    return this
  }

  /**
   * Force note to be sharp.
   */
  sharp(): this {
    const midi = this.melodyNoteData.pitch
    const noteName = midiToNote(midi)
    if (noteName) {
      const match = noteName.match(/^([A-Ga-g])([#b]?)(\d+)$/)
      if (match && match[2] !== '#') {
        // Add a semitone if not already sharp
        const newMidi = match[2] === 'b' ? midi : midi + 1
        if (newMidi !== midi && newMidi <= 127) {
          this.melodyNoteData.pitch = newMidi
          this.bridge.patchDirect(this.melodyNoteData.sourceId, 'pitch', newMidi)
        }
      }
    }
    return this
  }

  /**
   * Force note to be flat.
   */
  flat(): this {
    const midi = this.melodyNoteData.pitch
    const noteName = midiToNote(midi)
    if (noteName) {
      const match = noteName.match(/^([A-Ga-g])([#b]?)(\d+)$/)
      if (match && match[2] !== 'b') {
        // Subtract a semitone if not already flat
        const newMidi = match[2] === '#' ? midi : midi - 1
        if (newMidi !== midi && newMidi >= 0) {
          this.melodyNoteData.pitch = newMidi
          this.bridge.patchDirect(this.melodyNoteData.sourceId, 'pitch', newMidi)
        }
      }
    }
    return this
  }

  // ===========================================================================
  // Relay Methods (Commit & Start New Note/Chord)
  // ===========================================================================

  /**
   * Commit pending and start a new note.
   */
  note(pitch: NoteName | string, duration?: NoteDuration): LiveMelodyNoteCursor<B> {
    return this.commit().note(pitch, duration)
  }

  /**
   * Commit pending and start a new chord.
   */
  chord(pitches: NoteName[], duration?: NoteDuration): ReturnType<B['chord']>
  chord(code: ChordCode, octave: number, duration?: NoteDuration): ReturnType<B['chord']>
  chord(
    arg1: NoteName[] | ChordCode,
    arg2?: NoteDuration | number,
    arg3?: NoteDuration
  ): ReturnType<B['chord']> {
    return this.commit().chord(arg1 as any, arg2 as any, arg3 as any)
  }

  /**
   * Commit pending and start new note by scale degree.
   */
  degree(
    deg: number,
    duration?: NoteDuration,
    options?: { alteration?: number; octaveOffset?: number }
  ): LiveMelodyNoteCursor<B> {
    return this.commit().degree(deg, duration, options)
  }

  /**
   * Commit and start chord by scale degrees.
   */
  degreeChord(degrees: number[], duration?: NoteDuration): ReturnType<B['degreeChord']> {
    return this.commit().degreeChord(degrees, duration)
  }

  /**
   * Commit and start roman numeral chord.
   */
  roman(numeral: string, optionsOrDuration?: NoteDuration | { inversion?: number; duration?: NoteDuration }): ReturnType<B['roman']> {
    return this.commit().roman(numeral, optionsOrDuration)
  }

  // ===========================================================================
  // Escape Methods (MelodyBuilder Specific)
  // ===========================================================================

  /**
   * Commit and add vibrato.
   */
  vibrato(depth: number = 0.5, rate?: number): B {
    return this.commit().vibrato(depth, rate)
  }

  /**
   * Commit and transpose.
   */
  transpose(semitones: number): B {
    return this.commit().transpose(semitones)
  }

  /**
   * Commit and set octave.
   */
  octave(n: number): B {
    return this.commit().octave(n)
  }

  /**
   * Commit and shift up octaves.
   */
  octaveUp(n?: number): B {
    return this.commit().octaveUp(n)
  }

  /**
   * Commit and shift down octaves.
   */
  octaveDown(n?: number): B {
    return this.commit().octaveDown(n)
  }

  /**
   * Commit and set scale context.
   */
  scale(root: ChordRoot, mode: ScaleMode, octave?: number): B {
    return this.commit().scale(root, mode, octave)
  }

  /**
   * Commit and generate euclidean pattern.
   */
  euclidean(options: any): B {
    return this.commit().euclidean(options)
  }

  /**
   * Commit and arpeggiate.
   */
  arpeggio(pitches: NoteName[], rate: NoteDuration, options?: any): B {
    return this.commit().arpeggio(pitches, rate, options)
  }

  /**
   * Commit and add crescendo.
   */
  crescendo(duration: NoteDuration, options?: any): B {
    return this.commit().crescendo(duration, options)
  }

  /**
   * Commit and add decrescendo.
   */
  decrescendo(duration: NoteDuration, options?: any): B {
    return this.commit().decrescendo(duration, options)
  }

  /**
   * Commit and add velocity ramp.
   */
  velocityRamp(to: number, duration: NoteDuration, options?: any): B {
    return this.commit().velocityRamp(to, duration, options)
  }

  /**
   * Commit and add velocity curve.
   */
  velocityCurve(points: any[], duration: NoteDuration): B {
    return this.commit().velocityCurve(points, duration)
  }

  /**
   * Commit and add aftertouch.
   */
  aftertouch(value: number, options?: any): B {
    return this.commit().aftertouch(value, options)
  }

  /**
   * Commit and automate.
   */
  automate(target: AutomationTarget, value: number, rampBeats?: number, curve?: any): B {
    return this.commit().automate(target, value, rampBeats, curve)
  }

  /**
   * Commit and set volume.
   */
  volume(value: number, rampBeats?: number): B {
    return this.commit().volume(value, rampBeats)
  }

  /**
   * Commit and set pan.
   */
  pan(value: number, rampBeats?: number): B {
    return this.commit().pan(value, rampBeats)
  }

  /**
   * Commit and set tempo envelope.
   */
  tempoEnvelope(keyframes: TempoKeyframe[]): B {
    return this.commit().tempoEnvelope(keyframes)
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get the extended melody note data.
   */
  getMelodyNoteData(): LiveMelodyNoteData {
    return { ...this.melodyNoteData }
  }
}
