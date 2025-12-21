import type {NoteDuration, NoteName} from '@symphonyscript/core/types/primitives'

// Note: We use 'any' or 'Self' generic to refer to the fluent return type

/**
 * Can produce pitched notes.
 */
export interface HasPitch<Self> {
  note(pitch: NoteName, duration?: NoteDuration, velocity?: number): Self

  chord(pitches: NoteName[], duration?: NoteDuration, velocity?: number): Self
  chord(code: string, octave: number, duration?: NoteDuration, options?: any): Self

  arpeggio(pitches: NoteName[], rate: NoteDuration, options?: any): Self
}

/**
 * Can transpose content.
 */
export interface HasTransposition<Self> {
  transpose(semitones: number): Self

  octave(n: number): Self

  octaveUp(n?: number): Self

  octaveDown(n?: number): Self
}

/**
 * Can apply articulation to previous note.
 */
export interface HasArticulation<Self> {
  staccato(): Self

  legato(): Self

  accent(): Self

  tenuto(): Self
}

/**
 * Can control dynamics (velocity/volume).
 */
export interface HasDynamics<Self> {
  crescendo(duration: NoteDuration, options?: any): Self

  decrescendo(duration: NoteDuration, options?: any): Self

  velocityRamp(to: number, duration: NoteDuration, options?: any): Self

  velocityCurve(points: any[], duration: NoteDuration): Self
}

/**
 * String instrument techniques.
 */
export interface HasStringTechniques<Self> {
  bend(semitones: number): Self

  slide(toNote: NoteName, duration: NoteDuration): Self

  bendReset(): Self
}

/**
 * Wind instrument techniques.
 */
export interface HasWindTechniques<Self> {
  breath(amount: number): Self

  expressionCC(amount: number): Self
}

/**
 * Universal melodic techniques (available on all melodic builders).
 */
export interface HasMelodicTechniques<Self> {
  vibrato(depth?: number, rate?: number): Self

  humanize(options?: any): Self

  tie(type: 'start' | 'continue' | 'end'): Self

  glide(time: NoteDuration): Self

  aftertouch(value: number, options?: any): Self
}

/**
 * Composition (all builders).
 */
export interface HasComposition<Self> {
  loop(times: number, builderFn: (b: Self) => Self): Self

  play(item: any): Self

  stack(builderFn: (b: Self) => Self): Self
}

/**
 * Tempo control.
 */
export interface HasTempo<Self> {
  tempo(bpm: number, transition?: NoteDuration | any): Self

  timeSignature(signature: string): Self

  swing(amount: number): Self

  groove(template: any): Self
}

/**
 * Basic operations.
 */
export interface HasBaseOps<Self> {
  rest(duration: NoteDuration): Self
}
