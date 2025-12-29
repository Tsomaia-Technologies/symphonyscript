import { SiliconBridge } from '@symphonyscript/kernel';
import { SynapticClip } from '../clips/SynapticClip';

/**
 * Base SynapticCursor
 * RFC-049 Phase 1
 */
export abstract class SynapticCursor {
    // State
    public hasPending: boolean = false;
    public baseTick: number = 0;
    protected _velocity: number = 0.8;
    protected _duration: number = 0.25; // Default 1/4 note
    public muted: boolean = false;
    protected humanizeAmount: number = 0; // 0 = precise, 1 = fully humanized

    constructor(
        protected clip: SynapticClip,
        protected bridge: SiliconBridge
    ) { }

    /**
     * Rebinds the cursor to a new start time.
     * Called by the builder before configuring a new note.
     */
    bind(tick: number): this {
        this.baseTick = tick;
        return this;
    }

    /**
     * Flushes the pending state to the kernel.
     * MUST use zero-allocation logic (while loops, bitwise ops).
     */
    abstract flush(): void;

    // ==========================================
    // Modifiers (Fluently return this)
    // ==========================================

    velocity(val: number): this {
        this._velocity = val;
        return this;
    }

    duration(val: number): this {
        this._duration = val;
        return this;
    }

    staccato(): this {
        this._duration = 0.1; // Example stub logic
        return this;
    }

    legato(): this {
        this._duration = 1.0;
        return this;
    }

    accent(): this {
        this._velocity = Math.min(1.0, this._velocity + 0.2);
        return this;
    }

    tenuto(): this {
        this._duration = 1.0;
        this._velocity = Math.min(1.0, this._velocity + 0.1);
        return this;
    }

    marcato(): this {
        this._duration = 0.5;
        this._velocity = 1.0;
        return this;
    }

    humanize(amount: number = 0.1): this {
        // Apply subtle randomization to timing and velocity
        // amount controls the degree of humanization (0.0-1.0)
        this.humanizeAmount = Math.max(0, Math.min(1, amount));
        return this;
    }

    precise(): this {
        // Disable humanization for mechanical precision
        this.humanizeAmount = 0;
        return this;
    }

    // ==========================================
    // Escapes (Commit & Return Clip)
    // ==========================================

    commit(): SynapticClip {
        if (this.hasPending) {
            this.flush();
        }
        return this.clip;
    }

    rest(duration?: number): SynapticClip {
        this.commit();
        return this.clip.rest(duration);
    }

    tempo(bpm: number): SynapticClip {
        this.commit();
        return this.clip.tempo(bpm);
    }

    timeSignature(num: number, den: number): SynapticClip {
        this.commit();
        return this.clip.timeSignature(num, den);
    }

    swing(val: number): SynapticClip {
        this.commit();
        return this.clip.swing(val);
    }

    groove(name: string): SynapticClip {
        this.commit();
        return this.clip.groove(name);
    }

    control(cc: number, val: number): SynapticClip {
        this.commit();
        return this.clip.control(cc, val);
    }

    stack(): SynapticClip {
        this.commit();
        return this.clip.stack();
    }

    loop(start: number, end: number): SynapticClip {
        this.commit();
        return this.clip.loop(start, end);
    }
}
