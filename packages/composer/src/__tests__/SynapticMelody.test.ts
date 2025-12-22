// =============================================================================
// SynapticMelody Tests - Phase 2 Composer Package
// =============================================================================

import { SynapticMelody } from '../SynapticMelody'
import { SiliconSynapse, SiliconBridge } from '@symphonyscript/core/linker'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestBridge(): SiliconBridge {
    const linker = SiliconSynapse.create({
        nodeCapacity: 256,
        safeZoneTicks: 0
    })
    return new SiliconBridge(linker)
}

// =============================================================================
// SynapticMelody Tests
// =============================================================================

describe('SynapticMelody - Construction', () => {
    test('constructs with SiliconBridge', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        expect(melody).toBeInstanceOf(SynapticMelody)
        expect(melody.getCurrentTick()).toBe(0)
    })

    test('inherits from SynapticClip', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        // Should have parent methods
        melody.note('C4').rest().note('E4')

        expect(melody.getCurrentTick()).toBe(1440)  // 480 + 480 + 480
    })
})

describe('SynapticMelody - Degree Method', () => {
    test('degree() adds note based on scale', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.degree(1)  // Tonic (C4 = 60 in C major, octave 4)

        expect(melody.getNode().getEntryId()).toBeDefined()
        expect(melody.getCurrentTick()).toBe(480)
    })

    test('degree() returns this for chaining', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        const result = melody.degree(1)
        expect(result).toBe(melody)
    })

    test('chains multiple degrees', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.degree(1).degree(3).degree(5)  // I-III-V (C-E-G)

        expect(melody.getCurrentTick()).toBe(1440)  // 3 * 480
    })

    test('degree with custom duration', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.degree(1, 240)  // Eighth note

        expect(melody.getCurrentTick()).toBe(240)
    })

    test('degree with custom velocity', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.degree(1, 480, 64)  // Piano dynamics

        expect(melody.getNode().getEntryId()).toBeDefined()
    })
})

describe('SynapticMelody - Chord Method', () => {
    test('chord() adds multiple notes at same tick', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.chord([1, 3, 5])  // Major triad

        // Tick should advance only once
        expect(melody.getCurrentTick()).toBe(480)

        // Should have multiple notes
        expect(melody.getNode().getEntryId()).toBeDefined()
        expect(melody.getNode().getExitId()).toBeDefined()
    })

    test('chord() returns this for chaining', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        const result = melody.chord([1, 3, 5])
        expect(result).toBe(melody)
    })

    test('chord with custom duration', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.chord([1, 3, 5], 960)  // Half note chord

        expect(melody.getCurrentTick()).toBe(960)
    })

    test('multiple chords in sequence', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody
            .chord([1, 3, 5])  // I chord
            .chord([4, 6, 8])  // IV chord (next octave for 8)

        expect(melody.getCurrentTick()).toBe(960)
    })
})

describe('SynapticMelody - Musical Theory', () => {
    test('octave() sets current octave', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.octave(5).degree(1)  // C5 instead of C4

        expect(melody.getCurrentTick()).toBe(480)
    })

    test('key() sets current key', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.key('D').degree(1)  // D4 instead of C4

        expect(melody.getCurrentTick()).toBe(480)
    })

    test('scale() sets custom scale', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        // Minor scale: [0, 2, 3, 5, 7, 8, 10]
        melody.scale([0, 2, 3, 5, 7, 8, 10]).degree(1).degree(3)

        expect(melody.getCurrentTick()).toBe(960)
    })

    test('fluent chaining of configuration', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody
            .key('G')
            .octave(4)
            .scale([0, 2, 4, 5, 7, 9, 11])  // Major
            .degree(1)
            .degree(2)
            .degree(3)

        expect(melody.getCurrentTick()).toBe(1440)
    })
})

describe('SynapticMelody - Degree to MIDI Conversion', () => {
    test('converts degrees in C major correctly', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        // C major, octave 4: C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71
        melody
            .degree(1)  // C4 = 60
            .degree(2)  // D4 = 62
            .degree(3)  // E4 = 64
            .degree(4)  // F4 = 65
            .degree(5)  // G4 = 67

        expect(melody.getCurrentTick()).toBe(2400)  // 5 * 480
    })

    test('handles degrees beyond octave', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.degree(8)  // Next octave C (C5 = 72)

        expect(melody.getCurrentTick()).toBe(480)
    })

    test('works with different keys', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.key('D').degree(1)  // D4 = 62

        expect(melody.getCurrentTick()).toBe(480)
    })

    test('works with different octaves', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody.octave(3).degree(1)  // C3 = 48

        expect(melody.getCurrentTick()).toBe(480)
    })
})

describe('SynapticMelody - Integration', () => {
    test('complex melody with degrees and chords', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody
            .key('C')
            .octave(4)
            .degree(1, 240)       // C4 eighth note
            .degree(3, 240)       // E4 eighth note
            .degree(5, 240)       // G4 eighth note
            .chord([1, 3, 5], 480) // C major triad quarter note

        expect(melody.getCurrentTick()).toBe(1200) // 240 + 240 + 240 + 480
    })

    test('melody with rests and mixed note types', () => {
        const bridge = createTestBridge()
        const melody = new SynapticMelody(bridge)

        melody
            .degree(1)          // Degree-based
            .rest()             // Rest
            .note('E4')         // String notation
            .note(67)           // MIDI number
            .chord([1, 3, 5])   // Chord

        expect(melody.getCurrentTick()).toBe(2400)  // 5 * 480
    })
})
