import { SynapticMelodyBaseCursor } from './SynapticMelodyBaseCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';
import { parseChord } from '../utils/chord';

// OPCODE 1 = NOTE
const OPCODE_NOTE = 1;

/**
 * SynapticChordCursor - Phase 5
 * Zero-allocation, bit-mask based chord handling.
 */
export class SynapticChordCursor extends SynapticMelodyBaseCursor {
    // Config
    private readonly maxVoices: number;

    // Memory (Fixed Arrays)
    private readonly pitches: Int32Array;
    private readonly sourceIds: Int32Array;

    // State
    private chordMask: number = 0;
    private chordRoot: number = 60; // Default C4

    constructor(clip: SynapticClip, bridge: SiliconBridge, maxVoices: number = 8) {
        super(clip, bridge);
        this.maxVoices = maxVoices;
        // Pre-allocate arrays once conforming to RFC-049 zero-alloc rules
        this.pitches = new Int32Array(maxVoices);
        this.sourceIds = new Int32Array(maxVoices);
    }

    /**
     * Relay: Configures a chord from symbol.
     * Example: .chord('Cmaj7')
     */
    chord(symbol: string): this {
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }

        this.bind(this.clip.getCurrentTick());

        // Parse
        const { root, mask } = parseChord(symbol);
        this.chordRoot = root;
        this.chordMask = mask;

        this.hasPending = true;
        return this;
    }

    /**
     * Relay: Harmony via raw mask.
     */
    harmony(mask: number, root?: number): this {
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }
        this.bind(this.clip.getCurrentTick());

        this.chordMask = mask;
        if (root !== undefined) this.chordRoot = root;

        this.hasPending = true;
        return this;
    }

    /**
     * Modifier: Inversion via bitwise rotation.
     * Wraps notes that exceed 24 semitone range? 
     * Simple logic: take bottom-most bit, move it +12.
     * Repeat 'steps' times.
     */
    inversion(steps: number): this {
        if (!this.hasPending || this.chordMask === 0) return this;

        for (let s = 0; s < steps; s++) {
            // Find lowest set bit
            // mask & -mask gets LSB (e.g. 0...0100)
            const lsb = this.chordMask & -this.chordMask;

            if (lsb === 0) break; // Empty mask

            // Clear LSB
            this.chordMask ^= lsb;

            // Determine interval value of LSB
            // Shift process: 1 << (interval + 12)
            const newBit = lsb << 12;
            this.chordMask |= newBit;
        }
        return this;
    }

    /**
     * Flushes the chord to kernel using inline bit iteration.
     * RFC-050: Delegates each voice to clip.flushNote() for transformation application.
     * STRICT ZERO-ALLOCATION. No closures.
     */
    flush(): void {
        if (!this.hasPending) return;

        let mask = this.chordMask;
        let voiceIndex = 0;

        // 1. Unpack mask to pitches array (Inline)
        let interval = 0;
        const root = this.chordRoot;

        while (mask !== 0 && voiceIndex < this.maxVoices) {
            if ((mask & 1) === 1) {
                // Found a note at this interval
                this.pitches[voiceIndex] = root + interval;
                voiceIndex++;
            }
            mask >>>= 1; // Unsigned right shift
            interval++;
        }

        // 2. Generate SourceIDs
        for (let i = 0; i < voiceIndex; i++) {
            this.sourceIds[i] = this.clip.generateSourceId();
        }

        // 3. Flush each voice via clip mediator
        for (let i = 0; i < voiceIndex; i++) {
            this.clip.flushNote(
                this.pitches[i],
                this._velocity,
                this._duration,
                this.baseTick,
                this.muted,
                this.sourceIds[i],
                this.expressionId
            );
        }

        this.hasPending = false;
    }
}
