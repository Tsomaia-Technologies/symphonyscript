// =============================================================================
// SymphonyScript - MIDI to ClipNode Converter
// Converts parsed MIDI files to editable ClipNode AST (sheet music only)
// =============================================================================

import type { ClipNode, ClipOperation, NoteOp, RestOp, StackOp, TempoOp, TimeSignatureOp, ControlOp } from '../clip/types'
import type { NoteDuration, NoteName, TimeSignatureString } from '../../../../symphonyscript/packages/core/src/types/primitives'
import type { MidiImportOptions, ClipImportResult, MultiClipImportResult } from './types'
import {
  parseMidiBuffer,
  type MidiFile,
  type MidiTrack,
  type MidiEvent,
  type MidiNoteOnEvent,
  type MidiNoteOffEvent,
  type MidiMetaEvent,
  META_SET_TEMPO,
  META_TIME_SIGNATURE,
  extractTempo,
  extractTimeSignature,
  microsecondsPerBeatToBPM
} from './midi-parser'
import { parseDuration } from '../../../../symphonyscript/packages/core/src/util/duration'
import { SCHEMA_VERSION } from '../../../../symphonyscript/packages/core/src/schema/version'

// --- Public API ---

/**
 * Import a MIDI file as multiple ClipNodes (one per track).
 * 
 * @param buffer - Raw MIDI file data
 * @param options - Import options
 * @returns Array of ClipNodes with track names
 */
export function importMidi(
  buffer: ArrayBuffer,
  options?: MidiImportOptions
): MultiClipImportResult {
  const midiFile = parseMidiBuffer(buffer)
  return convertMidiFile(midiFile, options)
}

/**
 * Import a MIDI file as a single ClipNode (merged or first track).
 * 
 * @param buffer - Raw MIDI file data
 * @param options - Import options
 * @returns Single ClipNode
 */
export function importMidiAsClip(
  buffer: ArrayBuffer,
  options?: MidiImportOptions
): ClipImportResult {
  const midiFile = parseMidiBuffer(buffer)
  const result = convertMidiFile(midiFile, { ...options, mergeAllTracks: true })
  return {
    clip: result.clips[0],
    warnings: result.warnings
  }
}

// NOTE: File-based imports (importMidiFile, importMidiFileAsClip) 
// are in @symphonyscript/node package - not available in core.

// --- Internal Conversion Logic ---

interface NoteEvent {
  tick: number
  note: number
  velocity: number
  channel: number
  duration: number // In ticks
  pitchBendCents?: number // Pitch bend at note onset in cents
}

interface TrackData {
  name: string
  notes: NoteEvent[]
  tempos: Array<{ tick: number; bpm: number }>
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>
  controlChanges: Array<{ tick: number; controller: number; value: number; channel: number }>
}

function convertMidiFile(
  midiFile: MidiFile,
  options?: MidiImportOptions
): MultiClipImportResult {
  const warnings: string[] = []
  const { ppq, tracks } = midiFile

  // Extract track data
  const trackDataList: TrackData[] = []

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    const trackData = extractTrackData(track, i, {
      velocityThreshold: options?.velocityThreshold,
      pitchBendRange: options?.pitchBendRange
    }, warnings)
    
    // Skip empty tracks
    if (trackData.notes.length > 0 || trackData.tempos.length > 0 || trackData.timeSignatures.length > 0) {
      trackDataList.push(trackData)
    }
  }

  // Merge if requested
  if (options?.mergeAllTracks) {
    const mergedData = mergeTrackData(trackDataList)
    const clip = convertTrackDataToClip(mergedData, ppq, options, 'Merged')
    return {
      clips: [clip],
      names: ['Merged'],
      warnings
    }
  }

  // Convert each track to a ClipNode
  const clips: ClipNode[] = []
  const names: string[] = []

  for (const trackData of trackDataList) {
    const clip = convertTrackDataToClip(trackData, ppq, options, trackData.name)
    clips.push(clip)
    names.push(trackData.name)
  }

  return { clips, names, warnings }
}

