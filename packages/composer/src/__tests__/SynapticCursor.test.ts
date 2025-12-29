import { SynapticCursor } from '../cursors/SynapticCursor';
import { SynapticClip } from '../clips/SynapticClip';
import { SiliconBridge } from '@symphonyscript/kernel';

// Mocks
const mockBridge = {} as SiliconBridge;

class MockClip extends SynapticClip {
    getCurrentTick() { return 0; }
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

class TestCursor extends SynapticCursor {
    flushCalls = 0;
    flush() {
        this.flushCalls++;
        this.hasPending = false;
    }
}

describe('SynapticCursor (Phase 1)', () => {
    let clip: MockClip;
    let cursor: TestCursor;

    beforeEach(() => {
        clip = new MockClip(mockBridge);
        cursor = new TestCursor(clip, mockBridge);
    });

    describe('Modifiers', () => {
        it('chaining returns this', () => {
            expect(cursor.velocity(0.5)).toBe(cursor);
            expect(cursor.duration(0.1)).toBe(cursor);
            expect(cursor.staccato()).toBe(cursor);
        });

        it('modifies state', () => {
            cursor.velocity(0.42);
            expect((cursor as any)._velocity).toBe(0.42);

            cursor.legato();
            expect((cursor as any)._duration).toBe(1.0);
        });
    });

    describe('Commit Logic', () => {
        it('commit() flushes if pending', () => {
            cursor.hasPending = true;
            cursor.commit();
            expect(cursor.flushCalls).toBe(1);
            expect(cursor.hasPending).toBe(false);
        });

        it('commit() does NOT flush if not pending', () => {
            cursor.hasPending = false;
            cursor.commit();
            expect(cursor.flushCalls).toBe(0);
        });
    });

    describe('Escapes', () => {
        it('rest() commits and calls clip.rest', () => {
            cursor.hasPending = true;
            const res = cursor.rest(0.5);

            expect(cursor.flushCalls).toBe(1);
            expect(clip.rest).toHaveBeenCalledWith(0.5);
            expect(res).toBe(clip);
        });

        it('tempo() commits and calls clip.tempo', () => {
            cursor.hasPending = true;
            cursor.tempo(120);
            expect(cursor.flushCalls).toBe(1);
            expect(clip.tempo).toHaveBeenCalledWith(120);
        });
    });
});
