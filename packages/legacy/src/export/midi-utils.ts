// =============================================================================
// SymphonyScript - MIDI Export Utilities
// =============================================================================

import type { TempoMap, TempoPoint } from '../compiler/pipeline/types'

// =============================================================================
// Variable Length Quantity (VLQ) Encoding
// =============================================================================

/**
 * Encode a number as a Variable Length Quantity (VLQ).
 * VLQ is MIDI's way of encoding variable-length integers.
 * 
 * Each byte: bit 7 = continuation flag (1 = more bytes follow), bits 0-6 = value
 * Maximum 4 bytes (28-bit value)
 * 
 * @param value - The value to encode (must be non-negative)
 * @returns Uint8Array containing the VLQ bytes
 */
export function writeVLQ(value: number): Uint8Array {
  if (value < 0) {
    throw new Error(`VLQ value must be non-negative: ${value}`)
  }

  // Handle zero case
  if (value === 0) {
    return new Uint8Array([0])
  }

  // Calculate bytes needed (work from LSB to MSB)
  const bytes: number[] = []
  let remaining = value

  // First byte (LSB) has continuation bit = 0
  bytes.unshift(remaining & 0x7F)
  remaining >>>= 7

  // Subsequent bytes have continuation bit = 1
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7F) | 0x80)
    remaining >>>= 7
  }

  return new Uint8Array(bytes)
}

/**
 * Calculate the byte length of a VLQ-encoded value without encoding it.
 */
export function vlqLength(value: number): number {
  if (value < 0x80) return 1
  if (value < 0x4000) return 2
  if (value < 0x200000) return 3
  return 4
}

// =============================================================================
// Time Conversion Utilities
// =============================================================================

/**
 * Convert seconds to ticks using a TempoMap.
 * This handles tempo changes by finding the beat position first.
 * 
 * @param seconds - Absolute time in seconds
 * @param tempoMap - The tempo map from compilation
 * @param ppq - Pulses per quarter note
 * @returns Absolute tick position
 */
export function secondsToTicks(
  seconds: number,
  tempoMap: TempoMap,
  ppq: number
): number {
  // Convert seconds to beats using inverse tempo calculation
  const beats = secondsToBeats(seconds, tempoMap)
  return Math.round(beats * ppq)
}

/**
 * Convert seconds to beats using a TempoMap.
 * This is the inverse of tempoMap.beatToSeconds().
 * 
 * Uses binary search to find the beat position that corresponds to the given seconds.
 * 
 * @param seconds - Absolute time in seconds
 * @param tempoMap - The tempo map from compilation
 * @returns Beat position
 */
export function secondsToBeats(seconds: number, tempoMap: TempoMap): number {
  // Edge case: zero or negative seconds
  if (seconds <= 0) return 0

  // Binary search for the beat position
  // We know: tempoMap.beatToSeconds(beats) should equal seconds
  // Search in range [0, maxBeats] where maxBeats is estimated
  
  // First, estimate a rough upper bound based on average tempo
  const firstBpm = tempoMap.points[0]?.bpm ?? 120
  const roughBeats = (seconds * firstBpm) / 60
  let low = 0
  let high = roughBeats * 2 + 100 // Some buffer for slower tempos

  // Binary search with tolerance
  const tolerance = 0.0001 // Sub-millisecond precision
  const maxIterations = 50

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2
    const midSeconds = tempoMap.beatToSeconds(mid)

    if (Math.abs(midSeconds - seconds) < tolerance) {
      return mid
    }

    if (midSeconds < seconds) {
      low = mid
    } else {
      high = mid
    }
  }

  // Return best estimate
  return (low + high) / 2
}

/**
 * Convert beats to ticks (simple multiplication).
 * 
 * @param beats - Beat position
 * @param ppq - Pulses per quarter note
 * @returns Tick position
 */
export function beatsToTicks(beats: number, ppq: number): number {
  return Math.round(beats * ppq)
}

/**
 * Convert BPM to microseconds per quarter note (for MIDI tempo meta event).
 * 
 * @param bpm - Beats per minute
 * @returns Microseconds per quarter note
 */
export function bpmToMicrosPerBeat(bpm: number): number {
  return Math.round(60_000_000 / bpm)
}

