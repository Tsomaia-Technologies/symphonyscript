import { SynapticMelodyBaseCursor } from './SynapticMelodyBaseCursor';
import { SynapticChordCursor } from './SynapticChordCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';
import { parsePitch } from '../utils/pitch';

export class SynapticMelodyNoteCursor extends SynapticMelodyBaseCursor {
    protected pitch: number = 60;
    private chordCursor: SynapticChordCursor;

    constructor(
        clip: SynapticClip,
        bridge: SiliconBridge,
        chordCursor: SynapticChordCursor
    ) {
        super(clip, bridge);
        this.chordCursor = chordCursor;
    }

    /**
     * Modifiers (Phase 4)
     */
    natural(): this {
        // Reset accidentals (no-op for now, could reset detune)
        this._detune = 0;
        return this;
    }

    sharp(): this { this.pitch += 1; return this; }
    flat(): this { this.pitch -= 1; return this; }

    /**
     * Relay: Note
     */
    note(input: string | number, duration?: number): this {
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }

        this.bind(this.clip.getCurrentTick());

        this.pitch = parsePitch(input);
        if (duration !== undefined) {
            this._duration = duration;
        }
        this.hasPending = true;
        return this;
    }

    /**
     * Relay: Chord (Switches to ChordCursor)
     */
    chord(symbol: string): SynapticChordCursor {
        // 1. Commit pending melody note
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }

        // ...
        const t = this.clip.getCurrentTick();
        this.chordCursor.bind(t);

        // 3. Delegate configuration and return chord cursor
        return this.chordCursor.chord(symbol);
    }

    /**
     * Relay: Degree (Scale-based note)
     * Currently hardcoded to C major scale. Full scale resolution will require
     * scale context from this.clip.currentScale (tracked in SynapticClip state).
     */
    degree(deg: number, duration?: number): this {
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }
        this.bind(this.clip.getCurrentTick());

        // Hardcoded C major scale (limitation: does not use this.clip.currentScale)
        const majorScale = [0, 2, 4, 5, 7, 9, 11]; // Intervals
        const octave = Math.floor(deg / 7);
        const scaleDegree = deg % 7;
        this.pitch = 60 + (octave * 12) + majorScale[scaleDegree];

        if (duration !== undefined) this._duration = duration;
        this.hasPending = true;
        return this;
    }

    // ========================
    // Escapes (Commit & Return Clip)
    // ========================

    transpose(semitones: number): SynapticClip {
        this.commit();
        return this.clip.transpose(semitones);
    }

    scale(scaleName: string): SynapticClip {
        this.commit();
        return this.clip.scale(scaleName);
    }

    arpeggio(pattern: string): SynapticClip {
        this.commit();
        return this.clip.arpeggio(pattern);
    }

    vibrato(rate: number, depth: number): SynapticClip {
        this.commit();
        return this.clip.vibrato(rate, depth);
    }

    /**
     * Flushes the current note to the clip mediator.
     * RFC-050: Delegates to clip.flushNote() for transformation application.
     */
    flush(): void {
        if (!this.hasPending) return;

        const sourceId = this.clip.generateSourceId();

        this.clip.flushNote(
            this.pitch,
            this._velocity,
            this._duration,
            this.baseTick,
            this.muted,
            sourceId,
            this.expressionId
        );

        this.hasPending = false;
    }
}
