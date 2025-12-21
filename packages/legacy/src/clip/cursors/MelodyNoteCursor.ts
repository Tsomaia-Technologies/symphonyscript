import { NoteCursor } from './NoteCursor'
import type { MelodyBuilder } from '../MelodyBuilder'
import type { EuclideanMelodyOptions } from '../MelodyBuilder' // We might need to split this if types are circular.
// Use 'any' or default params for generic to avoid strict constraint issues
import type {
    NoteDuration,
    NoteName,
    EasingCurve,
    TempoKeyframe
} from '@symphonyscript/core/types/primitives'
import type { AutomationTarget } from '../../automation/types'
import type { ScaleMode } from '@symphonyscript/core/scales'
import type { ClipOperation, TieType } from '../types'
import { validate } from '../../validation/runtime'
import type { ChordCode, ChordRoot } from '@symphonyscript/core/chords/types'
import type { MelodyChordCursor } from './MelodyChordCursor'

/**
 * Cursor for melody notes with expression support.
 */
export class MelodyNoteCursor extends NoteCursor<MelodyBuilder> {
    // --- Modifiers (Note Expression) ---

    /** Microtonal pitch adjustment in cents (-1200 to +1200) */
    detune(cents: number): this {
        validate.inRange('detune', 'cents', cents, -1200, 1200)
        // We can't use validate.lastOpIsNote because checking pendingOp is simpler
        this.applyModifier({ detune: cents })
        return this
    }

    /** Set initial timbre/brightness (0-1) */
    timbre(value: number): this {
        validate.inRange('timbre', 'value', value, 0, 1)
        this.applyModifier({ timbre: value })
        return this
    }

    /** Set initial pressure (0-1) */
    pressure(value: number): this {
        validate.inRange('pressure', 'value', value, 0, 1)
        this.applyModifier({ pressure: value })
        return this
    }

    /** Apply multiple expression parameters */
    expression(params: { detune?: number; timbre?: number; pressure?: number }): this {
        if (params.detune !== undefined) validate.inRange('expression', 'detune', params.detune, -1200, 1200)
        if (params.timbre !== undefined) validate.inRange('expression', 'timbre', params.timbre, 0, 1)
        if (params.pressure !== undefined) validate.inRange('expression', 'pressure', params.pressure, 0, 1)

        this.applyModifier(params)
        return this
    }

    /** Add glide/portamento from previous pitch */
    glide(time: NoteDuration): this {
        this.applyModifier({ glide: { time } })
        return this
    }

    /** Mark note as part of a tie */
    tie(type: TieType): this {
        this.applyModifier({ tie: type })
        return this
    }