/**
 * Convert microseconds per quarter note to BPM.
 * 
 * @param microsPerBeat - Microseconds per quarter note
 * @returns Beats per minute
 */
export function microsPerBeatToBpm(microsPerBeat: number): number {
  return 60_000_000 / microsPerBeat
}

// =============================================================================
// Binary Writing Utilities
// =============================================================================

/**
 * Write a 16-bit big-endian unsigned integer.
 */
export function writeUint16BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 8) & 0xFF,
    value & 0xFF
  ])
}

/**
 * Write a 32-bit big-endian unsigned integer.
 */
export function writeUint32BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 24) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF
  ])
}

/**
 * Write a 24-bit big-endian unsigned integer (for tempo).
 */
export function writeUint24BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 16) & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF
  ])
}

/**
 * Write ASCII string as bytes.
 */
export function writeAscii(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0x7F
  }
  return bytes
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
export function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// =============================================================================
// MIDI Message Builders
// =============================================================================

/**
 * Build a Note On message.
 * 
 * @param channel - MIDI channel (0-15)
 * @param note - MIDI note number (0-127)
 * @param velocity - Note velocity (0-127)
 */
export function noteOn(channel: number, note: number, velocity: number): Uint8Array {
  return new Uint8Array([
    0x90 | (channel & 0x0F),
    note & 0x7F,
    velocity & 0x7F
  ])
}

/**
 * Build a Note Off message.
 * 
 * @param channel - MIDI channel (0-15)
 * @param note - MIDI note number (0-127)
 * @param velocity - Release velocity (0-127)
 */
export function noteOff(channel: number, note: number, velocity: number = 0): Uint8Array {
  return new Uint8Array([
    0x80 | (channel & 0x0F),
    note & 0x7F,
    velocity & 0x7F
  ])
}

/**
 * Build a Control Change message.
 * 
 * @param channel - MIDI channel (0-15)
 * @param controller - CC number (0-127)
 * @param value - CC value (0-127)
 */
export function controlChange(channel: number, controller: number, value: number): Uint8Array {
  return new Uint8Array([
    0xB0 | (channel & 0x0F),
    controller & 0x7F,
    value & 0x7F
  ])
}

/**
 * Build a Pitch Bend message.
 * MIDI pitch bend is 14-bit (0-16383), centered at 8192.
 * 
 * @param channel - MIDI channel (0-15)
 * @param value - Pitch bend value (0-16383, 8192 = center)
 */
export function pitchBend(channel: number, value: number): Uint8Array {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(16383, value))
  const lsb = clamped & 0x7F
  const msb = (clamped >> 7) & 0x7F
  return new Uint8Array([
    0xE0 | (channel & 0x0F),
    lsb,
    msb
  ])
}

/**
 * Build a Channel Pressure (Aftertouch) message.
 * 
 * @param channel - MIDI channel (0-15)
 * @param pressure - Pressure value (0-127)
 */
export function channelPressure(channel: number, pressure: number): Uint8Array {
  return new Uint8Array([
    0xD0 | (channel & 0x0F),
    pressure & 0x7F
  ])
}

/**
 * Build a Polyphonic Key Pressure (Poly Aftertouch) message.
 * 
 * @param channel - MIDI channel (0-15)
 * @param note - MIDI note number (0-127)
 * @param pressure - Pressure value (0-127)
 */
export function polyPressure(channel: number, note: number, pressure: number): Uint8Array {
  return new Uint8Array([
    0xA0 | (channel & 0x0F),
    note & 0x7F,
    pressure & 0x7F
  ])
}

// =============================================================================
// MIDI Meta Event Builders
// =============================================================================

/**
 * Build a Set Tempo meta event.
 * 
 * @param bpm - Tempo in beats per minute
 */
export function tempoMeta(bpm: number): Uint8Array {
  const microsPerBeat = bpmToMicrosPerBeat(bpm)
  return concatArrays(
    new Uint8Array([0xFF, 0x51, 0x03]), // Meta event, tempo type, length
    writeUint24BE(microsPerBeat)
  )
}

