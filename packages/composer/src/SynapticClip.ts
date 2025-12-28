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
 * Hash a string voice name to a numeric expression ID.
 * Uses the EXACT SAME algorithm as kernel's hashString (silicon-bridge.ts:389-396).
 * 
 * NOTE: Result is masked to 4 bits (0-15) for MPE routing.
 * Different voice names may map to the same MPE channel due to hash collisions.
 * 
 * @param name - Voice name string
 * @returns Numeric expression ID (0-15)
 */
function hashVoiceName(name: string): number {
    let hash = 0
    let i = 0
    while (i < name.length) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
        i = i + 1
    }
    // Mask to 4 bits for MPE channel range (0-15)
    return (hash >>> 0) & 0xF
}

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

    // RFC-047 Phase 8 Task 2: Groove template state
    private grooveSwing: number = 0.5  // Default: no swing
    private grooveSteps: number = 4     // Default: 16th notes
    private grooveStepDuration: number = 120  // Pre-computed: 480 / 4
    private currentStepIndex: number = 0    // Track position within groove cycle

    // RFC-047 Phase 8 Task 3: Clip start delay
    private startDelay: number = 0  // Delay before first note in ticks

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
        // RFC-047 Phase 8 Task 3: Apply startDelay to all notes
        let actualTick = this.currentTick + this.pendingShift + this.startDelay

        // RFC-047 Phase 8 Task 2: Apply groove swing
        if (this.grooveSwing !== 0.5) {
            // Odd steps (1, 3, 5...) get swing offset
            const isOddStep = (this.currentStepIndex % 2) === 1
            if (isOddStep) {
                const swingOffset = (this.grooveSwing - 0.5) * this.grooveStepDuration
                actualTick = actualTick + swingOffset
            }
        }

        this.builder.addNote(
            midiPitch,
            noteVelocity,
            noteDuration,
            actualTick  // Use offset tick
        )

        this.currentTick += noteDuration  // Cursor advances by duration (not affected by shift)
        this.pendingShift = 0  // Reset shift (one-shot behavior)

        // RFC-047 Phase 8 Task 2: Advance groove step
        this.currentStepIndex = this.currentStepIndex + 1
        if (this.currentStepIndex >= this.grooveSteps) {
            this.currentStepIndex = 0  // Wrap around
        }

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
     * Apply a groove template to downstream notes.
     * 
     * Swing is applied to odd steps (1, 3, 5...) within the groove cycle.
     * Per RFC-047 Phase 8 Task 2 requirements.
     * 
     * @param groove - Frozen groove template from GrooveBuilder
     * @returns this for fluent chaining
     * 
     * @example
     * const mpc = Clip.groove().swing(0.55).steps(4).build();
     * clip.use(mpc).note('C4').note('D4');  // D4 will have swing offset
     */
    use(groove: Readonly<{ swing: number; steps: number }>): this {
        this.grooveSwing = groove.swing
        this.grooveSteps = groove.steps
        // Pre-compute step duration for zero-allocation
        // Assumes 480 PPQ, quarter note = 480 ticks
        this.grooveStepDuration = 480 / groove.steps
        this.currentStepIndex = 0
        return this
    }

    /**
     * Set clip start delay (all notes delayed by this amount).
     * 
     * Different from `.shift()` which is per-note and one-shot.
     * `.wait()` applies to ALL notes in the clip persistently.
     * 
     * @param duration - Delay in ticks before clip starts
     * @returns this for fluent chaining
     * 
     * @example
     * clip.wait(480).note('C4');  // Clip starts 480 ticks late
     */
    wait(duration: number): this {
        this.startDelay = duration
        return this
    }

    /**
     * Set playback offset for hardware latency compensation.
     * 
     * Writes latency compensation directly to SAB (global setting).
     * This affects playback timing in the AudioWorklet.
     * 
     * @param offsetMs - Hardware latency in milliseconds (typically 10-50ms)
     * @returns this for fluent chaining
     * 
     * @example
     * clip.playbackOffset(10);  // Compensate for 10ms output latency
     */
    playbackOffset(offsetMs: number): this {
        this.bridge.setPlaybackOffset(offsetMs)
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
     * @param expressionId - MPE expression ID (0-15) or string voice name (hashed to 0-15)
     * @param builderFn - Callback to build notes for this voice
     * @returns this for fluent chaining
     * 
     * @example
     * // Numeric ID
     * clip.stack(s => s
     *   .voice(1, v => v.note('C4'))  // MPE Channel 1
     *   .voice(2, v => v.note('E4'))  // MPE Channel 2
     * );
     * 
     * @example
     * // String name (hashed to consistent 4-bit ID)
     * clip.stack(s => s
     *   .voice('lead', v => v.note('C4'))   // Hashed to 0-15
     *   .voice('bass', v => v.note('C2'))   // Hashed to 0-15
     * );
     */
    voice(expressionId: string | number, builderFn: (v: SynapticClip) => void): this {
        // Resolve string to numeric ID via hashing
        const numericId = typeof expressionId === 'string'
            ? hashVoiceName(expressionId)
            : expressionId

        // Store current expressionId (for tagging)
        const previousExpressionId = this.currentExpressionId
        this.currentExpressionId = numericId

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
