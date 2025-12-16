import type { ClipBuilder } from '../ClipBuilder'
import type {
    Articulation,
    NoteDuration,
    TimeSignatureString,
    TempoCurve
} from '../../types/primitives'
import type {
    ClipOperation,
    NoteOp,
    OperationsSource,
    StackOp,
    TempoTransition,
    ClipNode,
    HumanizeSettings
} from '../types'
import { validate } from '../../validation/runtime'
import type { GrooveTemplate } from '../../groove/types'
import type { FrozenClip } from '../ClipBuilder'

/**
 * Base cursor for modifying notes and chords.
 * Holds a pending operation (Note or Stack) that hasn't been added to the builder yet.
 * Allows fluent chaining of modifiers (velocity, articulation, etc.).
 * 
 * Auto-commits the pending operation when any "escape" method is called
 * (e.g. rest, tempo, build, or starting a new note).
 * 
 * Implements OperationsSource<B> to allow passing cursors directly to loop().
 */
export class NoteCursor<B extends ClipBuilder<any>> implements OperationsSource<B> {
    constructor(
        protected readonly builder: B,
        protected readonly pendingOp: NoteOp | StackOp
    ) { }

    // --- OperationsSource Interface ---

    /**
     * Returns operations as an array (OperationsSource interface).
     * Commits the pending operation first, then extracts from builder.
     */
    toOperations(): ClipOperation[] {
        return this.commit().toOperations()
    }

    // --- Modifiers (Chainable) ---

    /** Set velocity (0-1) for the pending note/chord. */
    velocity(v: number): this {
        validate.velocity('velocity', v)
        this.applyModifier({ velocity: v })
        return this
    }

    /** Apply staccato articulation (50% duration) */
    staccato(): this {
        this.applyModifier({ articulation: 'staccato' })
        return this
    }

    /** Apply legato articulation (105% duration) */
    legato(): this {
        this.applyModifier({ articulation: 'legato' })
        return this
    }

    /** Apply accent (velocity boost) */
    accent(): this {
        this.applyModifier({ articulation: 'accent' })
        return this
    }

    /** Apply tenuto articulation (100% duration, sustained) */
    tenuto(): this {
        this.applyModifier({ articulation: 'tenuto' })
        return this
    }

    /** Apply marcato articulation (strong accent) */
    marcato(): this {
        this.applyModifier({ articulation: 'marcato' })
        return this
    }

    /** Apply humanization to timing and velocity */
    humanize(options?: HumanizeSettings): this {
        this.applyModifier({ humanize: options ?? { timing: 15, velocity: 0.05 } })
        return this
    }

  /**
   * Disable humanization and quantization for this note/chord.
   * Note will have exact timing and velocity, overriding clip-level settings.
   */
  precise(): this {
    this.applyModifier({ humanize: null, quantize: null })
    return this
  }

    // --- Escapes (Commit & Delegate) ---

    /** Commit the pending note and add a rest */
    rest(duration: NoteDuration): B {
        return this.commit().rest(duration)
    }

    /** Commit and set tempo */
    tempo(bpm: number, transition?: NoteDuration | TempoTransition): B {
        return this.commit().tempo(bpm, transition)
    }

    /**
     * Set humanization context for subsequent notes.
     * Notes will have natural timing and velocity variations.
     */
    defaultHumanize(settings: HumanizeSettings): B {
        return this.commit().defaultHumanize(settings)
    }

    /** Commit and set time signature */
    timeSignature(signature: TimeSignatureString): B {
        return this.commit().timeSignature(signature)
    }

    /** Commit and set swing */
    swing(amount: number): B {
        return this.commit().swing(amount)
    }

    /** Commit and set groove */
    groove(template: GrooveTemplate): B {
        return this.commit().groove(template)
    }

    /** Commit and send MIDI control change */
    control(controller: number, value: number): B {
        return this.commit().control(controller, value)
    }

    /** Commit and play another clip/block/node */
    play(item: ClipBuilder<any> | ClipOperation | FrozenClip | ClipNode): B {
        return this.commit().play(item)
    }

    /** Commit and stack operations */
    stack(builderFn: (b: B) => B): B {
        return this.commit().stack(builderFn as any)
        // cast needed because stack expects (b: this) => this, but B is generic
    }

    /** Commit and loop operations */
    loop(count: number, builderFn: (b: B) => B): B {
        return this.commit().loop(count, builderFn as any)
    }

    /** Commit and isolate scope */
    isolate(options: import('../types').ScopeIsolation, builderFn: (b: B) => B): B {
        return this.commit().isolate(options, builderFn as any)
    }

    /** Commit and build the ClipNode */
    build(): ClipNode {
        return this.commit().build()
    }

    /** Commit and preview ASCII */
    preview(bpm?: number): B {
        return this.commit().preview(bpm)
    }

    /** Commit and freeze block */
    freeze(options: import('../../compiler/block').BlockCompileOptions): FrozenClip {
        return this.commit().freeze(options)
    }

    // --- Internal ---

    /**
     * Commit the pending operation to the builder's chain.
     * Returns the builder instance to continue the chain.
     */
    commit(): B {
        // We access the protected method via type assertion since we act as an extension of the builder
        // Using play() to add the op is safe and correct (handles wrapping/transposition inside Builder if needed)
        return this.builder.play(this.pendingOp)
    }

    protected applyModifier(mod: Partial<NoteOp>): void {
        if (this.pendingOp.kind === 'note') {
            Object.assign(this.pendingOp, mod)
        } else if (this.pendingOp.kind === 'stack') {
            // Apply to all notes in the chord
            for (const op of this.pendingOp.operations) {
                if (op.kind === 'note') {
                    Object.assign(op, mod)
                }
            }
        }
    }
}
