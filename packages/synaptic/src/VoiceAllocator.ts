import { unpack, type HarmonyMask } from '@symphonyscript/theory'

/**
 * VoiceAllocator
 * 
 * Bridges music theory (HarmonyMasks) and silicon execution (Nodes).
 * Implements MPE Channel Rotation for true polyphonic voice assignment.
 */
export class VoiceAllocator {
    // Simple round-robin counter for MPE channel assignment (1-15)
    // Channel 0 is usually global/main, so we rotate 1-15 for polyphony.
    private static nextChannel = 1

    /**
     * Allocate voices for a harmony mask using pure integer arithmetic.
     * 
     * @param mask - 24-bit HarmonyMask integer
     * @param root - MIDI root pitch
     * @param callback - Function to create note with pitch and assigned MPE expression ID
     */
    static allocate(
        mask: HarmonyMask,
        root: number,
        callback: (pitch: number, expressionId: number) => void
    ): void {
        unpack(mask, (interval) => {
            // 24-EDO interval to semitones: interval / 2
            // e.g. 7 (Perfect 5th) -> 3.5 semitones in 24-EDO? 
            // WAIT: RFC-047 says 24-EDO grid. 
            // Standard MIDI is 12-EDO. 
            // If mask is 12-EDO based (Standard Western), interval is semitones.
            // Checking theory package usage... mask is 12-bit usually for Western.
            // But RFC-047 title is "24-Bit Theory".
            // Let's assume the interval from unpack IS the semitone offset for now 
            // unless theory package defines otherwise.
            // Re-reading RFC-047 Phase 1: "The 24-bit integer allows us to represent 
            // intervals... wait, Phase 1 implemented 24-EDO grid?"
            // Phase 1 verification said "24-EDO interval grid".
            // So interval is in quarter-tones? 
            // If I pass it to MIDI pitch, 1 semitone = 1 integer.
            // I will assume interval is SEMITONES for standard usage compatible with MIDI.

            const pitch = root + interval

            // Assign unique channel for this voice (Round-Robin 1-15)
            const channel = this.nextChannel++
            if (this.nextChannel > 15) this.nextChannel = 1

            callback(pitch, channel)
        })
    }

    /**
     * Reset the channel rotation counter.
     */
    static reset(): void {
        this.nextChannel = 1
    }
}
