/**
 * SynapticNoteCursor - Reusable note parameter container.
 * 
 * Zero-allocation pattern: instantiate once, reuse via set() method.
 * Holds all note parameters for passing to SynapticNode.addNote().
 * 
 * RFC-047 Phase 9 Task 3: Note builder cursor abstraction.
 */
export class SynapticNoteCursor {
    /** MIDI pitch (0-127) */
    pitch: number = 60

    /** MIDI velocity (0-127) */
    velocity: number = 100

    /** Duration in ticks */
    duration: number = 480

    /** Base tick position (after all offsets applied) */
    baseTick: number = 0

    /** Mute state */
    muted: boolean = false

    /**
     * Set all note parameters at once.
     * 
     * @param pitch - MIDI pitch (0-127)
     * @param velocity - MIDI velocity (0-127)
     * @param duration - Duration in ticks
     * @param baseTick - Start tick position
     * @param muted - Mute state (default: false)
     * @returns this for fluent chaining
     */
    set(
        pitch: number,
        velocity: number,
        duration: number,
        baseTick: number,
        muted: boolean = false
    ): this {
        this.pitch = pitch
        this.velocity = velocity
        this.duration = duration
        this.baseTick = baseTick
        this.muted = muted
        return this
    }

    /**
     * Reset cursor to default values.
     * 
     * @returns this for fluent chaining
     */
    reset(): this {
        this.pitch = 60
        this.velocity = 100
        this.duration = 480
        this.baseTick = 0
        this.muted = false
        return this
    }
}