function extractTrackData(
  track: MidiTrack,
  trackIndex: number,
  config: {
    velocityThreshold?: number
    pitchBendRange?: number
  },
  warnings: string[]
): TrackData {
  const baseName = track.name || `Track ${trackIndex + 1}`
  const notes: NoteEvent[] = []
  const tempos: TrackData['tempos'] = []
  const timeSignatures: TrackData['timeSignatures'] = []
  const controlChanges: TrackData['controlChanges'] = []

  const velocityThreshold = config.velocityThreshold ?? 0
  const pitchBendRange = config.pitchBendRange ?? 2  // Default ±2 semitones

  // Track active notes for matching Note On/Off pairs
  const activeNotes = new Map<string, MidiNoteOnEvent>()
  
  // Track pitch bend state per channel (in cents)
  const channelPitchBend = new Map<number, number>()
  
  // Track first program change for instrument hint
  let firstProgram: number | undefined

  for (const event of track.events) {
    if (event.type === 'program_change') {
      // Capture first program change for track naming
      if (firstProgram === undefined) {
        firstProgram = event.program
      }

    } else if (event.type === 'pitch_bend') {
      // Convert MIDI pitch bend (0-16383) to cents
      // pitchBendRange semitones = pitchBendRange * 100 cents
      const cents = ((event.value - 8192) / 8192) * (pitchBendRange * 100)
      channelPitchBend.set(event.channel, cents)

    } else if (event.type === 'note_on' && event.velocity > 0) {
      // Note On
      if (event.velocity < velocityThreshold) {
        continue // Skip below threshold
      }
      const key = `${event.channel}-${event.note}`
      activeNotes.set(key, event)

    } else if (event.type === 'note_off' || (event.type === 'note_on' && event.velocity === 0)) {
      // Note Off (velocity 0 Note On is equivalent)
      const noteEvent = event as MidiNoteOnEvent | MidiNoteOffEvent
      const key = `${noteEvent.channel}-${noteEvent.note}`
      const noteOn = activeNotes.get(key)

      if (noteOn) {
        const duration = noteEvent.tick - noteOn.tick
        if (duration > 0) {
          // Capture pitch bend at note onset
          const pitchBendCents = channelPitchBend.get(noteOn.channel) ?? 0
          notes.push({
            tick: noteOn.tick,
            note: noteOn.note,
            velocity: noteOn.velocity,
            channel: noteOn.channel,
            duration,
            pitchBendCents: pitchBendCents !== 0 ? pitchBendCents : undefined
          })
        }
        activeNotes.delete(key)
      } else {
        // Orphan Note Off - common in MIDI files, not an error
      }

    } else if (event.type === 'meta') {
      const metaEvent = event as MidiMetaEvent

      if (metaEvent.metaType === META_SET_TEMPO) {
        const uspb = extractTempo(metaEvent)
        if (uspb) {
          tempos.push({
            tick: metaEvent.tick,
            bpm: microsecondsPerBeatToBPM(uspb)
          })
        }
      } else if (metaEvent.metaType === META_TIME_SIGNATURE) {
        const sig = extractTimeSignature(metaEvent)
        if (sig) {
          timeSignatures.push({
            tick: metaEvent.tick,
            numerator: sig[0],
            denominator: sig[1]
          })
        }
      }

    } else if (event.type === 'control_change') {
      controlChanges.push({
        tick: event.tick,
        controller: event.controller,
        value: event.value,
        channel: event.channel
      })
    }
  }

  // Warn about unclosed notes
  if (activeNotes.size > 0) {
    warnings.push(`Track "${baseName}": ${activeNotes.size} unclosed note(s) at end of track`)
  }

  // Build final name with program hint if available
  const name: string = firstProgram !== undefined
    ? `${baseName} (Program ${firstProgram})`
    : baseName

  return { name, notes, tempos, timeSignatures, controlChanges }
}

