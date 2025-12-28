 import { PolyOscillator } from '@symphonyscript/dsp';

/**
 * Manages voice allocation for the PolyOscillator.
 * Maps MIDI pitches to voice indices.
 * Zero-allocation in hot path.
 */
export class VoiceManager {
    private oscillator: PolyOscillator;

    // Voice tracking (Max 32 voices from PolyOscillator)
    private static MAX_VOICES = 32;
    private voiceActive: Uint8Array = new Uint8Array(VoiceManager.MAX_VOICES);
    private voicePitches: Int32Array = new Int32Array(VoiceManager.MAX_VOICES);
    private voiceAges: Uint32Array = new Uint32Array(VoiceManager.MAX_VOICES); // For LRU stealing
    private currentTick: number = 0;

    constructor(oscillator: PolyOscillator) {
        this.oscillator = oscillator;
        // Initialize pitches to -1 
        for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
            this.voicePitches[i] = -1;
        }
    }

    /**
     * Trigger a note on.
     * Finds a free voice or steals the oldest one.
     */
    public noteOn(pitch: number, velocity: number, sampleOffset: number): void {
        this.currentTick++; // Simple age counter

        // 1. Check if pitch is already playing (retrigger)
        let voiceIndex = -1;
        for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
            if (this.voiceActive[i] === 1 && this.voicePitches[i] === pitch) {
                voiceIndex = i;
                break;
            }
        }

        // 2. If not, find free voice
        if (voiceIndex === -1) {
            for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
                if (this.voiceActive[i] === 0) {
                    voiceIndex = i;
                    break;
                }
            }
        }

        // 3. If no free voice, steal oldest
        if (voiceIndex === -1) {
            let oldestAge = 0xFFFFFFFF; // Max Uint32
            let oldestIndex = 0;

            for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
                if (this.voiceAges[i] < oldestAge) {
                    oldestAge = this.voiceAges[i];
                    oldestIndex = i;
                }
            }
            voiceIndex = oldestIndex;
        }

        // Activate voice
        this.voiceActive[voiceIndex] = 1;
        this.voicePitches[voiceIndex] = pitch;
        this.voiceAges[voiceIndex] = this.currentTick;

        // Calculate freq from MIDI pitch
        // F = 440 * 2^((P-69)/12)
        const frequency = 440 * Math.pow(2, (pitch - 69) / 12);

        this.oscillator.noteOn(voiceIndex, frequency, velocity, sampleOffset);
    }

    /**
     * Trigger a note off.
     */
    public noteOff(pitch: number): void {
        for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
            if (this.voiceActive[i] === 1 && this.voicePitches[i] === pitch) {
                this.voiceActive[i] = 0;
                this.voicePitches[i] = -1;
                this.oscillator.noteOff(i);
                // Don't break, in case multiple voices have same pitch (unison?)
                // For now, let's just kill all matching pitches
            }
        }
    }

    public allNotesOff(): void {
        for (let i = 0; i < VoiceManager.MAX_VOICES; i++) {
            if (this.voiceActive[i] === 1) {
                this.voiceActive[i] = 0;
                this.voicePitches[i] = -1;
                this.oscillator.noteOff(i);
            }
        }
    }
}
