// =============================================================================
// SymphonyScript - Voice Leading
// =============================================================================

import type { VoiceLeadOptions } from './types'
import type { NoteName } from '../types/primitives'
import { noteToMidi, midiToNote } from '../util/midi'

/**
 * Apply voice leading to minimize voice movement between chords.
 * 
 * Each voice moves to the closest available pitch in the next chord.
 * This creates smooth, connected chord progressions.
 * 
 * @param chordSequence - Array of chords (each chord is an array of NoteName)
 * @param options - Voice leading options
 * @returns Voice-led chord sequence with minimized movement
 */
export function voiceLeadChords(
  chordSequence: NoteName[][],
  options: VoiceLeadOptions = {}
): NoteName[][] {
  const { voices = 4, style = 'close' } = options

  if (chordSequence.length === 0) return []
  if (chordSequence.length === 1) return [chordSequence[0]]

  const result: NoteName[][] = []
  
  // First chord establishes the voicing
  let previousVoicing = closeVoicing(chordSequence[0], voices)
  result.push(previousVoicing)

  // Voice lead subsequent chords
  for (let i = 1; i < chordSequence.length; i++) {
    const nextChord = chordSequence[i]
    const nextVoicing = leadToNextChord(previousVoicing, nextChord, style)
    result.push(nextVoicing)
    previousVoicing = nextVoicing
  }

  return result
}

/**
 * Create a close voicing for a chord.
 * Notes are within one octave, centered around middle C (C4).
 */
function closeVoicing(chord: NoteName[], voices: number): NoteName[] {
  // Convert to MIDI, sort, and arrange in close position
  const midiNotes = chord
    .map(n => noteToMidi(n))
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b)

  if (midiNotes.length === 0) return []

  // Center around middle C (MIDI 60)
  const centerMidi = 60
  
  // Move all notes to be close to center
  const voiced = midiNotes.map(m => {
    // Bring to same octave range
    let adjusted = m
    while (adjusted < centerMidi - 6) adjusted += 12
    while (adjusted > centerMidi + 12) adjusted -= 12
    return adjusted
  })

  // Sort again and ensure voices count
  voiced.sort((a, b) => a - b)
  
  // Pad or trim to requested voice count
  while (voiced.length < voices && voiced.length > 0) {
    // Double bass note an octave down
    voiced.unshift(voiced[0] - 12)
  }
  while (voiced.length > voices) {
    voiced.pop()
  }

  return voiced.map(m => midiToNote(m) as NoteName)
}

/**
 * Voice lead from previous chord to next chord.
 * Each voice moves to the closest note in the next chord.
 */
function leadToNextChord(
  previous: NoteName[],
  nextChord: NoteName[],
  _style: 'close' | 'open' | 'drop2'
): NoteName[] {
  const prevMidi = previous
    .map(n => noteToMidi(n))
    .filter((m): m is number => m !== null)

  const targetMidi = nextChord
    .map(n => noteToMidi(n))
    .filter((m): m is number => m !== null)

  if (prevMidi.length === 0 || targetMidi.length === 0) {
    return nextChord
  }

  // For each voice in previous, find closest target
  const result: number[] = []
  const usedTargets = new Set<number>()

  // Generate all possible octave variants for targets
  const targetVariants: number[] = []
  for (const t of targetMidi) {
    for (let octave = -2; octave <= 2; octave++) {
      targetVariants.push(t + octave * 12)
    }
  }

  // For each previous voice, find closest available target
  for (const pv of prevMidi) {
    let closest: number | null = null
    let minDistance = Infinity

    for (const tv of targetVariants) {
      // Check pitch class matches one of the target notes
      const pitchClass = ((tv % 12) + 12) % 12
      const isValidTarget = targetMidi.some(t => ((t % 12) + 12) % 12 === pitchClass)
      
      if (!isValidTarget) continue
      
      // Check not already used
      const key = tv
      if (usedTargets.has(key)) continue

      const distance = Math.abs(tv - pv)
      if (distance < minDistance) {
        minDistance = distance
        closest = tv
      }
    }

    if (closest !== null) {
      result.push(closest)
      usedTargets.add(closest)
    }
  }

  // Fill in any remaining voices needed
  while (result.length < prevMidi.length) {
    for (const tv of targetVariants) {
      if (!usedTargets.has(tv)) {
        result.push(tv)
        usedTargets.add(tv)
        break
      }
    }
  }

  result.sort((a, b) => a - b)
  return result.map(m => midiToNote(m) as NoteName)
}

/**
 * Calculate total voice movement distance in semitones.
 * Lower = smoother voice leading.
 */
export function voiceMovementDistance(from: NoteName[], to: NoteName[]): number {
  const fromMidi = from.map(n => noteToMidi(n)).filter((m): m is number => m !== null)
  const toMidi = to.map(n => noteToMidi(n)).filter((m): m is number => m !== null)

  if (fromMidi.length !== toMidi.length) {
    // Can't compare different voice counts
    return Infinity
  }

  fromMidi.sort((a, b) => a - b)
  toMidi.sort((a, b) => a - b)

  let total = 0
  for (let i = 0; i < fromMidi.length; i++) {
    total += Math.abs(toMidi[i] - fromMidi[i])
  }

  return total
}
