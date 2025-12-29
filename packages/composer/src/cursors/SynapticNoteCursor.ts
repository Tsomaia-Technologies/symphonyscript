import { SynapticCursor } from './SynapticCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';
import { parsePitch } from '../utils/pitch';

export class SynapticNoteCursor extends SynapticCursor {
    protected pitch: number = 60; // Middle C default

    constructor(clip: SynapticClip, bridge: SiliconBridge) {
        super(clip, bridge);
    }

    /**
     * Relay: Commits previous note (sequential) and starts new one.
     * @param input Pitch (string or midi number)
     * @param duration Optional duration in ticks
     */
    note(input: string | number, duration?: number): this {
        // 1. Commit previous if pending (Sequential flow)
        if (this.hasPending) {
            this.flush();
            this.clip.advanceTick(this._duration);
        }

        // 2. Bind to current timeline
        this.bind(this.clip.getCurrentTick());

        // 3. Configure state
        this.pitch = parsePitch(input);
        if (duration !== undefined) {
            this._duration = duration;
        }

        // 4. Mark pending
        this.hasPending = true;

        return this;
    }

    /**
     * Flushes the current single note to the clip mediator.
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
            undefined // expressionId
        );

        this.hasPending = false;
    }
}
