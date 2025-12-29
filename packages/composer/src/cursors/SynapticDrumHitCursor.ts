import { SynapticCursor } from './SynapticCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';

/**
 * SynapticDrumHitCursor
 * RFC-049 Section 4.6
 * Specialized for unpitched percussive events.
 */
export class SynapticDrumHitCursor extends SynapticCursor {
    // State
    protected drumPitch: number = 36; // Default kick drum (C1)
    protected isFlam: boolean = false;
    protected isDrag: boolean = false;

    constructor(clip: SynapticClip, bridge: SiliconBridge) {
        super(clip, bridge);
    }

    // ========================
    // Modifiers
    // ========================

    ghost(): this {
        this._velocity = 0.3; // Ghost note = low velocity
        return this;
    }

    flam(): this {
        this.isFlam = true;
        return this;
    }

    drag(): this {
        this.isDrag = true;
        return this;
    }

    // ========================
    // Relays (Hit Types)
    // ========================

    hit(pitch: number, duration?: number): this {
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }

        this.bind(this.clip.getCurrentTick());
        this.drumPitch = pitch;
        if (duration !== undefined) {
            this._duration = duration;
        }
        this.hasPending = true;
        return this;
    }

    kick(duration?: number): this {
        return this.hit(36, duration); // C1
    }

    snare(duration?: number): this {
        return this.hit(38, duration); // D1
    }

    hat(duration?: number): this {
        return this.hit(42, duration); // F#1 (closed hi-hat)
    }

    clap(duration?: number): this {
        return this.hit(39, duration); // D#1
    }

    /**
     * Flushes the drum hit to the clip mediator with articulations.
     * RFC-050: Delegates all insertions to clip.flushNote().
     */
    flush(): void {
        if (!this.hasPending) return;

        const sourceId = this.clip.generateSourceId();

        // Flam: Two hits with slight delay (grace note + main hit)
        if (this.isFlam) {
            // Grace note: Lower velocity, slightly before main hit
            const graceVel = this._velocity * 0.7;
            const graceOffset = -0.03; // 30ms before main hit

            this.clip.flushNote(
                this.drumPitch,
                graceVel,
                this._duration * 0.5, // Shorter grace note
                this.baseTick + graceOffset,
                this.muted,
                this.clip.generateSourceId(),
                undefined
            );

            // Main hit
            this.clip.flushNote(
                this.drumPitch,
                this._velocity,
                this._duration,
                this.baseTick,
                this.muted,
                sourceId,
                undefined
            );
        }
        // Drag: Multiple rapid grace notes before main hit (buzz roll effect)
        else if (this.isDrag) {
            const graceVel = this._velocity * 0.6;
            const dragCount = 3; // Three grace notes
            const dragInterval = 0.02; // 20ms apart

            for (let i = 0; i < dragCount; i++) {
                const offset = -(dragCount - i) * dragInterval;
                this.clip.flushNote(
                    this.drumPitch,
                    graceVel,
                    this._duration * 0.3,
                    this.baseTick + offset,
                    this.muted,
                    this.clip.generateSourceId(),
                    undefined
                );
            }

            // Main hit
            this.clip.flushNote(
                this.drumPitch,
                this._velocity,
                this._duration,
                this.baseTick,
                this.muted,
                sourceId,
                undefined
            );
        }
        // Standard hit (no articulation)
        else {
            this.clip.flushNote(
                this.drumPitch,
                this._velocity,
                this._duration,
                this.baseTick,
                this.muted,
                sourceId,
                undefined
            );
        }

        this.hasPending = false;
        this.isFlam = false;
        this.isDrag = false;
    }
}
