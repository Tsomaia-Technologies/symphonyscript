import { SynapticDrums } from '../clips/SynapticDrums';
import { SiliconBridge } from '@symphonyscript/kernel';

describe('SynapticDrumHitCursor & SynapticDrums (Phase 3)', () => {
    let drums: SynapticDrums;
    let mockBridge: jest.Mocked<SiliconBridge>;

    beforeEach(() => {
        mockBridge = {
            insertAsync: jest.fn()
        } as any;
        drums = new SynapticDrums(mockBridge);
    });

    it('creates drum hits with correct pitches', () => {
        drums.kick().snare().hat().clap().commit();

        expect(mockBridge.insertAsync).toHaveBeenCalledTimes(4);

        // Kick (C1 = 36)
        expect(mockBridge.insertAsync).toHaveBeenNthCalledWith(
            1, 1, 36, expect.any(Number), expect.any(Number),
            expect.any(Number), expect.any(Boolean), expect.any(Number),
            undefined, undefined
        );

        // Snare (D1 = 38)
        expect(mockBridge.insertAsync).toHaveBeenNthCalledWith(
            2, 1, 38, expect.any(Number), expect.any(Number),
            expect.any(Number), expect.any(Boolean), expect.any(Number),
            undefined, undefined
        );
    });

    it('applies ghost modifier', () => {
        drums.kick().ghost().snare().commit();

        const ghostCall = mockBridge.insertAsync.mock.calls[1];
        const velocity = ghostCall[2];

        // Ghost note should have low velocity (~38 = 0.3 * 127)
        expect(velocity).toBeLessThan(50);
    });

    it('supports fluent chaining', () => {
        const result = drums.kick().velocity(0.9).hat().velocity(0.5).commit();

        expect(result).toBeDefined();
        expect(mockBridge.insertAsync).toHaveBeenCalledTimes(2);
    });

    it('advances tick correctly', () => {
        drums.kick(0.25).snare(0.5).commit();

        // First kick at tick 0
        expect(mockBridge.insertAsync.mock.calls[0][4]).toBe(0);
        // Snare at tick 0.25
        expect(mockBridge.insertAsync.mock.calls[1][4]).toBe(0.25);
    });
});
