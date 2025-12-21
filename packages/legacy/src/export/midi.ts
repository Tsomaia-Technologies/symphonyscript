// =============================================================================
// SymphonyScript - MIDI File Export
// =============================================================================

import type { CompiledClip, CompiledEvent, TempoMap } from '../compiler/pipeline/types'
import type { CompiledOutput, AudioEvent, NoteOnEvent, ControlEvent, PitchBendEvent, AftertouchEvent, TempoEvent } from '../compiler/types'
import type { MidiExportInput, MidiExportOptions, MidiExportResult, MidiTrackEvent, MidiTrackData } from './types'
import { isCompiledClip, isCompiledOutput } from './types'
import {
  writeVLQ,
  writeUint16BE,
  writeUint32BE,
  writeAscii,
  concatArrays,
  secondsToTicks,
  noteOn,
  noteOff,
  controlChange,
  pitchBend,
  channelPressure,
  polyPressure,
  tempoMeta,
  timeSignatureMeta,
  trackNameMeta,
  endOfTrackMeta,
  noteNameToMidi,
  normalizedPitchBendToMidi
} from './midi-utils'
import { buildTempoMap } from '../compiler/pipeline/tempo-map'

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_OPTIONS: Required<MidiExportOptions> = {
  format: 1,
  ppq: 480,
  includeTempoTrack: true,
  includeTimeSignatures: true,
  includeTrackNames: true
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Export a CompiledClip or CompiledOutput to a Standard MIDI File (SMF).
 * 
 * @param input - CompiledClip (single clip) or CompiledOutput (full session)
 * @param options - Export options
 * @returns MidiExportResult with ArrayBuffer containing the MIDI file
 * 
 * @example
 * ```typescript
 * const { output } = compile(session, { bpm: 120 })
 * const { buffer } = exportMidi(output)
 * // Save buffer to file or send to DAW
 * ```
 */
export function exportMidi(
  input: MidiExportInput,
  options: MidiExportOptions = {}
): MidiExportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (isCompiledClip(input)) {
    return exportCompiledClip(input, opts)
  } else if (isCompiledOutput(input)) {
    return exportCompiledOutput(input, opts)
  } else {
    throw new Error('Invalid input: expected CompiledClip or CompiledOutput')
  }
}

// =============================================================================
// CompiledClip Export
// =============================================================================

function exportCompiledClip(
  clip: CompiledClip,
  options: Required<MidiExportOptions>
): MidiExportResult {
  const { ppq, format, includeTempoTrack, includeTimeSignatures } = options

  // Group events by channel
  const channelEvents = groupEventsByChannel(clip.events, clip.tempoMap, ppq)

  // Build tracks
  const tracks: MidiTrackData[] = []

  // Format 1: Add conductor track with tempo/time sig
  if (format === 1 && includeTempoTrack) {
    const conductorTrack = buildConductorTrack(clip, ppq, includeTimeSignatures)
    tracks.push(conductorTrack)
  }

  // Add note tracks
  for (const [channel, events] of channelEvents) {
    tracks.push({
      name: `Track ${channel + 1}`,
      channel,
      events
    })
  }

  // Format 0: Merge all tracks into one
  if (format === 0 && tracks.length > 1) {
    const merged = mergeTracks(tracks)
    tracks.length = 0
    tracks.push(merged)
  }

  // Calculate duration
  const durationTicks = secondsToTicks(clip.durationSeconds, clip.tempoMap, ppq)

  // Build MIDI file
  const buffer = buildMidiFile(tracks, format, ppq, options)

  return {
    buffer,
    trackCount: tracks.length,
    durationTicks,
    ppq
  }
}

// =============================================================================
// CompiledOutput Export
// =============================================================================

function exportCompiledOutput(
  output: CompiledOutput,
  options: Required<MidiExportOptions>
): MidiExportResult {
  const { ppq, format, includeTempoTrack, includeTimeSignatures, includeTrackNames } = options

  // Create a simple tempo map from meta
  const tempoMap = createTempoMapFromMeta(output)

  // Group timeline events by instrumentId/channel
  const trackGroups = groupTimelineByInstrument(output.timeline, tempoMap, ppq)

  // Build tracks
  const tracks: MidiTrackData[] = []

  // Format 1: Add conductor track
  if (format === 1 && includeTempoTrack) {
    const conductorTrack = buildConductorTrackFromOutput(output, tempoMap, ppq, includeTimeSignatures)
    tracks.push(conductorTrack)
  }

  // Add instrument tracks
  let channelIndex = 0
  for (const [instrumentId, events] of trackGroups) {
    const instrumentConfig = output.manifest[instrumentId as import('../../../../symphonyscript/packages/core/src/types/primitives').InstrumentId] as any
    const instrumentName = instrumentConfig?.name ?? instrumentId
    tracks.push({
      name: includeTrackNames ? instrumentName : undefined,
      channel: channelIndex % 16, // Cycle through 16 MIDI channels
      events
    })
    channelIndex++
  }

  // Format 0: Merge all tracks
  if (format === 0 && tracks.length > 1) {
    const merged = mergeTracks(tracks)
    tracks.length = 0
    tracks.push(merged)
  }

  // Calculate duration
  const durationTicks = secondsToTicks(output.meta.durationSeconds, tempoMap, ppq)

  // Build MIDI file
  const buffer = buildMidiFile(tracks, format, ppq, options)

  return {
    buffer,
    trackCount: tracks.length,
    durationTicks,
    ppq
  }
}

