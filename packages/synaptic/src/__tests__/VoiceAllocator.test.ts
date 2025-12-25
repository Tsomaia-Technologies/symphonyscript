import { VoiceAllocator } from '../VoiceAllocator'
import type { HarmonyMask } from '@symphonyscript/theory'

describe('VoiceAllocator', () => {
    beforeEach(() => {
        VoiceAllocator.reset()
    })

    test('allocates pitches from mask', () => {
        const mask = 0b1001 as unknown as HarmonyMask // Root + Minor 3rd

        const pitches: number[] = []
        VoiceAllocator.allocate(mask, 60, (pitch, _) => {
            pitches.push(pitch)
        })

        // Bit 0 = 60
        // Bit 3 = 63
        expect(pitches).toContain(60)
        expect(pitches).toContain(63)
    })

    test('rotates MPE channels (Round-Robin)', () => {
        const mask = 0b111 as unknown as HarmonyMask // Cluster: Root, m2, M2

        const channels: number[] = []
        VoiceAllocator.allocate(mask, 60, (_, ch) => {
            channels.push(ch)
        })

        expect(channels).toEqual([1, 2, 3])
    })

    test('loops channels after 15', () => {
        // Force counter near limit
        for (let i = 0; i < 14; i++) {
            VoiceAllocator.allocate(1 as unknown as HarmonyMask, 0, () => { }) // Burn 1-14
        }

        const channels: number[] = []
        VoiceAllocator.allocate(0b111 as unknown as HarmonyMask, 60, (_, ch) => {
            channels.push(ch)
        })

        // Should be 15, 1, 2
        // Wait, 1-14 burned. Next is 15.
        // Then 1?
        // Let's verify logic: nextChannel++ > 15 -> 1

        expect(channels[0]).toBe(15)
        expect(channels[1]).toBe(1)
        expect(channels[2]).toBe(2)
    })
})
