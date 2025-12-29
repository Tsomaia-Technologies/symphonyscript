import { SynapticClip } from './SynapticClip';
import { SynapticDrumHitCursor } from '../cursors/SynapticDrumHitCursor';
import { SiliconBridge } from '@symphonyscript/kernel';

/**
 * SynapticDrums
 * RFC-049 Section 5.1
 * Builder for drum sequences.
 */
export class SynapticDrums extends SynapticClip {
    private cursor: SynapticDrumHitCursor;
    private currentTick: number = 0;
    private sourceIdCounter: number = 0;

    constructor(bridge: SiliconBridge) {
        super(bridge);
        this.cursor = new SynapticDrumHitCursor(this, bridge);
    }

    //========================
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
    // Drum API Entry Points
    // ========================

    kick(duration?: number): SynapticDrumHitCursor {
        return this.cursor.kick(duration);
    }

    snare(duration?: number): SynapticDrumHitCursor {
        return this.cursor.snare(duration);
    }

    hat(duration?: number): SynapticDrumHitCursor {
        return this.cursor.hat(duration);
    }

    clap(duration?: number): SynapticDrumHitCursor {
        return this.cursor.clap(duration);
    }

    hit(pitch: number, duration?: number): SynapticDrumHitCursor {
        return this.cursor.hit(pitch, duration);
    }

    // Note: All escape methods (tempo, swing, etc.) are inherited from SynapticClip.
    // No empty overrides. SynapticClip base implementation handles state storage.
}