// =============================================================================
// Event Grouping
// =============================================================================

function groupEventsByChannel(
  events: CompiledEvent[],
  tempoMap: TempoMap,
  ppq: number
): Map<number, MidiTrackEvent[]> {
  const groups = new Map<number, MidiTrackEvent[]>()

  for (const event of events) {
    const channel = (event.channel ?? 1) - 1 // Convert 1-16 to 0-15

    if (!groups.has(channel)) {
      groups.set(channel, [])
    }

    const midiEvents = convertCompiledEvent(event, channel, tempoMap, ppq)
    groups.get(channel)!.push(...midiEvents)
  }

  // Sort each channel's events by tick
  for (const [, channelEvents] of groups) {
    channelEvents.sort((a, b) => a.tick - b.tick)
  }

  return groups
}

function groupTimelineByInstrument(
  timeline: AudioEvent[],
  tempoMap: TempoMap,
  ppq: number
): Map<string, MidiTrackEvent[]> {
  const groups = new Map<string, MidiTrackEvent[]>()

  for (const event of timeline) {
    if (!('instrumentId' in event)) continue

    const instrumentId = event.instrumentId as string

    if (!groups.has(instrumentId)) {
      groups.set(instrumentId, [])
    }

    const midiEvents = convertAudioEvent(event, 0, tempoMap, ppq)
    groups.get(instrumentId)!.push(...midiEvents)
  }

  // Sort each group's events by tick
  for (const [, groupEvents] of groups) {
    groupEvents.sort((a, b) => a.tick - b.tick)
  }

  return groups
}

// =============================================================================
// Event Conversion
// =============================================================================

function convertCompiledEvent(
  event: CompiledEvent,
  channel: number,
  tempoMap: TempoMap,
  ppq: number
): MidiTrackEvent[] {
  const tick = secondsToTicks(event.startSeconds, tempoMap, ppq)
  const results: MidiTrackEvent[] = []

  switch (event.kind) {
    case 'note': {
      const midiNote = noteNameToMidi(event.payload.pitch as string)
      if (midiNote === null) break

      const velocity = Math.round((event.payload.velocity as number))
      
      // Detune → pitch bend (before note on)
      // Detune is in cents, pitch bend range is typically ±200 cents (±2 semitones)
      const detuneCents = event.payload.detune as number | undefined
      if (detuneCents && detuneCents !== 0) {
        // Normalize to -1..+1 range (assuming ±200 cents = full range)
        const normalized = Math.max(-1, Math.min(1, detuneCents / 200))
        const midiValue = normalizedPitchBendToMidi(normalized)
        results.push({
          tick,
          data: pitchBend(channel, midiValue)
        })
      }

      // Note On
      results.push({
        tick,
        data: noteOn(channel, midiNote, velocity)
      })

      // Note Off
      const offTick = secondsToTicks(event.startSeconds + event.durationSeconds, tempoMap, ppq)
      results.push({
        tick: offTick,
        data: noteOff(channel, midiNote, 0)
      })
      
      // Reset pitch bend (after note off) if detune was applied
      if (detuneCents && detuneCents !== 0) {
        results.push({
          tick: offTick,
          data: pitchBend(channel, 8192) // Center = no bend
        })
      }
      break
    }

    case 'control': {
      results.push({
        tick,
        data: controlChange(channel, event.payload.controller as number, event.payload.value as number)
      })
      break
    }

    case 'pitch_bend': {
      // Convert 0-127 to 0-16383 (MIDI pitch bend is 14-bit)
      const value = Math.round((event.payload.value as number) * 128.5)
      results.push({
        tick,
        data: pitchBend(channel, value)
      })
      break
    }

    case 'aftertouch': {
      if (event.payload.type === 'channel') {
        results.push({
          tick,
          data: channelPressure(channel, event.payload.value as number)
        })
      } else if (event.payload.type === 'poly' && event.payload.note) {
        const midiNote = noteNameToMidi(event.payload.note as string)
        if (midiNote !== null) {
          results.push({
            tick,
            data: polyPressure(channel, midiNote, event.payload.value as number)
          })
        }
      }
      break
    }

    // Tempo and articulation events are handled in conductor track
    case 'tempo':
    case 'articulation':
    case 'automation':
      break
  }

  return results
}

