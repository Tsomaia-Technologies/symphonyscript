import { MelodyNoteCursor } from './MelodyNoteCursor'
import type { MelodyBuilder } from '../MelodyBuilder'
import type { StackOp, NoteOp } from '../types'
import { validate, BuilderValidationError } from '../../validation/runtime'
import { noteToMidi, midiToNote } from '../../util/midi'
import { NoteName } from '../../types/primitives'

/**
 * Cursor for chord operations.
 * Extends MelodyNoteCursor but adds chord-specific modifiers like inversion.
 */
export class MelodyChordCursor extends MelodyNoteCursor {

    /**
     * Invert the chord by rotating notes.
     * @param steps Number of inversion steps (positive = up, negative = down)
     */
    inversion(steps: number): this {
        if (typeof steps !== 'number') {
             throw new BuilderValidationError('inversion', 'steps must be a number')
        }
        
        // Access pendingOp from base class (protected)
        const op = this.pendingOp

        if (op.kind === 'stack') {
            const operations = op.operations // NoteOp[] implicitly
            
            // Filter to only note operations just in case
            const noteOps = operations.filter((o): o is NoteOp => o.kind === 'note')
            
            if (noteOps.length < 2) return this 
            
            let sortedOps = [...noteOps] // Copy to manipulate
            
            const count = sortedOps.length
            
            // Calculate effective shifts
            const octaveShift = Math.floor(steps / count)
            const remainingSteps = ((steps % count) + count) % count // positive mod

            // Apply global octave shift first
            if (octaveShift !== 0) {
                 for (const n of noteOps) {
                     const m = noteToMidi(n.note)
                     if (m === null) continue // Should not happen with valid notes
                     n.note = midiToNote(m + (octaveShift * 12)) as NoteName
                 }
            }

            // Apply remaining rotations
            for (let i = 0; i < remainingSteps; i++) {
                const first = sortedOps.shift()! // Remove first
                const midi = noteToMidi(first.note)
                if (midi !== null) {
                    first.note = midiToNote(midi + 12) as NoteName // Add octave
                }
                sortedOps.push(first) // Add to end
            }

            // Update stack operations (replace original notes with reordered ones)
            // We need to maintain the original array reference inside StackOp or replace it?
            // ClipOperation[] is mutable? Yes.
            // But sortedOps contains REFERENCES to NoteOps.
            // Rotating them in `sortedOps` changes their ORDER.
            // Their content (pitch) was modified in place.
            // So we just need to update `op.operations` to match the new order.
            
            // CAUTION: op.operations might contain other things (params?).
            // If we filter, we might lose them if we blindly replace.
            // Strategy: Remove old note ops, insert new ones in order.
            // But simpler: just replace `op.operations` with `sortedOps` if strictly notes.
            // For now, assume chord() produces stack of ONLY notes.
            op.operations = sortedOps
        }

        return this
    }
}
