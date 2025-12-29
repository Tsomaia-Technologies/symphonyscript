import { SynapticClip } from './SynapticClip';
import { SynapticMelodyNoteCursor } from '../cursors/SynapticMelodyNoteCursor';
import { SynapticChordCursor } from '../cursors/SynapticChordCursor';
import { SiliconBridge } from '@symphonyscript/kernel';

/**
 * SynapticMelody
 * RFC-049 Section 5.1
 * Refreshed melody builder with cursor architecture.
 */
export class SynapticMelody extends SynapticClip {
    private noteCursor: SynapticMelodyNoteCursor;
    private chordCursor: SynapticChordCursor;
    private currentTick: number = 0;
    private sourceIdCounter: number = 0;

    constructor(bridge: SiliconBridge) {
        super(bridge);
        this.chordCursor = new SynapticChordCursor(this, bridge);
        this.noteCursor = new SynapticMelodyNoteCursor(this, bridge, this.chordCursor);
    }

    // ========================
    // SynapticClip Implementation
    // ========================

    getCurrentTick(): number {
        return this.currentTick;
    }

    advanceTick(duration: number): void {
        this.currentTick += duration;
    }

    generateSourceId(): number {
        return this.sourceIdCounter++;
    }

    // ========================
    // Melody API Entry Points
    // ========================

    note(input: string | number, duration?: number): SynapticMelodyNoteCursor {
        return this.noteCursor.note(input, duration);
    }

    degree(deg: number, duration?: number): SynapticMelodyNoteCursor {
        return this.noteCursor.degree(deg, duration);
    }

    chord(symbol: string): SynapticChordCursor {
        return this.noteCursor.chord(symbol);
    }

    // Note: All escape methods (tempo, swing, transpose, etc.) are inherited from SynapticClip.
    // No empty overrides. SynapticClip base implementation handles state storage.
}
