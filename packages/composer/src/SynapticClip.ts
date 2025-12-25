// =============================================================================
// SymphonyScript - SynapticClipBuilder (Phase 2: Composer Package)
// =============================================================================
// Fluent DSL for musical composition - base class.
//
// CONSTRAINTS:
// - Strict typing (no any)
// - Fluent chaining (all methods return this)
// - Support both MIDI numbers and string notation

import type { SiliconBridge } from '@symphonyscript/kernel'
import { SynapticNode, VoiceAllocator } from '@symphonyscript/synaptic'
import type { HarmonyMask } from '@symphonyscript/theory'

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
    private bridge: SiliconBridge
    private currentTick: number = 0
    private defaultDuration: number = 480  // Quarter note (assuming 480 PPQ)
    private defaultVelocity: number = 100
    private pendingShift: number = 0  // RFC-047 Phase 2: Micro-timing offset
    private currentExpressionId: number = 0  // RFC-047 Phase 2: MPE routing

    /**
     * Create a new SynapticClip.
     * 
     * @param bridge - SiliconBridge instance from @symphonyscript/core
     */
    constructor(bridge: SiliconBridge) {
        this.bridge = bridge
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

        // RFC-047 Phase 2: Apply pending shift to baseTick
        const actualTick = this.currentTick + this.pendingShift

        this.builder.addNote(
            midiPitch,
            noteVelocity,
            noteDuration,
            actualTick  // Use offset tick
        )

        this.currentTick += noteDuration  // Cursor advances by duration (not affected by shift)
        this.pendingShift = 0  // Reset shift (one-shot behavior)
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

    /**
     * Stack (branch) independent voices for counterpoint.
     * 
     * Creates PARALLEL execution: voices start at the SAME tick.
     * Per RFC-047 Section 3.2 "Model B: The Stack Graph".
     * 
     * @param voiceBuilder - Callback that receives a new SynapticClip for the voice
     * @returns this for fluent chaining
     * 
     * @example
     * const melody = Clip.clip('Counterpoint');
     * 
     * melody
     *   .note('C4', 480)  // Main voice @ tick 0
     *   .stack((voice) => {
     *     voice.note('E4', 480);  // Voice 1 @ tick 480 (parallel)
     *   })
     *   .note('D4', 480);  // Main voice @ tick 480
     * 
     * // Result: At tick 480, BOTH 'E4' and 'D4' play simultaneously
     */
    stack(voiceBuilder: (voice: SynapticClip) => void): this {
        const startTick = this.currentTick  // Capture current position

        // Create new clip that runs IN PARALLEL
        const voiceClip = new SynapticClip(this.bridge)

        // CRITICAL: Set voice's cursor to SAME tick as main voice
        voiceClip.currentTick = startTick

        // Execute user callback
        voiceBuilder(voiceClip)

        // DO NOT link voiceClip.play(this) - that would create sequential execution
        // Voice runs independently at the same time

        return this
    }

    /**
     * Tag voice with expression ID for MPE routing.
     * 
     * Executes builder callback and tags all notes with expressionId.
     * Per RFC-047 brainstorming session requirements.
     * 
     * @param expressionId - MPE expression ID (channel assignment)
     * @param builderFn - Callback to build notes for this voice
     * @returns this for fluent chaining
     * 
     * @example
     * clip.stack(s => s
     *   .voice(1, v => v.note('C4'))  // MPE Channel 1
     *   .voice(2, v => v.note('E4'))  // MPE Channel 2
     * );
     */
    voice(expressionId: number, builderFn: (v: SynapticClip) => void): this {
        // Store current expressionId (for tagging)
        const previousExpressionId = this.currentExpressionId
        this.currentExpressionId = expressionId

        // Execute builder (all notes inside get tagged)
        builderFn(this)

        // Restore previous ID
        this.currentExpressionId = previousExpressionId

        return this
    }

    /**
     * Shift the next note's start time (micro-timing).
     * 
     * Unlike rest(), shift() does NOT advance the cursor.
     * It offsets the next event's baseTick for humanization/groove.
     * 
     * @param ticks - Offset in ticks (can be negative)
     * @returns this for fluent chaining
     * 
     * @example
     * clip
     *   .note('C4', 480)
     *   .shift(20)           // Next note starts 20 ticks late
     *   .note('D4', 480);    // Slightly delayed for swing
     */
    shift(ticks: number): this {
        this.pendingShift = ticks  // Store offset (one-shot)
        return this
    }

    /**
     * Play a theoretical harmony mask with polyphonic MPE voice allocation.
     * 
     * Uses pure integer arithmetic and bitwise masks from @symphonyscript/theory.
     * ZERO ALLOCATION per call.
     * 
     * @param mask - 24-bit HarmonyMask integer
     * @param root - MIDI root pitch
     * @param duration - Duration in ticks (optional)
     * @returns this for fluent chaining
     */
    harmony(mask: number, root: number, duration?: number): this {
        const noteDuration = duration ?? this.defaultDuration
        const baseTick = this.currentTick + this.pendingShift

        // Use VoiceAllocator for polyphonic expansion
        // It handles mapping intervals -> pitches and assigning MPE channels
        VoiceAllocator.allocate(mask as unknown as HarmonyMask, root, (pitch, expressionId) => {
            // Set explicit expression ID for this voice
            this.builder.setExpressionId(expressionId)

            this.builder.addNote(
                pitch,
                this.defaultVelocity,
                noteDuration,
                baseTick
            )
        })

        // Restore context expression ID
        this.builder.setExpressionId(this.currentExpressionId)

        this.currentTick += noteDuration
        this.pendingShift = 0  // One-shot
        return this
    }

    /**
     * Set the phase-locking cycle length for this clip.
     * 
     * @param ticks - Loop length in ticks. Use Infinity for linear time.
     * @returns this for fluent chaining
     */
    cycle(ticks: number): this {
        this.builder.setCycle(ticks)
        return this
    }
}
