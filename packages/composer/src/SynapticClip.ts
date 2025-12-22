// =============================================================================
// SymphonyScript - SynapticClipBuilder (Phase 2: Composer Package)
// =============================================================================
// Fluent DSL for musical composition - base class.
//
// CONSTRAINTS:
// - Strict typing (no any)
// - Fluent chaining (all methods return this)
// - Support both MIDI numbers and string notation

import { SynapticNode } from '../../synaptic/src/SynapticNode'
import type { SiliconBridge } from '@symphonyscript/core/linker'

/**
 * Parse pitch input to MIDI number.
 * 
 * Supports:
 * - MIDI numbers: 60 → 60
 * - String notation: 'C4' → 60, 'D#4' → 63, 'Bb3' → 58
 * 
 * @param input - MIDI number or string notation (e.g., 'C4', 'D#4', 'Bb3')
 * @returns MIDI note number (0-127)
 */
export function parsePitch(input: string | number): number {
    // If already a number, return it
    if (typeof input === 'number') {
        return input
    }

    // Parse string notation: 'C4', 'D#4', 'Bb3', etc.
    const match = input.match(/^([A-G])([#b]?)(-?\d+)$/)
    if (!match) {
        throw new Error(`Invalid pitch notation: ${input}`)
    }

    const [, note, accidental, octaveStr] = match
    const octave = parseInt(octaveStr, 10)

    // Base notes (C=0, D=2, E=4, F=5, G=7, A=9, B=11)
    const noteMap: Record<string, number> = {
        'C': 0,
        'D': 2,
        'E': 4,
        'F': 5,
        'G': 7,
        'A': 9,
        'B': 11
    }

    let midiNote = noteMap[note]

    // Apply accidental
    if (accidental === '#') {
        midiNote += 1
    } else if (accidental === 'b') {
        midiNote -= 1
    }

    // Calculate MIDI number: C4 = 60 (octave 4 starts at 60)
    const midiNumber = (octave + 1) * 12 + midiNote

    // Clamp to valid MIDI range (0-127)
    return Math.max(0, Math.min(127, midiNumber))
}

/**
 * SynapticClip - Fluent DSL for building musical clips.
 * 
 * Provides ergonomic, chainable API for composing music.
 * All methods return `this` for fluent chaining.
 */
export class SynapticClip {
    private builder: SynapticNode
    private currentTick: number = 0
    private defaultDuration: number = 480  // Quarter note (assuming 480 PPQ)
    private defaultVelocity: number = 100

    /**
     * Create a new SynapticClip.
     * 
     * @param bridge - SiliconBridge instance from @symphonyscript/core
     */
    constructor(bridge: SiliconBridge) {
        this.builder = new SynapticNode(bridge)
    }

    /**
     * Add a note to the clip.
     * 
     * Supports both MIDI numbers (60) and string notation ('C4').
     * Advances currentTick by the note duration.
     * 
     * @param pitch - MIDI number (60) or string notation ('C4', 'D#4', etc.)
     * @param duration - Duration in ticks (default: defaultDuration = 480)
     * @param velocity - MIDI velocity 0-127 (default: defaultVelocity = 100)
     * @returns this for fluent chaining
     */
    note(pitch: string | number, duration?: number, velocity?: number): this {
        const midiPitch = parsePitch(pitch)
        const noteDuration = duration ?? this.defaultDuration
        const noteVelocity = velocity ?? this.defaultVelocity

        this.builder.addNote(
            midiPitch,
            noteVelocity,
            noteDuration,
            this.currentTick
        )

        this.currentTick += noteDuration
        return this
    }

    /**
     * Add a rest (silence) to the clip.
     * 
     * Advances currentTick without adding a note.
     * 
     * @param duration - Duration in ticks (default: defaultDuration = 480)
     * @returns this for fluent chaining
     */
    rest(duration?: number): this {
        const restDuration = duration ?? this.defaultDuration
        this.currentTick += restDuration
        return this
    }

    /**
     * Create a synaptic connection to another clip.
     * 
     * Links this clip's exit to the target clip's entry.
     * 
     * @param target - Target SynapticClipBuilder to link to
     * @param weight - Synapse weight 0-1000 (default: 500)
     * @param jitter - Timing jitter 0-65535 (default: 0)
     * @returns this for fluent chaining
     */
    play(target: SynapticClip, weight?: number, jitter?: number): this {
        this.builder.linkTo(target.getNode(), weight, jitter)
        return this
    }

    /**
     * Get the underlying SynapticNode instance.
     * 
     * @returns The wrapped SynapticNode
     */
    getNode(): SynapticNode {
        return this.builder
    }

    /**
     * Get the current tick position.
     * 
     * @returns Current tick value
     */
    getCurrentTick(): number {
        return this.currentTick
    }
}
