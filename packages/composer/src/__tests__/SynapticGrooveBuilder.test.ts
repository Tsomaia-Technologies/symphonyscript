import { SynapticGrooveBuilder } from '../groove/SynapticGrooveBuilder';

describe('SynapticGrooveBuilder (RFC-049 Remediation)', () => {
    let builder: SynapticGrooveBuilder;

    beforeEach(() => {
        builder = new SynapticGrooveBuilder(16);
    });

    it('implements sequential builder pattern', () => {
        const template = builder
            .stepsPerBeat(4)
            .swing(0.55)
            .step(0.1).velocity(0.9)  // Step 1 (Index 0)
            .step(-0.05).duration(0.5) // Step 2 (Index 1)
            .freeze(); // Build

        expect(template.length).toBe(2);
        expect(template.stepsPerBeat).toBe(4);
        expect(template.swing).toBe(0.55);

        // Verify Step 1
        expect(template.offsets[0]).toBeCloseTo(0.1);
        expect(template.velocities[0]).toBeCloseTo(0.9);
        expect(template.durations[0]).toBeCloseTo(0.25); // Default

        // Verify Step 2
        expect(template.offsets[1]).toBeCloseTo(-0.05);
        expect(template.velocities[1]).toBeCloseTo(1.0); // Default
        expect(template.durations[1]).toBeCloseTo(0.5);
    });

    it('enforces capacity limit', () => {
        builder = new SynapticGrooveBuilder(2);
        // Step 1
        const cursor = builder.step();
        // Step 2
        cursor.step();

        expect(() => {
            cursor.step(); // 3 -> Should throw
        }).toThrow(/capacity/);
    });

    it('supports relay from cursor', () => {
        // cursor.step() should advance
        const cursor = builder.step(0.0);
        cursor.velocity(0.5);
        cursor.step(0.1).velocity(0.8);

        const template = cursor.freeze();
        expect(template.length).toBe(2);
        expect(template.velocities[0]).toBeCloseTo(0.5);
        expect(template.velocities[1]).toBeCloseTo(0.8);
    });
});
