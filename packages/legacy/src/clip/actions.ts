import type {Articulation, NoteDuration, NoteName} from '@symphonyscript/core/types/primitives'
import type {ControlOp, NoteOp, PitchBendOp, SourceLocation, StackOp} from './types'

// --- Source Location Helper ---

function createSource(method: string): SourceLocation {
  return {method}
}

// --- Melodic Actions ---

/** Create a note operation */
export function note(
  pitch: NoteName,
  duration: NoteDuration = '4n',
  velocity: number = 1,
  articulation?: Articulation
): NoteOp {
  return {
    kind: 'note',
    note: pitch,
    duration,
    velocity,
    articulation,
    _source: createSource('note')
  }
}

/** Create a chord (stack of notes) */
export function chord(
  notes: NoteName[],
  duration: NoteDuration = '4n',
  velocity: number = 1
): StackOp {
  return {
    kind: 'stack',
    operations: notes.map(n => note(n, duration, velocity)),
    _source: createSource('chord')
  }
}

export function rest(duration: NoteDuration): import('./types').RestOp {
  return {kind: 'rest', duration, _source: createSource('rest')}
}

export function stack(operations: import('./types').ClipOperation[]): StackOp {
  return {kind: 'stack', operations, _source: createSource('stack')}
}

export function tempo(bpm: number, transition?: NoteDuration | import('./types').TempoTransition): import('./types').TempoOp {
  return {kind: 'tempo', bpm, transition, _source: createSource('tempo')}
}

// --- Control Actions ---

/** Sustain pedal (CC64) - on */
export function sustain(): ControlOp {
  return {kind: 'control', controller: 64, value: 127, _source: createSource('sustain')}
}

/** Sustain pedal (CC64) - off */
export function release(): ControlOp {
  return {kind: 'control', controller: 64, value: 0, _source: createSource('release')}
}

/** Generic MIDI Control Change */
export function cc(controller: number, value: number): ControlOp {
  return {kind: 'control', controller, value, _source: createSource('cc')}
}

// --- Expression Actions ---

/** Pitch bend (for string instruments) */
export function bend(semitones: number): PitchBendOp {
  return {kind: 'pitch_bend', semitones, _source: createSource('bend')}
}

/** Modulation wheel (CC1) */
export function modulation(value: number): ControlOp {
  return {kind: 'control', controller: 1, value: Math.round(value * 127), _source: createSource('modulation')}
}

/** Breath control (CC2) - for wind instruments */
export function breath(value: number): ControlOp {
  return {kind: 'control', controller: 2, value: Math.round(value * 127), _source: createSource('breath')}
}

/** Expression (CC11) */
export function expression(value: number): ControlOp {
  return {kind: 'control', controller: 11, value: Math.round(value * 127), _source: createSource('expression')}
}

/** Vibrato LFO control */
export function vibrato(depth: number = 0.5, rate?: number): import('./types').VibratoOp {
  return {kind: 'vibrato', depth, rate, _source: createSource('vibrato')}
}

// --- Automation Actions ---

/**
 * Automate a parameter over time.
 */
export function automation(
  target: import('../automation/types').AutomationTarget,
  value: number,
  rampBeats?: number,
  curve?: 'linear' | 'exponential' | 'smooth'
): import('../automation/types').AutomationOp {
  return {
    kind: 'automation',
    target,
    value,
    rampBeats,
    curve,
    _source: createSource('automation')
  }
}

// --- Drum Actions ---

const DRUM_MAP: Record<string, string> = {
  'kick': 'C1',
  'snare': 'D1',
  'hat': 'F#1',
  'openhat': 'A#1',
  'crash': 'C#2',
  'ride': 'D#2',
  'tom1': 'C2',
  'tom2': 'A1',
  'tom3': 'G1',
  'clap': 'D#1',
  'rim': 'C#1'
}

/** Generic drum hit */
export function hit(drum: string, velocity: number = 1): NoteOp {
  const pitch = DRUM_MAP[drum.toLowerCase()] || drum
  const op = note(pitch as NoteName, '16n', velocity)
  op._source = createSource('hit')
  return op
}

/** Kick drum */
export const kick = (vel = 1): NoteOp => hit('kick', vel)

/** Snare drum */
export const snare = (vel = 1): NoteOp => hit('snare', vel)

/** Hi-hat (closed) */
export const hat = (vel = 1): NoteOp => hit('hat', vel)

/** Hi-hat (open) */
export const openHat = (vel = 1): NoteOp => hit('openhat', vel)

/** Crash cymbal */
export const crash = (vel = 1): NoteOp => hit('crash', vel)

/** Ride cymbal */
export const ride = (vel = 1): NoteOp => hit('ride', vel)

/** Clap */
export const clap = (vel = 1): NoteOp => hit('clap', vel)

/** Tom drums */
export const tom = (which: 1 | 2 | 3 = 1, vel = 1): NoteOp => hit(`tom${which}`, vel)
