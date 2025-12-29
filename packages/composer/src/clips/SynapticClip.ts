import { SiliconBridge, OPCODE } from '@symphonyscript/kernel';
import { SeededRandom } from '@symphonyscript/core';

export abstract class SynapticClip {
    // Escape state (persisted user intent)
    protected transposeOffset: number = 0;
    protected currentScale: string | null = null;
    protected arpeggioPattern: string | null = null;
    protected vibratoRate: number = 0;
    protected vibratoDepth: number = 0;
    protected currentTempo: number = 120; // Default BPM
    protected timeSignatureNumerator: number = 4;
    protected timeSignatureDenominator: number = 4;
    protected swingAmount: number = 0.5;
    protected currentGroove: string | null = null;
    protected ccAutomation: Map<number, number>;
    protected stackingEnabled: boolean = false;
    protected loopEnabled: boolean = false;
    protected loopStart: number = 0;
    protected loopEnd: number = 0;

    // RFC-050: Seeded RNG for deterministic humanization
    protected humanizeRng: SeededRandom;

    constructor(protected bridge: SiliconBridge, seed: number = 0) {
        this.ccAutomation = new Map();
        this.humanizeRng = new SeededRandom(seed);
    }

    // Abstract methods that the real implementation will provide
    abstract getCurrentTick(): number;
    abstract advanceTick(ticks: number): void;
    abstract generateSourceId(): number;

    // Escape implementations (store state)
    rest(duration?: number): this {
        if (duration) this.advanceTick(duration);
        return this;
    }

    tempo(bpm: number): this {
        this.currentTempo = bpm;
        return this;
    }

    timeSignature(numerator: number, denominator: number): this {
        this.timeSignatureNumerator = numerator;
        this.timeSignatureDenominator = denominator;
        return this;
    }

    swing(val: number): this {
        this.swingAmount = val;
        return this;
    }

    groove(name: string): this {
        // Store groove template name for future application
        // (Groove templates would be resolved from a GrooveLibrary)
        this.currentGroove = name;
        return this;
    }

    control(cc: number, val: number): this {
        this.ccAutomation.set(cc, val);
        return this;
    }

    stack(): this {
        // Enable polyphonic stacking mode (multiple notes at same tick)
        this.stackingEnabled = true;
        return this;
    }

    loop(start: number, end: number): this {
        // Store loop region boundaries
        this.loopStart = start;
        this.loopEnd = end;
        this.loopEnabled = true;
        return this;
    }

    // Melodic escape methods (fluent)
    transpose(semitones: number): this {
        this.transposeOffset = semitones;
        return this;
    }

    scale(scaleName: string): this {
        this.currentScale = scaleName;
        return this;
    }

    arpeggio(pattern: string): this {
        this.arpeggioPattern = pattern;
        return this;
    }

    vibrato(rate: number, depth: number): this {
        this.vibratoRate = rate;
        this.vibratoDepth = depth;
        return this;
    }

    // =========================================================================
    // RFC-050: Clip-Mediated Flush Architecture
    // =========================================================================

    /**
     * Flush a single note to kernel with all escape transformations applied.
     * @remarks This is the ONLY method that may call bridge.insertAsync()
     */
    flushNote(
        pitch: number,
        velocity: number,      // Normalized 0-1
        duration: number,
        tick: number,
        muted: boolean,
        sourceId: number,
        expressionId?: number
    ): void {
        // 1. Apply transpose
        const finalPitch = pitch + this.transposeOffset;

        // 2. Apply humanization (velocity micro-variations)
        const humanizedVel = this.applyHumanization(velocity);

        // 3. Apply swing/groove timing
        const swingTick = this.applySwing(tick);

        // 4. Insert CC automation if pending (stubbed)
        // this.flushCCAutomation(swingTick);

        // 5. Final kernel insertion
        const finalVel = Math.floor(humanizedVel * 127);
        this.bridge.insertAsync(
            OPCODE.NOTE,
            finalPitch,
            finalVel,
            duration,
            swingTick,
            muted,
            sourceId,
            undefined,
            expressionId
        );
    }

    /**
     * Apply swing timing transformation.
     * Derives ticksPerBeat from time signature.
     */
    protected applySwing(tick: number): number {
        // Derive from time signature (4/4 → 1.0 beat, 3/4 → 0.75 beat)
        const ticksPerBeat = 4.0 / this.timeSignatureDenominator;
        const beatPhase = tick % ticksPerBeat;

        if (beatPhase > ticksPerBeat / 2) {
            // Off-beat: delay by swing amount
            return tick + (this.swingAmount - 0.5) * 0.1;
        }
        return tick;
    }

    /**
     * Apply velocity humanization using seeded PRNG.
     */
    protected applyHumanization(velocity: number): number {
        const variation = (this.humanizeRng.next() - 0.5) * 0.05; // ±2.5%
        return Math.max(0, Math.min(1, velocity + variation));
    }

    /**
     * Flush CC automation points to kernel.
     * @remarks Currently stubbed pending AudioWorklet CC handler verification.
     */
    protected flushCCAutomation(tick: number): void {
        if (this.ccAutomation.size === 0) return;

        // TEMPORARY STUB: Verify AudioWorklet CC handler before enabling
        // for (const [cc, value] of this.ccAutomation) {
        //     this.bridge.insertAsync(
        //         OPCODE.CC,
        //         cc,
        //         value,
        //         0,
        //         tick,
        //         false,
        //         this.generateSourceId(),
        //         undefined,
        //         undefined
        //     );
        // }
        // this.ccAutomation.clear();
    }
}