function mergeTrackData(tracks: TrackData[]): TrackData {
  const merged: TrackData = {
    name: 'Merged',
    notes: [],
    tempos: [],
    timeSignatures: [],
    controlChanges: []
  }

  for (const track of tracks) {
    merged.notes.push(...track.notes)
    merged.tempos.push(...track.tempos)
    merged.timeSignatures.push(...track.timeSignatures)
    merged.controlChanges.push(...track.controlChanges)
  }

  // Sort by tick
  merged.notes.sort((a, b) => a.tick - b.tick)
  merged.tempos.sort((a, b) => a.tick - b.tick)
  merged.timeSignatures.sort((a, b) => a.tick - b.tick)
  merged.controlChanges.sort((a, b) => a.tick - b.tick)

  // Deduplicate tempos and time signatures
  merged.tempos = deduplicateByTick(merged.tempos)
  merged.timeSignatures = deduplicateByTick(merged.timeSignatures)

  return merged
}

function deduplicateByTick<T extends { tick: number }>(items: T[]): T[] {
  const seen = new Set<number>()
  return items.filter(item => {
    if (seen.has(item.tick)) return false
    seen.add(item.tick)
    return true
  })
}

function convertTrackDataToClip(
  trackData: TrackData,
  ppq: number,
  options: MidiImportOptions | undefined,
  clipName: string
): ClipNode {
  const operations: ClipOperation[] = []
  let currentTick = 0

  // Combine all events and sort by tick
  type Event =
    | { type: 'note'; tick: number; data: NoteEvent }
    | { type: 'tempo'; tick: number; data: { bpm: number } }
    | { type: 'timesig'; tick: number; data: { numerator: number; denominator: number } }
    | { type: 'control'; tick: number; data: { controller: number; value: number } }

  const allEvents: Event[] = [
    ...trackData.notes.map(n => ({ type: 'note' as const, tick: n.tick, data: n })),
    ...trackData.tempos.map(t => ({ type: 'tempo' as const, tick: t.tick, data: t })),
    ...trackData.timeSignatures.map(ts => ({ type: 'timesig' as const, tick: ts.tick, data: ts })),
    ...trackData.controlChanges.map(cc => ({ type: 'control' as const, tick: cc.tick, data: cc }))
  ]

  allEvents.sort((a, b) => a.tick - b.tick)

  // Group notes by tick for chord detection
  const notesByTick = new Map<number, NoteEvent[]>()
  for (const note of trackData.notes) {
    const notes = notesByTick.get(note.tick) || []
    notes.push(note)
    notesByTick.set(note.tick, notes)
  }

  // Track processed note ticks to avoid duplicates
  const processedNoteTicks = new Set<number>()

  for (const event of allEvents) {
    // Add rest if there's a gap
    if (event.tick > currentTick) {
      const restDuration = ticksToNoteDuration(event.tick - currentTick, ppq, options)
      if (restDuration) {
        operations.push({
          kind: 'rest',
          duration: restDuration
        } as RestOp)
      }
      currentTick = event.tick
    }

    switch (event.type) {
      case 'note': {
        // Skip if we already processed notes at this tick
        if (processedNoteTicks.has(event.tick)) continue
        processedNoteTicks.add(event.tick)

        const notesAtTick = notesByTick.get(event.tick) || [event.data]

        if (notesAtTick.length === 1) {
          // Single note
          const note = notesAtTick[0]
          const noteOp = createNoteOp(note, ppq, options)
          operations.push(noteOp)
          currentTick = Math.max(currentTick, note.tick + note.duration)
        } else {
          // Chord (StackOp)
          const stackOp = createStackOp(notesAtTick, ppq, options)
          operations.push(stackOp)
          // Advance by the longest note
          const maxDuration = Math.max(...notesAtTick.map(n => n.duration))
          currentTick = Math.max(currentTick, event.tick + maxDuration)
        }
        break
      }

      case 'tempo': {
        const tempoOp: TempoOp = {
          kind: 'tempo',
          bpm: Math.round(event.data.bpm)
        }
        operations.push(tempoOp)
        break
      }

      case 'timesig': {
        const sig = `${event.data.numerator}/${event.data.denominator}` as TimeSignatureString
        const timeSigOp: TimeSignatureOp = {
          kind: 'time_signature',
          signature: sig
        }
        operations.push(timeSigOp)
        break
      }

      case 'control': {
        const controlOp: ControlOp = {
          kind: 'control',
          controller: event.data.controller,
          value: event.data.value
        }
        operations.push(controlOp)
        break
      }
    }
  }

  return {
    _version: SCHEMA_VERSION,
    kind: 'clip',
    name: clipName,
    operations
  }
}

