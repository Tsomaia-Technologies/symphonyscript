// =============================================================================
// SymphonyScript - MIDI Binary Parser (Zero Dependencies)
// Standard MIDI File (SMF) Parser
// =============================================================================

// --- MIDI File Structure Types ---

export interface MidiFile {
  /** SMF format: 0 (single track), 1 (multi-track sync), 2 (multi-track async) */
  format: 0 | 1 | 2
  /** Number of tracks in the file */
  trackCount: number
  /** Pulses (ticks) per quarter note */
  ppq: number
  /** Parsed tracks */
  tracks: MidiTrack[]
}

export interface MidiTrack {
  /** Track name from meta event (if present) */
  name?: string
  /** All events in this track, sorted by absolute tick */
  events: MidiEvent[]
}

// --- MIDI Event Types ---

export type MidiEvent =
  | MidiNoteOnEvent
  | MidiNoteOffEvent
  | MidiControlChangeEvent
  | MidiProgramChangeEvent
  | MidiPitchBendEvent
  | MidiChannelPressureEvent
  | MidiMetaEvent

interface BaseMidiEvent {
  /** Absolute tick position (accumulated delta times) */
  tick: number
  /** MIDI channel (0-15) */
  channel: number
}

export interface MidiNoteOnEvent extends BaseMidiEvent {
  type: 'note_on'
  note: number    // 0-127
  velocity: number // 0-127 (velocity 0 = note off)
}

export interface MidiNoteOffEvent extends BaseMidiEvent {
  type: 'note_off'
  note: number    // 0-127
  velocity: number // 0-127 (release velocity)
}

export interface MidiControlChangeEvent extends BaseMidiEvent {
  type: 'control_change'
  controller: number // 0-127
  value: number      // 0-127
}

export interface MidiProgramChangeEvent extends BaseMidiEvent {
  type: 'program_change'
  program: number // 0-127
}

export interface MidiPitchBendEvent extends BaseMidiEvent {
  type: 'pitch_bend'
  /** Pitch bend value: 0-16383 (8192 = center/no bend) */
  value: number
}

export interface MidiChannelPressureEvent extends BaseMidiEvent {
  type: 'channel_pressure'
  pressure: number // 0-127
}

export interface MidiMetaEvent {
  type: 'meta'
  tick: number
  channel: -1 // Meta events are not channel-specific
  metaType: number
  data: Uint8Array
  /** Decoded text for text-type meta events */
  text?: string
}

// --- Meta Event Types ---
export const META_SEQUENCE_NUMBER = 0x00
export const META_TEXT = 0x01
export const META_COPYRIGHT = 0x02
export const META_TRACK_NAME = 0x03
export const META_INSTRUMENT_NAME = 0x04
export const META_LYRIC = 0x05
export const META_MARKER = 0x06
export const META_CUE_POINT = 0x07
export const META_CHANNEL_PREFIX = 0x20
export const META_END_OF_TRACK = 0x2F
export const META_SET_TEMPO = 0x51
export const META_SMPTE_OFFSET = 0x54
export const META_TIME_SIGNATURE = 0x58
export const META_KEY_SIGNATURE = 0x59

// --- Parser Implementation ---

/**
 * Parse a Standard MIDI File from an ArrayBuffer.
 * Supports SMF formats 0, 1, and 2.
 * 
 * @param buffer - Raw MIDI file data
 * @returns Parsed MIDI file structure
 * @throws Error if the file is invalid or corrupt
 */
