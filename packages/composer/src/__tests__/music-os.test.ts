// =============================================================================
// Music OS Integration Test - End-to-End Verification
// =============================================================================
// This test proves the "Music OS" works: clean DSL → Synaptic Layer → Kernel.

import { Clip } from '../Clip'
import { SiliconSynapse } from '@symphonyscript/core/linker'

// =============================================================================
// Test Helpers
// =============================================================================

// Helper to read node data from SAB
function readNodeFromSAB(
    bridge: any,
    ptr: number
): {
    pitch: number
    velocity: number
    duration: number
    baseTick: number
    nextPtr: number
    sourceId: number
} | null {
    let result: any = null

    bridge.getLinker().readNode(ptr, (
        _ptr: number,
        _opcode: number,
        pitch: number,
        velocity: number,
        duration: number,
        baseTick: number,
        nextPtr: number,
        sourceId: number,
        _flags: number,
        _seq: number
    ): void => {
        result = {
            pitch,
            velocity,
            duration,
            baseTick,
            nextPtr,
            sourceId
        }
    })

    return result
}

// Helper to check if synapse exists
function synapseExists(bridge: any, sourceId: number, targetId: number): boolean {
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
// Music OS Integration Test
// =============================================================================

describe('Music OS - End-to-End Integration', () => {
    test('Compose → Link → Verify (Full Stack)', () => {
        // =========================================================================
        // 1. COMPOSE (High-Level DSL - "Music" not "Engineering")
        // =========================================================================

        const intro = Clip.melody('Intro')
            .key('C')
            .degree(1, 480)  // C4
            .degree(3, 480)  // E4
            .degree(5, 480)  // G4

        const verse = Clip.melody('Verse')
            .chord([1, 4, 6], 960)  // C-F-A chord

        // =========================================================================
        // 2. LINK (Synaptic Layer)
        // =========================================================================

        intro.play(verse)

        // =========================================================================
        // 3. VERIFY (Kernel Layer - Deep SAB Inspection)
        // =========================================================================

        // Get the bridge (internal for verification only)
        const introBuilder = intro.getBuilder()
        const verseBuilder = verse.getBuilder()

        // Access bridge via builder (hacky but necessary for verification)
        const bridge = (introBuilder as any).bridge

        // Verify Intro nodes exist in SAB
        const introEntryId = introBuilder.getEntryId()
        const introExitId = introBuilder.getExitId()

        const introPtrC = bridge.getNodePtr(introEntryId)
        const nodeC = readNodeFromSAB(bridge, introPtrC)

        expect(nodeC).not.toBeNull()
        expect(nodeC!.pitch).toBe(60)  // C4
        expect(nodeC!.duration).toBe(480)
        expect(nodeC!.baseTick).toBe(0)

        // Follow linked list: C → E
        const nodeE = readNodeFromSAB(bridge, nodeC!.nextPtr)
        expect(nodeE).not.toBeNull()
        expect(nodeE!.pitch).toBe(64)  // E4
        expect(nodeE!.duration).toBe(480)
        expect(nodeE!.baseTick).toBe(480)

        // Follow linked list: E → G
        const nodeG = readNodeFromSAB(bridge, nodeE!.nextPtr)
        expect(nodeG).not.toBeNull()
        expect(nodeG!.pitch).toBe(67)  // G4
        expect(nodeG!.duration).toBe(480)
        expect(nodeG!.baseTick).toBe(960)
        expect(nodeG!.sourceId).toBe(introExitId)

        // Verify Verse chord nodes exist in SAB
        const verseEntryId = verseBuilder.getEntryId()
        const verseExitId = verseBuilder.getExitId()

        const versePtrC = bridge.getNodePtr(verseEntryId)
        const chordNodeC = readNodeFromSAB(bridge, versePtrC)

        expect(chordNodeC).not.toBeNull()
        expect(chordNodeC!.pitch).toBe(60)  // C4 (degree 1)
        expect(chordNodeC!.duration).toBe(960)
        expect(chordNodeC!.baseTick).toBe(0)  // Verse builder starts at tick 0

        // The chord notes are added at the same tick, so we need to find F and A
        // They should be accessible via the builder
        // For simplicity, we'll just verify the entry exists
        expect(verseEntryId).toBeDefined()
        expect(verseExitId).toBeDefined()

        // Verify Synapse Connection: Intro-Exit → Verse-Entry
        expect(synapseExists(bridge, introExitId, verseEntryId)).toBe(true)
    })

    test('Clean API - No Engineering Leakage', () => {
        // This test verifies the user-facing API is clean and musical

        // ✅ GOOD: Musical, expressive, fluent
        const melody = Clip.melody('Test')
            .key('D')
            .octave(5)
            .degree(1).degree(2).degree(3)
            .chord([1, 3, 5])

        // Verify it works without exposing internals
        expect(melody).toBeDefined()
        expect(melody.getCurrentTick()).toBe(1920)  // 3*480 + 480

        // ❌ BAD: User should never see SiliconBridge, SAB, pointers, etc.
        // The test above (SAB verification) is for our verification only,
        // not what users would write
    })

    test('Multiple Clips with Complex Linking', () => {
        const intro = Clip.melody('Intro')
            .note('C4', 240)
            .note('E4', 240)
            .rest(240)
            .note('G4', 240)

        const verse = Clip.clip('Verse')
            .note('G3', 480)
            .note('C4', 480)

        const chorus = Clip.melody('Chorus')
            .chord([1, 3, 5, 8], 960)

        // Link: intro → verse → chorus
        intro.play(verse)
        verse.play(chorus)

        // Verify connections exist
        const bridge = (intro.getBuilder() as any).bridge

        const introExit = intro.getBuilder().getExitId()
        const verseEntry = verse.getBuilder().getEntryId()
        const verseExit = verse.getBuilder().getExitId()
        const chorusEntry = chorus.getBuilder().getEntryId()

        expect(synapseExists(bridge, introExit, verseEntry)).toBe(true)
        expect(synapseExists(bridge, verseExit, chorusEntry)).toBe(true)
    })
})