    /**
     * Force note to be natural (strip any accidentals).
     * Use when you need to override the key signature for a specific note.
     * 
     * @example
     * .key('G', 'major')
     * .note('F4').natural()  // F natural, not F#
     */
    natural(): this {
        if (this.pendingOp.kind === 'note') {
            const note = this.pendingOp.note
            const stripped = note.replace(/[#b]/, '')
            this.pendingOp.note = stripped as import('@symphonyscript/core/types/primitives').NoteName
        }
        return this
    }

    /**
     * Force note to be sharp.
     * Adds or replaces accidental with sharp.
     * 
     * @example
     * .note('F4').sharp()  // F#4
     */
    sharp(): this {
        if (this.pendingOp.kind === 'note') {
            const note = this.pendingOp.note
            const match = note.match(/^([A-Ga-g])([#b]?)(\d+)$/)
            if (match) {
                this.pendingOp.note = `${match[1]}#${match[3]}` as import('@symphonyscript/core/types/primitives').NoteName
            }
        }
        return this
    }

    /**
     * Force note to be flat.
     * Adds or replaces accidental with flat.
     * 
     * @example
     * .note('B4').flat()  // Bb4
     */
    flat(): this {
        if (this.pendingOp.kind === 'note') {
            const note = this.pendingOp.note
            const match = note.match(/^([A-Ga-g])([#b]?)(\d+)$/)
            if (match) {
                this.pendingOp.note = `${match[1]}b${match[3]}` as import('@symphonyscript/core/types/primitives').NoteName
            }
        }
        return this
    }

    /** Add vibrato */
    vibrato(depth: number = 0.5, rate?: number): MelodyBuilder {
        // vibrato is a separate OP, not a note modifier in the current builder?
        // In types.ts: export interface VibratoOp { kind: 'vibrato', ... }
        // BUT MelodyBuilder.vibrato() adds a separate Op.
        // So this is an ESCAPE that commits the note, then adds vibrato op.
        // Wait, RFC says "Moves to MelodyNoteCursor".
        // If it's a note modifier, it should be on the note op.
        // Looking at types.ts: NoteOp does NOT have vibrato.
        // MelodyBuilder.vibrato() -> this.play(Actions.vibrato(depth, rate))
        // So it's a timeline op.
        // So calling .vibrato() commits the note?
        // If so, it returns MelodyBuilder.
        return this.commit().vibrato(depth, rate)
    }

    // NOTE: The RFC plan inventory listed "vibrato" as "MOVE to MelodyNoteCursor".
    // But if the NoteOp doesn't support it, it must be an escape.
    // Unless we added vibrato to NoteOp? Only detune, timbre, pressure, humanize, tie, glide are on NoteOp.
    // VibratoOp is separate.
    // So .vibrato() is an escape.

    // --- Relays (Commit & Start New Note) ---

    /** Commit pending and start a new note */
    note(pitch: NoteName | string, duration?: NoteDuration): MelodyNoteCursor {
        return this.commit().note(pitch, duration)
    }

    /** Commit pending and start a new chord */
    chord(pitches: NoteName[], duration?: NoteDuration): MelodyChordCursor
    chord(code: ChordCode, octave: number, duration?: NoteDuration): MelodyChordCursor
    chord(
        arg1: NoteName[] | ChordCode,
        arg2?: NoteDuration | number,
        arg3?: NoteDuration
    ): MelodyChordCursor {
        return this.commit().chord(arg1 as any, arg2 as any, arg3)
    }

    /** Commit pending and start new note by scale degree */
    degree(
        deg: number,
        duration?: NoteDuration,
        velocity?: number, // Optional arg in builder (default 1) - wait, builder has velocity arg?
        // Builder logic will change to remove velocity.
        // We should anticipate the builder signature change.
        // But MelodayBuilder.degree calls this.note().
        // If we update degree() to allow modifiers chaining, it should return Cursor.
        // We need to check if we strip velocity from degree() too?
        // The plan said: "degree(...) wraps note(); return cursor".
        // If we remove velocity from note(), we should probably remove it from degree() too.
        // But let's stick to what the Builder will have.
        options?: { alteration?: number; octaveOffset?: number }
    ): MelodyNoteCursor {
        // We will update MelodyBuilder.degree signature to:
        // degree(deg, duration, options): MelodyNoteCursor
        return this.commit().degree(deg, duration, options)
    }

    /** Commit and start chord by scale degrees */
    degreeChord(
        degrees: number[],
        duration?: NoteDuration
    ): MelodyNoteCursor {
        return this.commit().degreeChord(degrees, duration)
    }

    /** Commit and start roman numeral chord */
    roman(numeral: string, duration?: NoteDuration | {
        inversion?: number,
        duration?: NoteDuration
    }): MelodyNoteCursor {
        return this.commit().roman(numeral, duration)
    }

    // --- Escapes (MelodyBuilder Specific) ---

    transpose(semitones: number): MelodyBuilder {
        return this.commit().transpose(semitones)
    }

    octave(n: number): MelodyBuilder {
        return this.commit().octave(n)
    }

    octaveUp(n?: number): MelodyBuilder {
        return this.commit().octaveUp(n)
    }

    octaveDown(n?: number): MelodyBuilder {
        return this.commit().octaveDown(n)
    }

    scale(root: ChordRoot, mode: ScaleMode, octave?: number): MelodyBuilder {
        return this.commit().scale(root, mode, octave)
    }

    euclidean(options: EuclideanMelodyOptions): MelodyBuilder {
        return this.commit().euclidean(options)
    }

    arpeggio(
        pitches: NoteName[],
        rate: NoteDuration,
        options?: any
    ): MelodyBuilder {
        return this.commit().arpeggio(pitches, rate, options)
    }

    crescendo(duration: NoteDuration, options?: any): MelodyBuilder {
        return this.commit().crescendo(duration, options)
    }

    decrescendo(duration: NoteDuration, options?: any): MelodyBuilder {
        return this.commit().decrescendo(duration, options)
    }

    velocityRamp(to: number, duration: NoteDuration, options?: any): MelodyBuilder {
        return this.commit().velocityRamp(to, duration, options)
    }

    velocityCurve(points: any[], duration: NoteDuration): MelodyBuilder {
        return this.commit().velocityCurve(points, duration)
    }

    aftertouch(value: number, options?: any): MelodyBuilder {
        return this.commit().aftertouch(value, options)
    }

    automate(target: AutomationTarget, value: number, rampBeats?: number, curve?: any): MelodyBuilder {
        return this.commit().automate(target, value, rampBeats, curve)
    }

    volume(value: number, rampBeats?: number): MelodyBuilder {
        return this.commit().volume(value, rampBeats)
    }

    pan(value: number, rampBeats?: number): MelodyBuilder {
        return this.commit().pan(value, rampBeats)
    }

    tempoEnvelope(keyframes: TempoKeyframe[]): MelodyBuilder {
        return this.commit().tempoEnvelope(keyframes)
    }
}
