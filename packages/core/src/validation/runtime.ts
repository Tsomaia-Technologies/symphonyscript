import type { ClipOperation } from '../../../../../symphonyscript-legacy/src/legacy/clip/types'

/**
 * Error for invalid builder usage.
 * Thrown immediately when a builder method is called with invalid arguments.
 */
export class BuilderValidationError extends Error {
  constructor(
    public readonly method: string,
    public readonly reason: string,
    public readonly lastOperation?: ClipOperation
  ) {
    const ctx = lastOperation ? ` (after ${lastOperation.kind})` : ''
    super(`${method}(): ${reason}${ctx}`)
    this.name = 'BuilderValidationError'
  }
}

export const validate = {
  /**
   * Last operation must be note or chord.
   */
  lastOpIsNote(method: string, ops: ClipOperation[]): void {
    if (ops.length === 0) {
      throw new BuilderValidationError(method, 'no previous operation')
    }
    const last = ops[ops.length - 1]

    // Check for transpose/stack wrapping note
    const isNoteOrChord = (op: ClipOperation): boolean => {
      if (op.kind === 'note' || op.kind === 'stack') return true
      if (op.kind === 'transpose') return isNoteOrChord(op.operation)
      return false
    }

    if (!isNoteOrChord(last)) {
      throw new BuilderValidationError(
        method,
        `cannot apply to '${last.kind}' — only notes/chords`,
        last
      )
    }
  },

  /**
   * Value must be in range.
   */
  inRange(method: string, name: string, value: number, min: number, max: number): void {
    if (value < min || value > max) {
      throw new BuilderValidationError(method, `${name} must be ${min}-${max}, got ${value}`)
    }
  },

  velocity(method: string, v: number): void {
    if (v < 0 || v > 1) {
      const hint = (v > 1 && v <= 127)
        ? ` Looks like MIDI velocity? Use midiVelocityToNormalized(${v}) => ${(v / 127).toFixed(2)}`
        : ''
      throw new BuilderValidationError(
        method,
        `velocity must be 0-1 (normalized).${hint} Got ${v}`
      )
    }
  },

  bpm(method: string, bpm: number): void {
    validate.inRange(method, 'bpm', bpm, 1, 999)
  },

  loopCount(method: string, count: number): void {
    if (!Number.isInteger(count) || count < 1) {
      throw new BuilderValidationError(method, `count must be positive integer, got ${count}`)
    }
  },

  pitch(method: string, pitch: string): void {
    if (!/^[A-Ga-g][#b]?-?\d+$/.test(pitch)) {
      // Basic regex for C4, F#3, Bb-1
      throw new BuilderValidationError(method, `invalid pitch '${pitch}' — use C4, F#3, Bb5`)
    }
  }
}