export function parseMidiBuffer(buffer: ArrayBuffer): MidiFile {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  // --- Parse Header Chunk (MThd) ---
  const headerChunkId = readChunkId(bytes, offset)
  if (headerChunkId !== 'MThd') {
    throw new Error(`Invalid MIDI file: expected 'MThd' header, got '${headerChunkId}'`)
  }
  offset += 4

  const headerLength = view.getUint32(offset, false)
  offset += 4

  if (headerLength < 6) {
    throw new Error(`Invalid MIDI header length: ${headerLength}`)
  }

  const format = view.getUint16(offset, false) as 0 | 1 | 2
  offset += 2

  if (format > 2) {
    throw new Error(`Unsupported MIDI format: ${format}`)
  }

  const trackCount = view.getUint16(offset, false)
  offset += 2

  const timeDivision = view.getUint16(offset, false)
  offset += 2

  // Check if using SMPTE timing (bit 15 set)
  if (timeDivision & 0x8000) {
    throw new Error('SMPTE timing is not supported, only PPQ (ticks per quarter note)')
  }

  const ppq = timeDivision

  // Skip any extra header bytes (some files have extended headers)
  offset += headerLength - 6

  // --- Parse Track Chunks (MTrk) ---
  const tracks: MidiTrack[] = []

  for (let i = 0; i < trackCount; i++) {
    if (offset >= bytes.length) {
      throw new Error(`Unexpected end of file: expected ${trackCount} tracks, found ${i}`)
    }

    const trackChunkId = readChunkId(bytes, offset)
    if (trackChunkId !== 'MTrk') {
      throw new Error(`Invalid track chunk: expected 'MTrk', got '${trackChunkId}' at offset ${offset}`)
    }
    offset += 4

    const trackLength = view.getUint32(offset, false)
    offset += 4

    const trackEnd = offset + trackLength
    if (trackEnd > bytes.length) {
      throw new Error(`Track ${i} extends beyond file: needs ${trackEnd}, have ${bytes.length}`)
    }

    const track = parseTrack(bytes, offset, trackEnd)
    tracks.push(track)

    offset = trackEnd
  }

  return {
    format,
    trackCount,
    ppq,
    tracks
  }
}

/**
 * Parse a single MIDI track.
 */
function parseTrack(bytes: Uint8Array, start: number, end: number): MidiTrack {
  const events: MidiEvent[] = []
  let offset = start
  let absoluteTick = 0
  let runningStatus = 0
  let trackName: string | undefined

  while (offset < end) {
    // Read delta time (VLQ)
    const deltaResult = readVLQ(bytes, offset)
    absoluteTick += deltaResult.value
    offset += deltaResult.bytesRead

    if (offset >= end) break

    // Read status byte (or use running status)
    let status = bytes[offset]

    // Check for running status (status byte < 0x80 means reuse previous status)
    if (status < 0x80) {
      if (runningStatus === 0) {
        throw new Error(`Invalid running status at offset ${offset}`)
      }
      status = runningStatus
      // Don't advance offset - the byte we read is data, not status
    } else {
      offset++
      // Running status only applies to channel messages (0x80-0xEF)
      if (status >= 0x80 && status < 0xF0) {
        runningStatus = status
      } else {
        runningStatus = 0 // Clear running status for system messages
      }
    }

    const channel = status & 0x0F
    const messageType = status & 0xF0

    // --- Parse Message ---
    if (status === 0xFF) {
      // Meta Event
      const metaType = bytes[offset++]
      const lengthResult = readVLQ(bytes, offset)
      offset += lengthResult.bytesRead
      const data = bytes.slice(offset, offset + lengthResult.value)
      offset += lengthResult.value

      const event: MidiMetaEvent = {
        type: 'meta',
        tick: absoluteTick,
        channel: -1,
        metaType,
        data
      }

      // Decode text for text-type meta events
      if (metaType >= 0x01 && metaType <= 0x07) {
        event.text = decodeText(data)
        if (metaType === META_TRACK_NAME) {
          trackName = event.text
        }
      }

      events.push(event)

      // End of track
      if (metaType === META_END_OF_TRACK) {
        break
      }
    } else if (status === 0xF0 || status === 0xF7) {
      // SysEx - skip
      const lengthResult = readVLQ(bytes, offset)
      offset += lengthResult.bytesRead + lengthResult.value
    } else {
      // Channel Message
      switch (messageType) {
        case 0x80: // Note Off
          events.push({
            type: 'note_off',
            tick: absoluteTick,
            channel,
            note: bytes[offset++],
            velocity: bytes[offset++]
          })
          break

        case 0x90: // Note On
          const noteOnNote = bytes[offset++]
          const noteOnVelocity = bytes[offset++]
          // Note: velocity 0 is treated as note off by some MIDI implementations
          // We preserve it as note_on here; the converter can handle it
          events.push({
            type: 'note_on',
            tick: absoluteTick,
            channel,
            note: noteOnNote,
            velocity: noteOnVelocity
          })
          break

        case 0xA0: // Polyphonic Aftertouch - skip
          offset += 2
          break

        case 0xB0: // Control Change
          events.push({
            type: 'control_change',
            tick: absoluteTick,
            channel,
            controller: bytes[offset++],
            value: bytes[offset++]
          })
          break

        case 0xC0: // Program Change
          events.push({
            type: 'program_change',
            tick: absoluteTick,
            channel,
            program: bytes[offset++]
          })
          break

        case 0xD0: // Channel Pressure (Aftertouch)
          events.push({
            type: 'channel_pressure',
            tick: absoluteTick,
            channel,
            pressure: bytes[offset++]
          })
          break

        case 0xE0: // Pitch Bend
          const lsb = bytes[offset++]
          const msb = bytes[offset++]
          events.push({
            type: 'pitch_bend',
            tick: absoluteTick,
            channel,
            value: (msb << 7) | lsb
          })
          break

        default:
          // Unknown message - try to skip
          console.warn(`Unknown MIDI message type: 0x${messageType.toString(16)} at offset ${offset}`)
          break
      }
    }
  }

  return {
    name: trackName,
    events
  }
}

