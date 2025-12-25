import { Clip } from '../Clip'
import { createSiliconBridge } from '@symphonyscript/kernel' // Using factory from bridge
import type { HarmonyMask } from '@symphonyscript/theory'

// Note: In unit tests we often mock bridge, but integration requires real bridge w/ mocks
// Let's rely on standard test setup

jest.mock('@symphonyscript/kernel', () => {
    const originalModule = jest.requireActual('@symphonyscript/kernel')
    return {
        ...originalModule,
        SiliconBridge: jest.fn().mockImplementation(() => ({
            generateSourceId: jest.fn(() => 1),
            insertAsync: jest.fn(() => 1), // Returns valid ptr
        })),
        createSiliconBridge: jest.fn()
    }
})

describe('SynapticClip.harmony', () => {
    test('calls addNote for each interval in mask', () => {
        const clip = Clip.clip()
        const bridge = (clip as any).bridge

        // Mock implementation of insertAsync specifically for this test
        const insertSpy = jest.fn(() => 1)
        bridge.insertAsync = insertSpy
        bridge.generateSourceId = jest.fn(() => 100)

        // Major Triad: 0, 4, 7 (bits) -> Mask 10010001
        // 1 | (1<<4) | (1<<7) = 1 | 16 | 128 = 145
        const majorTriad = 145 as unknown as HarmonyMask

        clip.harmony(majorTriad, 60, 480)

        expect(insertSpy).toHaveBeenCalledTimes(3)
        // Check pitches: 60, 64, 67
        // Args: opcode, pitch, vel, dur, tick, muted, sourceId, afterId, expressionId
        expect(insertSpy).toHaveBeenCalledWith(1, 60, 100, 480, 0, false, 100, undefined, expect.any(Number))
        expect(insertSpy).toHaveBeenCalledWith(1, 64, 100, 480, 0, false, 100, undefined, expect.any(Number))
        expect(insertSpy).toHaveBeenCalledWith(1, 67, 100, 480, 0, false, 100, undefined, expect.any(Number))
    })

    test('advances cursor only once per harmony', () => {
        const clip = Clip.clip()
        const startTick = clip.getCurrentTick()

        clip.harmony(1 as unknown as HarmonyMask, 60, 480)

        expect(clip.getCurrentTick()).toBe(startTick + 480)
    })
})