function convertAudioEvent(
  event: AudioEvent,
  channel: number,
  tempoMap: TempoMap,
  ppq: number
): MidiTrackEvent[] {
  const tick = secondsToTicks(event.time, tempoMap, ppq)
  const results: MidiTrackEvent[] = []

  switch (event.kind) {
    case 'note_on': {
      const noteEvent = event as NoteOnEvent
      const midiNote = noteNameToMidi(noteEvent.note as string)
      if (midiNote === null) break

      const velocity = Math.round(noteEvent.velocity * 127)

      // Note On
      results.push({
        tick,
        data: noteOn(channel, midiNote, velocity)
      })

      // Note Off
      const offTick = secondsToTicks(event.time + noteEvent.duration, tempoMap, ppq)
      results.push({
        tick: offTick,
        data: noteOff(channel, midiNote, 0)
      })
      break
    }

    case 'control': {
      const ctrlEvent = event as ControlEvent
      results.push({
        tick,
        data: controlChange(channel, ctrlEvent.controller, ctrlEvent.value)
      })
      break
    }

    case 'pitch_bend': {
      const bendEvent = event as PitchBendEvent
      // Convert normalized (-1 to 1) to MIDI (0-16383)
      const midiValue = normalizedPitchBendToMidi(bendEvent.value)
      results.push({
        tick,
        data: pitchBend(channel, midiValue)
      })
      break
    }

    case 'aftertouch': {
      const atEvent = event as AftertouchEvent
      if (atEvent.type === 'channel') {
        results.push({
          tick,
          data: channelPressure(channel, atEvent.value)
        })
      } else if (atEvent.type === 'poly' && atEvent.note) {
        const midiNote = noteNameToMidi(atEvent.note as string)
        if (midiNote !== null) {
          results.push({
            tick,
            data: polyPressure(channel, midiNote, atEvent.value)
          })
        }
      }
      break
    }

    // Tempo events handled in conductor track
    case 'tempo':
    case 'note_off':
    case 'automation':
      break
  }

  return results
}

// =============================================================================
// Conductor Track (Tempo & Time Signature)
// =============================================================================

function buildConductorTrack(
  clip: CompiledClip,
  ppq: number,
  includeTimeSignatures: boolean
): MidiTrackData {
  const events: MidiTrackEvent[] = []

  // Add initial tempo
  const initialBpm = clip.tempoMap.getBpmAt(0)
  events.push({
    tick: 0,
    data: tempoMeta(initialBpm)
  })

  // Add initial time signature (default 4/4 if not specified)
  if (includeTimeSignatures) {
    events.push({
      tick: 0,
      data: timeSignatureMeta(4, 4)
    })
  }

  // Add tempo changes from events
  for (const event of clip.events) {
    if (event.kind === 'tempo') {
      const tick = secondsToTicks(event.startSeconds, clip.tempoMap, ppq)
      events.push({
        tick,
        data: tempoMeta(event.payload.bpm)
      })
    }
  }

  // Sort by tick
  events.sort((a, b) => a.tick - b.tick)

  return {
    name: 'Conductor',
    channel: 0,
    events
  }
}

function buildConductorTrackFromOutput(
  output: CompiledOutput,
  tempoMap: TempoMap,
  ppq: number,
  includeTimeSignatures: boolean
): MidiTrackData {
  const events: MidiTrackEvent[] = []

  // Add initial tempo
  events.push({
    tick: 0,
    data: tempoMeta(output.meta.bpm)
  })

  // Add initial time signature
  if (includeTimeSignatures) {
    const [num, denom] = parseTimeSignature(output.meta.timeSignature)
    events.push({
      tick: 0,
      data: timeSignatureMeta(num, denom)
    })
  }

  // Add tempo changes
  for (const change of output.meta.tempoChanges) {
    const tick = secondsToTicks(change.atSecond, tempoMap, ppq)
    events.push({
      tick,
      data: tempoMeta(change.bpm)
    })
  }

  // Sort by tick
  events.sort((a, b) => a.tick - b.tick)

  return {
    name: 'Conductor',
    channel: 0,
    events
  }
}

// =============================================================================
// Track Merging (Format 0)
// =============================================================================