/**
 * Read a Variable Length Quantity (VLQ) from the byte array.
 * VLQ is MIDI's way of encoding variable-length integers.
 */
export function readVLQ(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0
  let bytesRead = 0

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]
    bytesRead++

    value = (value << 7) | (byte & 0x7F)

    // If MSB is 0, this is the last byte
    if ((byte & 0x80) === 0) {
      break
    }

    // Safety check to prevent infinite loops
    if (bytesRead > 4) {
      throw new Error(`Invalid VLQ: too many bytes at offset ${offset}`)
    }
  }

  return { value, bytesRead }
}

/**
 * Read a 4-character chunk ID from the byte array.
 */
function readChunkId(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  )
}

/**
 * Decode a byte array as text (ASCII/Latin-1).
 */
function decodeText(data: Uint8Array): string {
  let text = ''
  for (let i = 0; i < data.length; i++) {
    text += String.fromCharCode(data[i])
  }
  return text
}

// --- Utility Functions for Meta Events ---

/**
 * Extract tempo (microseconds per quarter note) from a SET_TEMPO meta event.
 */
export function extractTempo(event: MidiMetaEvent): number | null {
  if (event.metaType !== META_SET_TEMPO || event.data.length !== 3) {
    return null
  }
  return (event.data[0] << 16) | (event.data[1] << 8) | event.data[2]
}

/**
 * Convert microseconds per quarter note to BPM.
 */
export function microsecondsPerBeatToBPM(uspb: number): number {
  return 60_000_000 / uspb
}

/**
 * Extract time signature from a TIME_SIGNATURE meta event.
 * Returns [numerator, denominator] or null if invalid.
 */
export function extractTimeSignature(event: MidiMetaEvent): [number, number] | null {
  if (event.metaType !== META_TIME_SIGNATURE || event.data.length < 2) {
    return null
  }
  const numerator = event.data[0]
  const denominatorPower = event.data[1]
  const denominator = Math.pow(2, denominatorPower)
  return [numerator, denominator]
}
