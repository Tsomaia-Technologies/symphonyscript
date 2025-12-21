// =============================================================================
// SymphonyScript - SynapticMelodyBuilder (Phase 2: Composer Package)
// =============================================================================
// Extended DSL with musical theory features (scales, degrees, chords).

import { SynapticClipBuilder } from './SynapticClipBuilder'
import type { SiliconBridge } from '@symphonyscript/core/linker'

/**
 * SynapticMelodyBuilder - Extended DSL with musical theory features.
 * 
 * Adds scale-based composition with degrees and chords.
 * Extends SynapticClipBuilder with additional musical intelligence.
 */
export class SynapticMelodyBuilder extends SynapticClipBuilder {
    private currentOctave: number = 4
    private currentKey: string = 'C'
    private currentScale: number[] = [0, 2, 4, 5, 7, 9, 11]  // Major scale intervals

    /**
     * Create a new SynapticMelodyBuilder.
     * 
     * @param bridge - SiliconBridge instance from @symphonyscript/core
     */
    constructor(bridge: SiliconBridge) {
        super(bridge)
    }

    /**
     * Add a note using scale degree notation.
     * 
     * Converts scale degree (1-7) to MIDI pitch based on current key,
     * scale, and octave. Degree 1 = tonic, 3 = third, 5 = fifth, etc.
     * 
     * @param degree - Scale degree (1-7, or higher for extended octaves)
     * @param duration - Duration in ticks (default: 480)
     * @param velocity - MIDI velocity 0-127 (default: 100)
     * @returns this for fluent chaining
     */
    degree(degree: number, duration?: number, velocity?: number): this {
        // Convert degree to MIDI pitch
        const midiPitch = this.degreeToMidi(degree)

        // Use parent note() method
        return this.note(midiPitch, duration, velocity)
    }

    /**
     * Add a chord using scale degree notation.
     * 
     * Adds multiple notes simultaneously (same baseTick) based on
     * scale degrees. For example, chord([1, 3, 5]) creates a major triad.
     * 
     * @param degrees - Array of scale degrees
     * @param duration - Duration in ticks (default: 480)
     * @param velocity - MIDI velocity 0-127 (default: 100)
     * @returns this for fluent chaining
     */
    chord(degrees: number[], duration?: number, velocity?: number): this {
        const noteDuration = duration ?? 480
        const noteVelocity = velocity ?? 100

        // Get current tick before adding notes
        const chordTick = this.getCurrentTick()

        // Add all notes at the same tick
        for (let i = 0; i < degrees.length; i++) {
            const degree = degrees[i]
            const midiPitch = this.degreeToMidi(degree)

            // Add note directly via builder (not using note() to avoid advancing tick)
            this.getBuilder().addNote(
                midiPitch,
                noteVelocity,
                noteDuration,
                chordTick
            )
        }

        // Advance tick only once after all chord notes
        this['currentTick'] += noteDuration

        return this
    }

    /**
     * Set the current octave for degree-based composition.
     * 
     * @param octave - MIDI octave number (typically 3-5)
     * @returns this for fluent chaining
     */
    octave(octave: number): this {
        this.currentOctave = octave
        return this
    }

    /**
     * Set the current key for degree-based composition.
     * 
     * @param key - Key note name ('C', 'D', 'E', etc.)
     * @returns this for fluent chaining
     */
    key(key: string): this {
        this.currentKey = key
        return this
    }

    /**
     * Set the current scale intervals.
     * 
     * @param scale - Array of semitone intervals from root (e.g., [0, 2, 4, 5, 7, 9, 11] for major)
     * @returns this for fluent chaining
     */
    scale(scale: number[]): this {
        this.currentScale = scale
        return this
    }

    /**
     * Convert scale degree to MIDI pitch number.
     * 
     * @param degree - Scale degree (1-based, can exceed scale length for higher octaves)
     * @returns MIDI pitch number
     */
    private degreeToMidi(degree: number): number {
        // Map key to MIDI note number (C=0, D=2, E=4, etc.)
        const keyMap: Record<string, number> = {
            'C': 0, 'D': 2, 'E': 4, 'F': 5,
            'G': 7, 'A': 9, 'B': 11
        }

        const keyOffset = keyMap[this.currentKey] ?? 0

        // Calculate octave offset for degrees beyond the scale
        // degree 1 = index 0, degree 8 = index 0 (next octave)
        const scaleIndex = ((degree - 1) % this.currentScale.length)
        const octaveOffset = Math.floor((degree - 1) / this.currentScale.length)

        const scaleNote = this.currentScale[scaleIndex]

        // Calculate final MIDI pitch
        // C4 = 60, so (octave + 1) * 12
        const baseMidi = (this.currentOctave + 1 + octaveOffset) * 12
        const midiPitch = baseMidi + keyOffset + scaleNote

        return Math.max(0, Math.min(127, midiPitch))
    }
}
