import { SynapticNoteCursor } from '../cursors/SynapticNoteCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';

// Mocks
const mockInsertAsync = jest.fn();
const mockBridge = {
    insertAsync: mockInsertAsync
} as unknown as SiliconBridge;

class MockClip extends SynapticClip {
    tick = 0;
    constructor(bridge: SiliconBridge, seed: number = 42) {
        super(bridge, seed); // Pass seed for deterministic humanization
    }
    getCurrentTick() { return this.tick; }
    advanceTick(t: number) { this.tick += t; }
    generateSourceId() { return 123; }

    commit() { }
    rest = jest.fn().mockImplementation(() => this);
    tempo = jest.fn().mockImplementation(() => this);
    timeSignature = jest.fn().mockImplementation(() => this);
    swing = jest.fn().mockImplementation(() => this);
    groove = jest.fn().mockImplementation(() => this);
    control = jest.fn().mockImplementation(() => this);
    stack = jest.fn().mockImplementation(() => this);
    loop = jest.fn().mockImplementation(() => this);
}

describe('SynapticNoteCursor (Phase 2)', () => {
    let clip: MockClip;
    let cursor: SynapticNoteCursor;

    beforeEach(() => {
        mockInsertAsync.mockClear();
        clip = new MockClip(mockBridge);
        cursor = new SynapticNoteCursor(clip, mockBridge);
    });

    it('note() relays properly (Sequential)', () => {
        // 1. C4 (pending)
        cursor.note('C4', 1.0);
        expect(cursor.hasPending).toBe(true);
        expect(mockInsertAsync).not.toHaveBeenCalled();
        expect(clip.tick).toBe(0);

        // 2. E4 (calls flush on C4, advances tick, makes E4 pending)
        cursor.note('E4', 0.5);

        // Check flush of C4
        expect(mockInsertAsync).toHaveBeenCalledTimes(1);
        expect(mockInsertAsync).toHaveBeenCalledWith(
            1, // OPCODE_NOTE
            60, // C4
            102, // 0.8 * 127 = 101.6 → 101, humanized to 102 with seed=42
            1.0, // Duration
            0, // Base tick
            false, // Muted
            123, // SourceID
            undefined, // afterSourceId
            undefined  // expressionId
        );

        // Check tick advancement
        expect(clip.tick).toBe(1.0);

        // Check state is now E4 pending
        expect(cursor.hasPending).toBe(true);
        // (We can't easily check private pitch, but next flush would reveal it)
    });

    it('flush sends correct pitch and velocity', () => {
        cursor.velocity(1.0);
        cursor.note('A4'); // 69, pending
        cursor.flush();

        expect(mockInsertAsync).toHaveBeenCalledWith(
            1, 69, 127, 0.25, 0, false, 123, undefined, undefined
        );
    });

    it('throws on invalid pitch', () => {
        expect(() => cursor.note('Invalid')).toThrow();
    });
});