/**
 * Build a Time Signature meta event.
 * 
 * @param numerator - Time signature numerator
 * @param denominator - Time signature denominator (must be power of 2)
 * @param clocksPerClick - MIDI clocks per metronome click (default: 24)
 * @param thirtySecondsPerQuarter - 32nd notes per quarter note (default: 8)
 */
export function timeSignatureMeta(
  numerator: number,
  denominator: number,
  clocksPerClick: number = 24,
  thirtySecondsPerQuarter: number = 8
): Uint8Array {
  // Denominator is encoded as log2(denominator)
  const denomLog2 = Math.log2(denominator)
  if (!Number.isInteger(denomLog2)) {
    throw new Error(`Time signature denominator must be power of 2: ${denominator}`)
  }

  return new Uint8Array([
    0xFF, 0x58, 0x04, // Meta event, time sig type, length
    numerator,
    denomLog2,
    clocksPerClick,
    thirtySecondsPerQuarter
  ])
}

/**
 * Build a Track Name meta event.
 * 
 * @param name - Track name string
 */
export function trackNameMeta(name: string): Uint8Array {
  const nameBytes = writeAscii(name)
  return concatArrays(
    new Uint8Array([0xFF, 0x03]), // Meta event, track name type
    writeVLQ(nameBytes.length),
    nameBytes
  )
}

/**
 * Build an End of Track meta event.
 */
export function endOfTrackMeta(): Uint8Array {
  return new Uint8Array([0xFF, 0x2F, 0x00])
}

/**
 * Build a Copyright meta event.
 * 
 * @param text - Copyright text
 */
export function copyrightMeta(text: string): Uint8Array {
  const textBytes = writeAscii(text)
  return concatArrays(
    new Uint8Array([0xFF, 0x02]),
    writeVLQ(textBytes.length),
    textBytes
  )
}

/**
 * Build a Text meta event.
 * 
 * @param text - Text content
 */
export function textMeta(text: string): Uint8Array {
  const textBytes = writeAscii(text)
  return concatArrays(
    new Uint8Array([0xFF, 0x01]),
    writeVLQ(textBytes.length),
    textBytes
  )
}

// =============================================================================
// Pitch Bend Conversion
// =============================================================================

/**
 * Convert normalized pitch bend (-1 to 1) to MIDI pitch bend (0-16383).
 * 
 * @param normalized - Pitch bend value (-1 = full down, 0 = center, 1 = full up)
 * @returns MIDI pitch bend value (0-16383, 8192 = center)
 */
export function normalizedPitchBendToMidi(normalized: number): number {
  // Clamp to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, normalized))
  // Map to [0, 16383] with 8192 as center
  return Math.round((clamped + 1) * 8191.5)
}

/**
 * Convert MIDI pitch bend (0-16383) to normalized (-1 to 1).
 * 
 * @param midiValue - MIDI pitch bend value (0-16383)
 * @returns Normalized pitch bend (-1 to 1)
 */
export function midiPitchBendToNormalized(midiValue: number): number {
  return (midiValue / 8191.5) - 1
}

// =============================================================================
// Note Name to MIDI Conversion
// =============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_TO_SHARP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B'
}

/**
 * Convert a note name (e.g., "C4", "F#3", "Bb5") to MIDI note number.
 * C4 = 60 (middle C)
 * 
 * @param note - Note name string
 * @returns MIDI note number (0-127) or null if invalid
 */
export function noteNameToMidi(note: string): number | null {
  // Match note name with optional sharp/flat and octave
  // Supports: C4, C#4, Db4, Bb3, F#5, etc.
  const match = note.match(/^([A-Ga-g])([#b]?)(-?\d+)$/)
  if (!match) return null

  const baseName = match[1].toUpperCase()
  const accidental = match[2]
  const octave = parseInt(match[3], 10)

  // Build the full note name
  let name = baseName + accidental

  // Convert flats to sharps for consistency
  if (FLAT_TO_SHARP[name]) {
    name = FLAT_TO_SHARP[name]
  }

  const noteIndex = NOTE_NAMES.indexOf(name)
  if (noteIndex === -1) return null

  // MIDI: C4 = 60, C0 = 12, C-1 = 0
  return (octave + 1) * 12 + noteIndex
}
