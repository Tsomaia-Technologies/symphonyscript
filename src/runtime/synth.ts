/**
 * Basic synthesis using Web Audio API.
 */

import {createRandom} from '../util/random'
import type {CompiledEvent} from '../compiler/pipeline/types'

export interface SynthConfig {
  audioContext: AudioContext
  destination: AudioNode
  seed?: number
}

export interface ADSR {
  attack: number
  decay: number
  sustain: number  // 0-1 level
  release: number
}

const DEFAULT_ADSR: ADSR = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2
}

/**
 * Play a note using oscillator + gain envelope.
 */
export function playNote(
  config: SynthConfig,
  pitch: string,
  startTime: number,
  duration: number,
  velocity: number = 1,
  adsr: ADSR = DEFAULT_ADSR
): void {
  const {audioContext, destination} = config

  const frequency = pitchToFrequency(pitch)
  if (frequency === 0) return // Invalid pitch

  // Create oscillator
  const osc = audioContext.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = frequency

  // Create gain for envelope
  const gain = audioContext.createGain()
  gain.gain.value = 0

  // Connect: osc -> gain -> destination
  osc.connect(gain)
  gain.connect(destination)

  // ADSR envelope
  const peakGain = velocity * 0.3 // Scale velocity to reasonable level
  const sustainGain = peakGain * adsr.sustain

  // Attack
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(peakGain, startTime + adsr.attack)

  // Decay to sustain
  gain.gain.linearRampToValueAtTime(sustainGain, startTime + adsr.attack + adsr.decay)

  // Hold sustain, then release
  // Ensure release starts before note end if duration is short
  const releaseStart = Math.max(startTime + adsr.attack + adsr.decay, startTime + duration - adsr.release)
  gain.gain.setValueAtTime(sustainGain, releaseStart)
  gain.gain.linearRampToValueAtTime(0, startTime + duration)

  // Start and stop
  osc.start(startTime)
  osc.stop(startTime + duration + 0.1) // Small buffer for release tail
}

/**
 * Simple kick drum synthesis.
 */
export function playKick(
  config: SynthConfig,
  startTime: number,
  velocity: number = 1
): void {
  const {audioContext, destination} = config

  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, startTime)
  osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.1)

  gain.gain.setValueAtTime(velocity * 0.8, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3)

  osc.connect(gain)
  gain.connect(destination)

  osc.start(startTime)
  osc.stop(startTime + 0.3)
}

/**
 * Simple snare drum synthesis (noise + tone).
 */
export function playSnare(
  config: SynthConfig,
  startTime: number,
  velocity: number = 1
): void {
  const {audioContext, destination, seed} = config

  // Noise component
  // If seed provided, mix it with a salt so snare is unique from hat
  const baseSeed = seed !== undefined ? seed : 12345
  const rng = createRandom(baseSeed ^ 0xFEED)

  const bufferSize = audioContext.sampleRate * 0.2
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = rng.next() * 2 - 1
  }

  const noise = audioContext.createBufferSource()
  noise.buffer = buffer

  const noiseGain = audioContext.createGain()
  noiseGain.gain.setValueAtTime(velocity * 0.3, startTime)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2)

  // Tone component
  const osc = audioContext.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = 180

  const oscGain = audioContext.createGain()
  oscGain.gain.setValueAtTime(velocity * 0.5, startTime)
  oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1)

  // Connect
  noise.connect(noiseGain)
  noiseGain.connect(destination)
  osc.connect(oscGain)
  oscGain.connect(destination)

  noise.start(startTime)
  noise.stop(startTime + 0.2)
  osc.start(startTime)
  osc.stop(startTime + 0.1)
}

/**
 * Simple hi-hat synthesis (filtered noise).
 */
export function playHiHat(
  config: SynthConfig,
  startTime: number,
  velocity: number = 1,
  open: boolean = false
): void {
  const {audioContext, destination, seed} = config

  const duration = open ? 0.3 : 0.05
  // If seed provided, mix it with a salt
  const baseSeed = seed !== undefined ? seed : 67890
  const rng = createRandom(baseSeed ^ 0xBEEF)

  const bufferSize = audioContext.sampleRate * duration
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = rng.next() * 2 - 1
  }

  const noise = audioContext.createBufferSource()
  noise.buffer = buffer

  const filter = audioContext.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 7000

  const gain = audioContext.createGain()
  gain.gain.setValueAtTime(velocity * 0.2, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

  noise.connect(filter)
  filter.connect(gain)
  gain.connect(destination)

  noise.start(startTime)
  noise.stop(startTime + duration)
}

/**
 * Convert pitch string to frequency.
 */
export function pitchToFrequency(pitch: string): number {
  const match = pitch.match(/^([A-Ga-g])([#b]?)(\/-?\d+|)$/)
  // Simple regex for note parsing, robust version would be shared with compiler
  const match2 = pitch.match(/^([A-Ga-g])([#b]?)(\d+)$/)

  if (!match2) return 0

  const noteMap: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
  }

  const letter = match2[1].toUpperCase()
  const accidental = match2[2]
  const octave = parseInt(match2[3], 10)

  let semitone = noteMap[letter]
  if (accidental === '#') semitone++
  if (accidental === 'b') semitone--

  // MIDI note number (A4 = 69 = 440Hz)
  const midiNote = semitone + (octave + 1) * 12

  // Frequency: 440 * 2^((midiNote - 69) / 12)
  return 440 * Math.pow(2, (midiNote - 69) / 12)
}

/**
 * Dispatch event to appropriate synth.
 */
export function scheduleEvent(
  config: SynthConfig,
  event: CompiledEvent,
  audioTime: number
): void {
  if (event.kind !== 'note') return

  const pitch = event.payload?.pitch as string
  if (!pitch) return

  const duration = event.durationSeconds ?? 0.25
  const velocity = (event.payload?.velocity as number) ?? 1

  // Check for drum sounds
  const lowerPitch = pitch.toLowerCase()
  if (lowerPitch.includes('kick')) {
    playKick(config, audioTime, velocity)
  } else if (lowerPitch.includes('snare') || lowerPitch.includes('clap')) {
    playSnare(config, audioTime, velocity)
  } else if (lowerPitch.includes('hat') || lowerPitch.includes('hihat')) {
    playHiHat(config, audioTime, velocity, lowerPitch.includes('open'))
  } else {
    // Melodic note
    playNote(config, pitch, audioTime, duration, velocity)
  }
}
