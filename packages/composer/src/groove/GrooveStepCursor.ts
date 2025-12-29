import { SynapticGrooveBuilder, GrooveTemplate } from './SynapticGrooveBuilder';

/**
 * GrooveStepCursor
 * Helper for configuring individual steps in the GrooveBuilder chain.
 */
export class GrooveStepCursor {
    private index: number = 0;

    constructor(private builder: SynapticGrooveBuilder) { }

    bind(index: number): this {
        this.index = index;
        return this;
    }

    // ========================
    // Modifiers
    // ========================

    velocity(val: number): this {
        this.builder.velocities[this.index] = val;
        return this;
    }

    duration(val: number): this {
        this.builder.durations[this.index] = val;
        return this;
    }

    timing(offset: number): this {
        this.builder.offsets[this.index] = offset;
        return this;
    }

    probability(p: number): this {
        this.builder.probabilities[this.index] = p;
        return this;
    }

    // ========================
    // Relay & Terminal
    // ========================

    /**
     * Commits current step and starts the next one.
     */
    step(timing?: number): this {
        this.builder.advance();

        if (timing !== undefined) {
            this.timing(timing);
        }
        return this;
    }

    /**
     * Finalizes the groove and returns the template.
     */
    freeze(): GrooveTemplate {
        return this.builder.build();
    }
}