function createNoteOp(note: NoteEvent, ppq: number, options?: MidiImportOptions): NoteOp {
  const duration = ticksToNoteDuration(note.duration, ppq, options)
  const noteName = midiNoteToNoteName(note.note)

  const noteOp: NoteOp = {
    kind: 'note',
    note: noteName,
    duration: duration || '4n',
    velocity: note.velocity / 127
  }

  // Add pitch bend as detune (in cents) if present
  if (note.pitchBendCents && note.pitchBendCents !== 0) {
    noteOp.detune = note.pitchBendCents
  }

  return noteOp
}

function createStackOp(notes: NoteEvent[], ppq: number, options?: MidiImportOptions): StackOp {
  const noteOps = notes.map(note => createNoteOp(note, ppq, options))
  return {
    kind: 'stack',
    operations: noteOps
  }
}

// --- Utility Functions ---

/**
 * Convert MIDI note number to NoteName.
 * MIDI note 60 = C4 (middle C)
 */
function midiNoteToNoteName(midiNote: number): NoteName {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midiNote / 12) - 1
  const noteIndex = midiNote % 12
  return `${noteNames[noteIndex]}${octave}` as NoteName
}

/**
 * Convert MIDI ticks to the closest standard NoteDuration.
 */
function ticksToNoteDuration(
  ticks: number,
  ppq: number,
  options?: MidiImportOptions
): NoteDuration | null {
  if (ticks <= 0) return null

  // Convert ticks to beats
  let beats = ticks / ppq

  // Apply quantization if specified
  if (options?.quantize) {
    const gridBeats = parseDuration(options.quantize.grid)
    const strength = options.quantize.strength ?? 1.0
    const nearestGrid = Math.round(beats / gridBeats) * gridBeats
    beats = beats + (nearestGrid - beats) * strength
  }

  // Return exact beat value if preserveExactTiming is enabled
  if (options?.preserveExactTiming) {
    return beats as unknown as NoteDuration
  }

  // Find the closest standard duration (sorted by beat value descending)
  const durations: Array<[NoteDuration, number]> = [
    ['1n', 4.0],
    ['2n.', 3.0],
    ['2n', 2.0],
    ['4n.', 1.5],
    ['4n', 1.0],
    ['8n.', 0.75],
    ['4t', 2/3],       // 0.667 - Quarter triplet
    ['8n', 0.5],
    ['16n.', 0.375],
    ['8t', 1/3],       // 0.333 - Eighth triplet
    ['16n', 0.25],
    ['16t', 1/6],      // 0.167 - Sixteenth triplet
    ['32n', 0.125]
  ]

  let closestDuration: NoteDuration = '4n'
  let closestDiff = Infinity

  for (const [dur, durBeats] of durations) {
    const diff = Math.abs(beats - durBeats)
    if (diff < closestDiff) {
      closestDiff = diff
      closestDuration = dur
    }
  }

  // If the beat value doesn't match any standard duration closely,
  // use a numeric value
  if (closestDiff > 0.1 && beats > 0) {
    return beats as unknown as NoteDuration
  }

  return closestDuration
}
