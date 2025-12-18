// =============================================================================
// SymphonyScript - MelodyBuilder (RFC-040 Zero-Allocation)
// =============================================================================

import { OP } from '../vm/constants'
import { ClipBuilder } from './ClipBuilder'
import { NoteCursor } from './NoteCursor'
import { noteToMidi } from '../util/midi'
import type { NoteDuration } from './types'
import type { NoteName } from '../types/primitives'

/**
 * Melody-focused builder that extends ClipBuilder with note, chord, and
 * transposition capabilities.
 * 
 * Uses Builder Bytecode format with absolute ticks:
 * NOTE: [opcode, tick, pitch, vel, dur] - 5 fields
 */
export class MelodyBuilder extends ClipBuilder {
  // Recycled cursor instance
  protected override _cursor: NoteCursor<this>

  constructor() {
    super()
    this._cursor = new NoteCursor(this)
  }

  // --- Note Operations ---

  /**
   * Add a note.
   * Builder format: [NOTE, tick, pitch, vel, dur]
   * 
   * @param pitch - Note name (e.g., 'C4', 'F#5')
   * @param duration - Duration (e.g., '4n', '8n', 0.5)
   * @returns NoteCursor for in-place modification
   */
  note(pitch: NoteName, duration?: NoteDuration): NoteCursor<this> {
    const opIndex = this.buf.length
    const midi = (noteToMidi(pitch) ?? 60) + this._trans
    const dur = this.durationToTicks(duration ?? this._defaultDur)

    // Builder format: [opcode, tick, pitch, vel, dur]
    this.buf.push(OP.NOTE, this._tick, midi, this._vel, dur)
    this._tick += dur

    this._cursor.opIndex = opIndex
    return this._cursor
  }

  /**
   * Add a chord (multiple simultaneous notes).
   * Emits STACK_START with NOTE branches.
   * 
   * @param pitches - Array of note names
   * @param duration - Duration for all notes
   * @returns NoteCursor (opIndex = -1, no single note to modify)
   */
  chord(pitches: NoteName[], duration?: NoteDuration): NoteCursor<this> {
    if (pitches.length === 0) {
      this._cursor.opIndex = -1
      return this._cursor
    }

    const dur = this.durationToTicks(duration ?? this._defaultDur)
    const startTick = this._tick

    // Emit STACK_START
    this.buf.push(OP.STACK_START, this._tick, pitches.length)

    for (const pitch of pitches) {
      const midi = (noteToMidi(pitch) ?? 60) + this._trans

      this.buf.push(OP.BRANCH_START)
      // Builder format: [NOTE, tick, pitch, vel, dur]
      this.buf.push(OP.NOTE, startTick, midi, this._vel, dur)
      this.buf.push(OP.BRANCH_END)
    }

    this.buf.push(OP.STACK_END)

    // Advance tick by chord duration
    this._tick = startTick + dur

    // No single note to modify
    this._cursor.opIndex = -1
    return this._cursor
  }

  // --- Transposition ---

  /**
   * Add transposition (additive).
   * This is a state change, not an opcode.
   */
  transpose(semitones: number): this {
    this._trans += semitones
    return this
  }

  /**
   * Set absolute octave register.
   * Octave 4 is neutral (no transposition).
   */
  octave(n: number): this {
    this._trans = (n - 4) * 12
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

  // --- Clone Override ---

  /**
   * Create an independent copy.
   */
  override clone(): this {
    const copy = super.clone() as this
    // Cursor is already created in constructor
    return copy
  }
}

/**
 * Extended NoteCursor for MelodyBuilder with note() method.
 */
declare module './NoteCursor' {
  interface NoteCursor<B> {
    /**
     * Add another note and return cursor for the new note.
     * Only available when B extends MelodyBuilder.
     */
    note(this: NoteCursor<MelodyBuilder>, pitch: NoteName, duration?: NoteDuration): NoteCursor<MelodyBuilder>

    /**
     * Add a chord and return cursor.
     * Only available when B extends MelodyBuilder.
     */
    chord(this: NoteCursor<MelodyBuilder>, pitches: NoteName[], duration?: NoteDuration): NoteCursor<MelodyBuilder>

    /**
     * Add transposition and return builder.
     * Only available when B extends MelodyBuilder.
     */
    transpose(this: NoteCursor<MelodyBuilder>, semitones: number): MelodyBuilder

    /**
     * Set octave and return builder.
     * Only available when B extends MelodyBuilder.
     */
    octave(this: NoteCursor<MelodyBuilder>, n: number): MelodyBuilder

    /**
     * Octave up and return builder.
     * Only available when B extends MelodyBuilder.
     */
    octaveUp(this: NoteCursor<MelodyBuilder>, n?: number): MelodyBuilder

    /**
     * Octave down and return builder.
     * Only available when B extends MelodyBuilder.
     */
    octaveDown(this: NoteCursor<MelodyBuilder>, n?: number): MelodyBuilder
  }
}

// Add note() method to NoteCursor prototype
NoteCursor.prototype.note = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  pitch: NoteName,
  duration?: NoteDuration
): NoteCursor<B> {
  const builder = this.builder as unknown as MelodyBuilder
  if ('note' in builder && typeof builder.note === 'function') {
    return builder.note(pitch, duration) as unknown as NoteCursor<B>
  }
  throw new Error('note() is only available on MelodyBuilder')
}

// Add chord() method to NoteCursor prototype
NoteCursor.prototype.chord = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  pitches: NoteName[],
  duration?: NoteDuration
): NoteCursor<B> {
  const builder = this.builder as unknown as MelodyBuilder
  if ('chord' in builder && typeof builder.chord === 'function') {
    return builder.chord(pitches, duration) as unknown as NoteCursor<B>
  }
  throw new Error('chord() is only available on MelodyBuilder')
}

// Add transpose() method to NoteCursor prototype
NoteCursor.prototype.transpose = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  semitones: number
): B {
  const builder = this.builder as unknown as MelodyBuilder
  if ('transpose' in builder && typeof builder.transpose === 'function') {
    return builder.transpose(semitones) as unknown as B
  }
  throw new Error('transpose() is only available on MelodyBuilder')
}

// Add octave() method to NoteCursor prototype
NoteCursor.prototype.octave = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  n: number
): B {
  const builder = this.builder as unknown as MelodyBuilder
  if ('octave' in builder && typeof builder.octave === 'function') {
    return builder.octave(n) as unknown as B
  }
  throw new Error('octave() is only available on MelodyBuilder')
}

// Add octaveUp() method to NoteCursor prototype
NoteCursor.prototype.octaveUp = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  n: number = 1
): B {
  const builder = this.builder as unknown as MelodyBuilder
  if ('octaveUp' in builder && typeof builder.octaveUp === 'function') {
    return builder.octaveUp(n) as unknown as B
  }
  throw new Error('octaveUp() is only available on MelodyBuilder')
}

// Add octaveDown() method to NoteCursor prototype
NoteCursor.prototype.octaveDown = function <B extends ClipBuilder>(
  this: NoteCursor<B>,
  n: number = 1
): B {
  const builder = this.builder as unknown as MelodyBuilder
  if ('octaveDown' in builder && typeof builder.octaveDown === 'function') {
    return builder.octaveDown(n) as unknown as B
  }
  throw new Error('octaveDown() is only available on MelodyBuilder')
}
