import { NoteCursor } from './NoteCursor'
import type { DrumBuilder, EuclideanOptions } from '../DrumBuilder'

/**
 * Cursor for drum hits with specialized modifiers.
 */
export class DrumHitCursor extends NoteCursor<DrumBuilder> {
    // --- Modifiers ---

    /** Set velocity to ghost note level (0.3) */
    ghost(): this {
        return this.velocity(0.3)
    }

    /** Add flamenco-style grace note (placeholder) */
    flam(): this {
        // TODO: Implement grace notes
        return this
    }

    /** Add double grace note (placeholder) */
    drag(): this {
        // TODO: Implement grace notes
        return this
    }

    // --- Relays (Commit & Start New Hit) ---

    hit(drum: string): DrumHitCursor {
        return this.commit().hit(drum)
    }

    kick(): DrumHitCursor {
        return this.commit().kick()
    }

    snare(): DrumHitCursor {
        return this.commit().snare()
    }

    hat(): DrumHitCursor {
        return this.commit().hat()
    }

    openHat(): DrumHitCursor {
        return this.commit().openHat()
    }

    crash(): DrumHitCursor {
        return this.commit().crash()
    }

    ride(): DrumHitCursor {
        return this.commit().ride()
    }

    clap(): DrumHitCursor {
        return this.commit().clap()
    }

    tom(which: 1 | 2 | 3 = 1): DrumHitCursor {
        return this.commit().tom(which)
    }

    // --- Escapes ---

    euclidean(options: EuclideanOptions): DrumBuilder {
        return this.commit().euclidean(options)
    }
}
