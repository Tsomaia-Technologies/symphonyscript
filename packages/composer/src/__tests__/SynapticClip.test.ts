// =============================================================================
// SynapticClip Tests - Phase 2 Composer Package
// =============================================================================

import { SynapticClip, parsePitch } from '../SynapticClip'
import { SiliconSynapse, SiliconBridge, NULL_PTR } from '@symphonyscript/core/linker'

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

// Helper to check if synapse exists
function synapseExists(bridge: SiliconBridge, sourceId: number, targetId: number): boolean {
    let found = false
    bridge.snapshotStream(
        (sid: number, tid: number): void => {
            if (sid === sourceId && tid === targetId) {
                found = true
            }
        },
        (): void => { }
    )
    return found
}

// =============================================================================
// Pitch Parsing Tests
// =============================================================================

describe('parsePitch', () => {
    test('parses MIDI numbers directly', () => {
        expect(parsePitch(60)).toBe(60)
        expect(parsePitch(48)).toBe(48)
        expect(parsePitch(72)).toBe(72)
    })

    test('parses note names with octaves', () => {
        expect(parsePitch('C4')).toBe(60)
        expect(parsePitch('D4')).toBe(62)
        expect(parsePitch('E4')).toBe(64)
        expect(parsePitch('F4')).toBe(65)
        expect(parsePitch('G4')).toBe(67)
        expect(parsePitch('A4')).toBe(69)
        expect(parsePitch('B4')).toBe(71)
    })

    test('parses sharp notes', () => {
        expect(parsePitch('C#4')).toBe(61)
        expect(parsePitch('D#4')).toBe(63)
        expect(parsePitch('F#4')).toBe(66)
    })

    test('parses flat notes', () => {
        expect(parsePitch('Db4')).toBe(61)
        expect(parsePitch('Eb4')).toBe(63)
        expect(parsePitch('Bb3')).toBe(58)
    })

    test('parses different octaves', () => {
        expect(parsePitch('C3')).toBe(48)
        expect(parsePitch('C5')).toBe(72)
        expect(parsePitch('A2')).toBe(45)
    })

    test('throws on invalid notation', () => {
        expect(() => parsePitch('H4')).toThrow('Invalid pitch notation')
        expect(() => parsePitch('C')).toThrow('Invalid pitch notation')
        expect(() => parsePitch('invalid')).toThrow('Invalid pitch notation')
    })
})

// =============================================================================
// SynapticClip Tests
// =============================================================================

describe('SynapticClip - Construction', () => {
    test('constructs with SiliconBridge', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        expect(clip).toBeInstanceOf(SynapticClip)
        expect(clip.getCurrentTick()).toBe(0)
    })
})

describe('SynapticClip - Fluent Chaining', () => {
    test('note() returns this for chaining', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        const result = clip.note('C4')
        expect(result).toBe(clip)
    })

    test('chains multiple notes', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.note('C4').note('E4').note('G4')

        // Should have 3 notes
        const builder = clip.getNode()
        expect(builder.getEntryId()).toBeDefined()
        expect(builder.getExitId()).toBeDefined()
    })

    test('rest() returns this for chaining', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        const result = clip.rest()
        expect(result).toBe(clip)
    })

    test('play() returns this for chaining', () => {
        const bridge = createTestBridge()
        const clip1 = new SynapticClip(bridge)
        const clip2 = new SynapticClip(bridge)

        clip1.note('C4')
        clip2.note('E4')

        const result = clip1.play(clip2)
        expect(result).toBe(clip1)
    })
})

describe('SynapticClip - Tick Advancement', () => {
    test('note() advances currentTick by default duration', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        expect(clip.getCurrentTick()).toBe(0)
        clip.note('C4')  // default duration = 480
        expect(clip.getCurrentTick()).toBe(480)
    })

    test('note() with custom duration advances correctly', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.note('C4', 240)  // eighth note
        expect(clip.getCurrentTick()).toBe(240)
        clip.note('D4', 960)  // whole note
        expect(clip.getCurrentTick()).toBe(1200)
    })

    test('rest() advances currentTick by default duration', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.rest()
        expect(clip.getCurrentTick()).toBe(480)
    })

    test('rest() with custom duration advances correctly', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.rest(240)
        expect(clip.getCurrentTick()).toBe(240)
        clip.rest(120)
        expect(clip.getCurrentTick()).toBe(360)
    })

    test('mixed notes and rests advance correctly', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip
            .note('C4', 480)    // 0-480
            .rest(240)          // 480-720
            .note('E4', 240)    // 720-960
            .note('G4', 480)    // 960-1440

        expect(clip.getCurrentTick()).toBe(1440)
    })
})

describe('SynapticClip - Note Input', () => {
    test('accepts MIDI numbers', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.note(60).note(64).note(67)

        expect(clip.getNode().getEntryId()).toBeDefined()
    })

    test('accepts string notation', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.note('C4').note('E4').note('G4')

        expect(clip.getNode().getEntryId()).toBeDefined()
    })

    test('accepts custom velocity', () => {
        const bridge = createTestBridge()
        const clip = new SynapticClip(bridge)

        clip.note('C4', 480, 64)  // piano

        expect(clip.getNode().getEntryId()).toBeDefined()
    })
})

describe('SynapticClip - Play/Synapse Connection', () => {
    test('play() creates synapse connection', () => {
        const bridge = createTestBridge()

        const clip1 = new SynapticClip(bridge)
        clip1.note('C4').note('E4')

        const clip2 = new SynapticClip(bridge)
        clip2.note('G4').note('C5')

        clip1.play(clip2)

        // Verify synapse exists
        const exitId1 = clip1.getNode().getExitId()
        const entryId2 = clip2.getNode().getEntryId()

        expect(synapseExists(bridge, exitId1, entryId2)).toBe(true)
    })

    test('play() with custom weight and jitter', () => {
        const bridge = createTestBridge()

        const clip1 = new SynapticClip(bridge)
        clip1.note('C4')

        const clip2 = new SynapticClip(bridge)
        clip2.note('E4')

        clip1.play(clip2, 750, 100)

        const exitId1 = clip1.getNode().getExitId()
        const entryId2 = clip2.getNode().getEntryId()

        expect(synapseExists(bridge, exitId1, entryId2)).toBe(true)
    })

    test('chained play() creates multiple connections', () => {
        const bridge = createTestBridge()

        const clip1 = new SynapticClip(bridge)
        clip1.note('C4')

        const clip2 = new SynapticClip(bridge)
        clip2.note('E4')

        const clip3 = new SynapticClip(bridge)
        clip3.note('G4')

        clip1.play(clip2).play(clip3)

        expect(synapseExists(bridge, clip1.getNode().getExitId(), clip2.getNode().getEntryId())).toBe(true)
        expect(synapseExists(bridge, clip1.getNode().getExitId(), clip3.getNode().getEntryId())).toBe(true)
    })
})

describe('SynapticClip - Integration', () => {
    test('complex composition with fluent API', () => {
        const bridge = createTestBridge()

        const intro = new SynapticClip(bridge)
            .note('C4', 480)
            .note('E4', 480)
            .note('G4', 480)
            .rest(480)

        const verse = new SynapticClip(bridge)
            .note('G3', 240)
            .note('C4', 240)
            .note('E4', 240)
            .note('G4', 240)

        intro.play(verse)

        expect(intro.getCurrentTick()).toBe(1920)
        expect(verse.getCurrentTick()).toBe(960)
        expect(synapseExists(bridge, intro.getNode().getExitId(), verse.getNode().getEntryId())).toBe(true)
    })
})
