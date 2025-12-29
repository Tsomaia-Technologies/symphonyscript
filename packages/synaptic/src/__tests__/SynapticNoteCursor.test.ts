import { SynapticNoteCursor } from '../SynapticNoteCursor';

describe('SynapticNoteCursor', () => {
    test('Default values', () => {
        const cursor = new SynapticNoteCursor();
        expect(cursor.pitch).toBe(60);
        expect(cursor.velocity).toBe(100);
        expect(cursor.duration).toBe(480);
        expect(cursor.baseTick).toBe(0);
        expect(cursor.muted).toBe(false);
    });

    test('.set() updates all fields', () => {
        const cursor = new SynapticNoteCursor();
        cursor.set(72, 110, 240, 960, true);

        expect(cursor.pitch).toBe(72);
        expect(cursor.velocity).toBe(110);
        expect(cursor.duration).toBe(240);
        expect(cursor.baseTick).toBe(960);
        expect(cursor.muted).toBe(true);
    });

    test('.set() returns this for chaining', () => {
        const cursor = new SynapticNoteCursor();
        const result = cursor.set(60, 100, 480, 0);
        expect(result).toBe(cursor);
    });

    test('.reset() restores default values', () => {
        const cursor = new SynapticNoteCursor();
        cursor.set(72, 110, 240, 960, true);
        cursor.reset();

        expect(cursor.pitch).toBe(60);
        expect(cursor.velocity).toBe(100);
        expect(cursor.duration).toBe(480);
        expect(cursor.baseTick).toBe(0);
        expect(cursor.muted).toBe(false);
    });

    test('.reset() returns this for chaining', () => {
        const cursor = new SynapticNoteCursor();
        const result = cursor.reset();
        expect(result).toBe(cursor);
    });

    test('Reusable instance (zero-allocation pattern)', () => {
        const cursor = new SynapticNoteCursor();

        // First note
        cursor.set(60, 100, 480, 0);
        expect(cursor.pitch).toBe(60);

        // Reuse for second note
        cursor.set(64, 110, 240, 480);
        expect(cursor.pitch).toBe(64);
        expect(cursor.baseTick).toBe(480);
    });
});
