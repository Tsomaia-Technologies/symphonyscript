import { SynapticMelodyNoteCursor } from '../cursors/SynapticMelodyNoteCursor';
import { SynapticChordCursor } from '../cursors/SynapticChordCursor';
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
    generateSourceId() { return 999; }
    commit() { }
    rest = jest.fn();
    tempo = jest.fn();
    timeSignature = jest.fn();
    swing = jest.fn();
    groove = jest.fn();
    control = jest.fn();
    stack = jest.fn();
    loop = jest.fn();
}

class MockChordCursor extends SynapticChordCursor {
    bindCalledWith = -1;
    chordCalledWith = '';

    bind(t: number): this {
        this.bindCalledWith = t;
        return this;
    }

    chord(sym: string): this {
        this.chordCalledWith = sym;
        return this;
    }
}

describe('SynapticMelodyNoteCursor (Phase 3 & 4)', () => {
    let clip: MockClip;
    let chordCursor: MockChordCursor;
    let cursor: SynapticMelodyNoteCursor;

    beforeEach(() => {
        mockInsertAsync.mockClear();
        clip = new MockClip(mockBridge);
        chordCursor = new MockChordCursor(clip, mockBridge, 8);
        cursor = new SynapticMelodyNoteCursor(clip, mockBridge, chordCursor);
    });

    describe('Expression Modifiers (Phase 3)', () => {
        it('sets expression properties', () => {
            cursor.detune(0.5).timbre(0.2).pressure(0.8).expression(15);
            expect((cursor as any)._detune).toBe(0.5);
            expect((cursor as any)._timbre).toBe(0.2);
            expect(cursor.expressionId).toBe(15);
        });
    });

    describe('Relays (Phase 4)', () => {
        it('note() -> chord() transition', () => {
            // 1. note('C4')
            cursor.note('C4', 1.0);
            expect(cursor.hasPending).toBe(true);
            expect(clip.tick).toBe(0); // Not advanced yet

            // 2. chord('Dm')
            const result = cursor.chord('Dm');

            // Verify C4 flush (velocity 101 → 102 with seed=42 humanization)
            expect(mockInsertAsync).toHaveBeenCalledWith(
                1, 60, 102, 1.0, 0, false, 999, undefined, 0
            );

            // Verify tick advance
            expect(clip.tick).toBe(1.0);

            // Verify chord cursor activation
            expect(chordCursor.bindCalledWith).toBe(1.0);
            expect(chordCursor.chordCalledWith).toBe('Dm');
            expect(result).toBe(chordCursor);
        });

        it('degree() behaves like note()', () => {
            cursor.degree(3, 0.5);
            cursor.hasPending = true;

            cursor.flush();
            // Degree 3 in C major = F (60 + 5 semitones), velocity humanized to 102 with seed=42
            expect(mockInsertAsync).toHaveBeenCalledWith(
                1, 65, 102, 0.5, 0, false, 999, undefined, 0
            );
        });
    });
});