function mergeTracks(tracks: MidiTrackData[]): MidiTrackData {
  const allEvents: MidiTrackEvent[] = []

  for (const track of tracks) {
    allEvents.push(...track.events)
  }

  // Sort by tick
  allEvents.sort((a, b) => a.tick - b.tick)

  return {
    name: 'Merged',
    channel: 0,
    events: allEvents
  }
}

// =============================================================================
// MIDI File Building
// =============================================================================

function buildMidiFile(
  tracks: MidiTrackData[],
  format: 0 | 1,
  ppq: number,
  options: Required<MidiExportOptions>
): ArrayBuffer {
  const chunks: Uint8Array[] = []

  // Header chunk
  chunks.push(buildHeaderChunk(format, tracks.length, ppq))

  // Track chunks
  for (const track of tracks) {
    chunks.push(buildTrackChunk(track, options))
  }

  // Concatenate all chunks and return as ArrayBuffer
  const result = concatArrays(...chunks)
  // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
  const arrayBuffer = new ArrayBuffer(result.byteLength)
  new Uint8Array(arrayBuffer).set(result)
  return arrayBuffer
}

function buildHeaderChunk(format: 0 | 1, trackCount: number, ppq: number): Uint8Array {
  return concatArrays(
    writeAscii('MThd'),           // Chunk ID
    writeUint32BE(6),             // Chunk length (always 6 for header)
    writeUint16BE(format),        // Format type
    writeUint16BE(trackCount),    // Number of tracks
    writeUint16BE(ppq)            // Time division (PPQ)
  )
}

function buildTrackChunk(track: MidiTrackData, options: Required<MidiExportOptions>): Uint8Array {
  const eventBytes: Uint8Array[] = []

  // Add track name if present
  if (track.name && options.includeTrackNames) {
    eventBytes.push(writeVLQ(0)) // Delta time = 0
    eventBytes.push(trackNameMeta(track.name))
  }

  // Calculate delta times and add events
  let prevTick = 0
  for (const event of track.events) {
    const deltaTick = Math.max(0, event.tick - prevTick)
    eventBytes.push(writeVLQ(deltaTick))
    eventBytes.push(event.data)
    prevTick = event.tick
  }

  // End of track
  eventBytes.push(writeVLQ(0))
  eventBytes.push(endOfTrackMeta())

  // Concatenate all event data
  const trackData = concatArrays(...eventBytes)

  // Build track chunk
  return concatArrays(
    writeAscii('MTrk'),           // Chunk ID
    writeUint32BE(trackData.length), // Chunk length
    trackData                     // Track data
  )
}

// =============================================================================
// Utility Functions
// =============================================================================

function parseTimeSignature(sig: string): [number, number] {
  const parts = sig.split('/')
  if (parts.length !== 2) return [4, 4]

  const num = parseInt(parts[0], 10)
  const denom = parseInt(parts[1], 10)

  if (isNaN(num) || isNaN(denom)) return [4, 4]
  return [num, denom]
}

/**
 * Create a simple TempoMap from CompiledOutput meta.
 * This is used when we don't have the full TempoMap from compilation.
 */
function createTempoMapFromMeta(output: CompiledOutput): TempoMap {
  const points: import('../compiler/pipeline/types').TempoPoint[] = [
    { beatPosition: 0, bpm: output.meta.bpm }
  ]

  // Add tempo changes
  for (const change of output.meta.tempoChanges) {
    // Estimate beat position from seconds using previous tempo
    const prevBpm = points[points.length - 1].bpm
    const beatPosition = (change.atSecond * prevBpm) / 60
    points.push({
      beatPosition,
      bpm: change.bpm,
      transitionBeats: change.transitionSeconds ? (change.transitionSeconds * change.bpm) / 60 : undefined,
      curve: change.curve
    })
  }

  // Build cumulative seconds for each segment
  const cumSeconds: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const beats = curr.beatPosition - prev.beatPosition
    const segmentSeconds = (beats / prev.bpm) * 60
    cumSeconds.push(cumSeconds[i - 1] + segmentSeconds)
  }

  return {
    points,
    getBpmAt(beat: number): number {
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].beatPosition <= beat) {
          return points[i].bpm
        }
      }
      return points[0].bpm
    },
    beatToSeconds(beat: number): number {
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].beatPosition <= beat) {
          const beatsFromPoint = beat - points[i].beatPosition
          return cumSeconds[i] + (beatsFromPoint / points[i].bpm) * 60
        }
      }
      return (beat / points[0].bpm) * 60
    },
    durationToSeconds(start: number, dur: number): number {
      return this.beatToSeconds(start + dur) - this.beatToSeconds(start)
    }
  }
}
