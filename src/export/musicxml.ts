// =============================================================================
// SymphonyScript - MusicXML Export
// =============================================================================

import type { ClipNode, ClipOperation, NoteOp, RestOp, StackOp, LoopOp, TempoOp, TimeSignatureOp, TransposeOp, ClipOp, DynamicsOp, TieType } from '../clip/types'
import type { SessionNode, TrackNode } from '../session/types'
import type { NoteDuration, Articulation } from '../types/primitives'
import type { MusicXMLExportInput, MusicXMLExportOptions, MusicXMLExportResult } from './types'
import { isClipNode, isSessionNode } from './types'
import { parseDuration } from '../util/duration'

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_OPTIONS: Required<MusicXMLExportOptions> = {
  title: 'Untitled',
  creator: 'SymphonyScript',
  partNames: {},
  divisions: 4,
  includeTempo: true,
  includeDynamics: true
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Export a ClipNode or SessionNode to MusicXML format.
 * 
 * MusicXML is exported from the AST (ClipNode/Session), not the compiled output,
 * because notation software needs the original structural data (durations like '4n',
 * not resolved seconds) to generate sheet music symbols.
 * 
 * @param input - ClipNode (single part) or SessionNode (multi-part)
 * @param options - Export options
 * @returns MusicXMLExportResult with XML string
 * 
 * @example
 * ```typescript
 * const clip = Clip.melody().note('C4', '4n').build()
 * const { xml } = exportMusicXML(clip, { title: 'My Song' })
 * ```
 */
export function exportMusicXML(
  input: MusicXMLExportInput,
  options: MusicXMLExportOptions = {}
): MusicXMLExportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (isClipNode(input)) {
    return exportClipNode(input, opts)
  } else if (isSessionNode(input)) {
    return exportSessionNode(input, opts)
  } else {
    throw new Error('Invalid input: expected ClipNode or SessionNode')
  }
}

// =============================================================================
// ClipNode Export
// =============================================================================

function exportClipNode(
  clip: ClipNode,
  options: Required<MusicXMLExportOptions>
): MusicXMLExportResult {
  const partId = 'P1'
  const partName = options.partNames[partId] || clip.name || 'Part 1'
  
  // Collect events from clip
  let events = flattenOperations(clip.operations, 0)
  
  // Filter out tempo events if includeTempo is false
  if (!options.includeTempo) {
    events = events.filter(e => e.kind !== 'tempo')
  }
  
  // Get time signature and tempo
  const [timeSigNum, timeSigDenom] = parseTimeSignature(clip.timeSignature || '4/4')
  const tempo = clip.tempo || 120

  // Build measures
  const measures = buildMeasures(events, options.divisions, timeSigNum, timeSigDenom)

  // Generate XML
  const xml = generateMusicXML({
    title: options.title,
    creator: options.creator,
    parts: [{
      id: partId,
      name: partName,
      measures,
      timeSigNum,
      timeSigDenom,
      tempo: options.includeTempo ? tempo : undefined
    }],
    divisions: options.divisions
  })

  return {
    xml,
    partCount: 1,
    measureCount: measures.length
  }
}

// =============================================================================
// SessionNode Export
// =============================================================================

function exportSessionNode(
  session: SessionNode,
  options: Required<MusicXMLExportOptions>
): MusicXMLExportResult {
  const parts: PartData[] = []
  let maxMeasures = 0

  // Get session-level defaults
  const [defaultTimeSigNum, defaultTimeSigDenom] = parseTimeSignature(session.timeSignature || '4/4')
  const defaultTempo = session.tempo || 120

  // Process each track
  for (let i = 0; i < session.tracks.length; i++) {
    const track = session.tracks[i]
    const partId = `P${i + 1}`
    const partName = options.partNames[partId] || 
                     options.partNames[String(i)] ||
                     track.name || 
                     track.instrument?.name || 
                     `Part ${i + 1}`

    // Get track-level overrides
    const [timeSigNum, timeSigDenom] = parseTimeSignature(
      track.timeSignature || track.clip.timeSignature || session.timeSignature || '4/4'
    )
    const tempo = track.tempo || track.clip.tempo || defaultTempo

    // Collect events from clip
    const events = flattenOperations(track.clip.operations, 0)

    // Build measures
    const measures = buildMeasures(events, options.divisions, timeSigNum, timeSigDenom)
    maxMeasures = Math.max(maxMeasures, measures.length)

    parts.push({
      id: partId,
      name: partName,
      measures,
      timeSigNum,
      timeSigDenom,
      tempo: i === 0 && options.includeTempo ? tempo : undefined // Only first part gets tempo
    })
  }

  // Generate XML
  const xml = generateMusicXML({
    title: options.title,
    creator: options.creator,
    parts,
    divisions: options.divisions
  })

  return {
    xml,
    partCount: parts.length,
    measureCount: maxMeasures
  }
}

// =============================================================================
// Event Flattening
// =============================================================================

interface FlatEvent {
  kind: 'note' | 'rest' | 'tempo' | 'time_signature' | 'dynamics'
  beatPosition: number
  duration: number // in beats
  note?: string
  velocity?: number
  articulation?: Articulation
  tie?: TieType
  isChord?: boolean // Part of a chord (not the first note)
  bpm?: number // For tempo events
  timeSig?: [number, number] // For time signature events
  dynamicsType?: string
  dynamicsFrom?: number
  dynamicsTo?: number
}

function flattenOperations(
  operations: ClipOperation[],
  transposition: number,
  beatPosition: number = 0
): FlatEvent[] {
  const events: FlatEvent[] = []

  for (const op of operations) {
    switch (op.kind) {
      case 'note': {
        const noteOp = op as NoteOp
        const duration = parseDuration(noteOp.duration)
        const transposedNote = transposeNoteName(noteOp.note as string, transposition)
        
        events.push({
          kind: 'note',
          beatPosition,
          duration,
          note: transposedNote,
          velocity: noteOp.velocity,
          articulation: noteOp.articulation,
          tie: noteOp.tie
        })
        beatPosition += duration
        break
      }

      case 'rest': {
        const restOp = op as RestOp
        const duration = parseDuration(restOp.duration)
        
        events.push({
          kind: 'rest',
          beatPosition,
          duration
        })
        beatPosition += duration
        break
      }

      case 'stack': {
        const stackOp = op as StackOp
        // Flatten stack operations - all start at same beat
        // Mark subsequent notes as chord members
        let maxDuration = 0
        let isFirst = true
        
        for (const innerOp of stackOp.operations) {
          const innerEvents = flattenOperations([innerOp], transposition, beatPosition)
          for (const event of innerEvents) {
            if (!isFirst && event.kind === 'note') {
              event.isChord = true
            }
            events.push(event)
            if (event.kind === 'note' || event.kind === 'rest') {
              maxDuration = Math.max(maxDuration, event.duration)
            }
            isFirst = false
          }
        }
        beatPosition += maxDuration
        break
      }

      case 'loop': {
        const loopOp = op as LoopOp
        for (let i = 0; i < loopOp.count; i++) {
          const innerEvents = flattenOperations(loopOp.operations, transposition, beatPosition)
          events.push(...innerEvents)
          // Update beat position to end of loop iteration
          if (innerEvents.length > 0) {
            const lastEvent = innerEvents[innerEvents.length - 1]
            beatPosition = lastEvent.beatPosition + (lastEvent.duration || 0)
          }
        }
        break
      }

      case 'transpose': {
        const transposeOp = op as TransposeOp
        const innerEvents = flattenOperations(
          [transposeOp.operation],
          transposition + transposeOp.semitones,
          beatPosition
        )
        events.push(...innerEvents)
        // Update beat position
        if (innerEvents.length > 0) {
          const lastEvent = innerEvents[innerEvents.length - 1]
          beatPosition = lastEvent.beatPosition + (lastEvent.duration || 0)
        }
        break
      }

      case 'clip': {
        const clipOp = op as ClipOp
        const innerEvents = flattenOperations(clipOp.clip.operations, transposition, beatPosition)
        events.push(...innerEvents)
        // Update beat position
        if (innerEvents.length > 0) {
          const lastEvent = innerEvents[innerEvents.length - 1]
          beatPosition = lastEvent.beatPosition + (lastEvent.duration || 0)
        }
        break
      }

      case 'tempo': {
        const tempoOp = op as TempoOp
        events.push({
          kind: 'tempo',
          beatPosition,
          duration: 0,
          bpm: tempoOp.bpm
        })
        break
      }

      case 'time_signature': {
        const timeSigOp = op as TimeSignatureOp
        const [num, denom] = parseTimeSignature(timeSigOp.signature)
        events.push({
          kind: 'time_signature',
          beatPosition,
          duration: 0,
          timeSig: [num, denom]
        })
        break
      }

      case 'dynamics': {
        const dynOp = op as DynamicsOp
        events.push({
          kind: 'dynamics',
          beatPosition,
          duration: parseDuration(dynOp.duration),
          dynamicsType: dynOp.type,
          dynamicsFrom: dynOp.from,
          dynamicsTo: dynOp.to
        })
        break
      }

      // Skip non-notation events
      case 'control':
      case 'aftertouch':
      case 'vibrato':
      case 'pitch_bend':
      case 'block':
      case 'scope':
        break
    }
  }

  return events
}

// =============================================================================
// Measure Building
// =============================================================================

interface MeasureData {
  number: number
  events: FlatEvent[]
  hasAttributes: boolean
  timeSigNum?: number
  timeSigDenom?: number
  tempo?: number
}

function buildMeasures(
  events: FlatEvent[],
  divisions: number,
  timeSigNum: number,
  timeSigDenom: number
): MeasureData[] {
  const measures: MeasureData[] = []
  const beatsPerMeasure = timeSigNum * (4 / timeSigDenom)

  // Sort events by beat position
  const sortedEvents = [...events].sort((a, b) => a.beatPosition - b.beatPosition)

  // Find total duration
  let totalBeats = 0
  for (const event of sortedEvents) {
    const endBeat = event.beatPosition + (event.duration || 0)
    totalBeats = Math.max(totalBeats, endBeat)
  }

  // Calculate number of measures needed
  const numMeasures = Math.max(1, Math.ceil(totalBeats / beatsPerMeasure))

  // Group events into measures
  for (let m = 0; m < numMeasures; m++) {
    const measureStart = m * beatsPerMeasure
    const measureEnd = (m + 1) * beatsPerMeasure

    const measureEvents = sortedEvents.filter(e => {
      // Include events that start in this measure
      return e.beatPosition >= measureStart && e.beatPosition < measureEnd
    })

    // Check for time signature or tempo changes
    const timeSigEvent = measureEvents.find(e => e.kind === 'time_signature')
    const tempoEvent = measureEvents.find(e => e.kind === 'tempo')

    measures.push({
      number: m + 1,
      events: measureEvents,
      hasAttributes: m === 0 || !!timeSigEvent,
      timeSigNum: timeSigEvent?.timeSig?.[0] || (m === 0 ? timeSigNum : undefined),
      timeSigDenom: timeSigEvent?.timeSig?.[1] || (m === 0 ? timeSigDenom : undefined),
      tempo: tempoEvent?.bpm || (m === 0 ? undefined : undefined) // First measure tempo in attributes
    })
  }

  // Ensure at least one measure
  if (measures.length === 0) {
    measures.push({
      number: 1,
      events: [],
      hasAttributes: true,
      timeSigNum,
      timeSigDenom
    })
  }

  return measures
}

// =============================================================================
// XML Generation
// =============================================================================

interface PartData {
  id: string
  name: string
  measures: MeasureData[]
  timeSigNum: number
  timeSigDenom: number
  tempo?: number
}

interface ScoreData {
  title: string
  creator: string
  parts: PartData[]
  divisions: number
}

function generateMusicXML(score: ScoreData): string {
  const lines: string[] = []

  // XML declaration and DOCTYPE
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  lines.push('<score-partwise version="3.1">')

  // Work
  lines.push('  <work>')
  lines.push(`    <work-title>${escapeXml(score.title)}</work-title>`)
  lines.push('  </work>')

  // Identification
  lines.push('  <identification>')
  lines.push(`    <creator type="composer">${escapeXml(score.creator)}</creator>`)
  lines.push('    <encoding>')
  lines.push('      <software>SymphonyScript</software>')
  lines.push(`      <encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>`)
  lines.push('    </encoding>')
  lines.push('  </identification>')

  // Part list
  lines.push('  <part-list>')
  for (const part of score.parts) {
    lines.push(`    <score-part id="${part.id}">`)
    lines.push(`      <part-name>${escapeXml(part.name)}</part-name>`)
    lines.push('    </score-part>')
  }
  lines.push('  </part-list>')

  // Parts
  for (const part of score.parts) {
    lines.push(`  <part id="${part.id}">`)
    
    for (const measure of part.measures) {
      lines.push(`    <measure number="${measure.number}">`)

      // Attributes (first measure or time signature change)
      if (measure.hasAttributes) {
        lines.push('      <attributes>')
        lines.push(`        <divisions>${score.divisions}</divisions>`)
        if (measure.timeSigNum !== undefined && measure.timeSigDenom !== undefined) {
          lines.push('        <time>')
          lines.push(`          <beats>${measure.timeSigNum}</beats>`)
          lines.push(`          <beat-type>${measure.timeSigDenom}</beat-type>`)
          lines.push('        </time>')
        }
        // Default clef for first measure
        if (measure.number === 1) {
          lines.push('        <clef>')
          lines.push('          <sign>G</sign>')
          lines.push('          <line>2</line>')
          lines.push('        </clef>')
        }
        lines.push('      </attributes>')
      }

      // Tempo direction (metronome marking) - only if includeTempo is true
      const tempoEvent = measure.events.find(e => e.kind === 'tempo')
      const shouldIncludeTempo = part.tempo !== undefined || tempoEvent?.bpm !== undefined
      if (shouldIncludeTempo) {
        const bpm = tempoEvent?.bpm || part.tempo
        lines.push('      <direction placement="above">')
        lines.push('        <direction-type>')
        lines.push('          <metronome>')
        lines.push('            <beat-unit>quarter</beat-unit>')
        lines.push(`            <per-minute>${bpm}</per-minute>`)
        lines.push('          </metronome>')
        lines.push('        </direction-type>')
        lines.push('        <sound tempo="' + bpm + '"/>')
        lines.push('      </direction>')
      }

      // Notes and rests
      const beatsPerMeasure = (measure.timeSigNum || 4) * (4 / (measure.timeSigDenom || 4))
      const measureStart = (measure.number - 1) * beatsPerMeasure

      for (const event of measure.events) {
        if (event.kind === 'note') {
          lines.push(...generateNote(event, score.divisions, measureStart, event.isChord))
        } else if (event.kind === 'rest') {
          lines.push(...generateRest(event, score.divisions, measureStart))
        }
      }

      // Fill with rest if measure is empty
      if (measure.events.filter(e => e.kind === 'note' || e.kind === 'rest').length === 0) {
        // Whole measure rest
        const wholeMeasureDuration = beatsPerMeasure * score.divisions
        lines.push('      <note>')
        lines.push('        <rest measure="yes"/>')
        lines.push(`        <duration>${Math.round(wholeMeasureDuration)}</duration>`)
        lines.push('      </note>')
      }

      lines.push('    </measure>')
    }

    lines.push('  </part>')
  }

  lines.push('</score-partwise>')

  return lines.join('\n')
}

function generateNote(
  event: FlatEvent,
  divisions: number,
  measureStart: number,
  isChord?: boolean
): string[] {
  const lines: string[] = []
  const duration = Math.round(event.duration * divisions)
  const type = durationToNoteType(event.duration)
  const pitch = parseNoteName(event.note || 'C4')

  lines.push('      <note>')

  // Chord marker (for notes after the first in a stack)
  if (isChord) {
    lines.push('        <chord/>')
  }

  // Pitch
  lines.push('        <pitch>')
  lines.push(`          <step>${pitch.step}</step>`)
  if (pitch.alter !== 0) {
    lines.push(`          <alter>${pitch.alter}</alter>`)
  }
  lines.push(`          <octave>${pitch.octave}</octave>`)
  lines.push('        </pitch>')

  // Duration
  lines.push(`        <duration>${duration}</duration>`)

  // Tie
  if (event.tie === 'start') {
    lines.push('        <tie type="start"/>')
  } else if (event.tie === 'end') {
    lines.push('        <tie type="stop"/>')
  } else if (event.tie === 'continue') {
    lines.push('        <tie type="stop"/>')
    lines.push('        <tie type="start"/>')
  }

  // Note type
  lines.push(`        <type>${type}</type>`)

  // Check for dotted duration
  if (isDotted(event.duration)) {
    lines.push('        <dot/>')
  }

  // Time modification for triplets
  const tripletInfo = getTripletInfo(event.duration)
  if (tripletInfo) {
    lines.push('        <time-modification>')
    lines.push(`          <actual-notes>${tripletInfo.actualNotes}</actual-notes>`)
    lines.push(`          <normal-notes>${tripletInfo.normalNotes}</normal-notes>`)
    lines.push('        </time-modification>')
  }

  // Notations (articulations, ties)
  const hasNotations = event.articulation || event.tie
  if (hasNotations) {
    lines.push('        <notations>')

    // Tie notation
    if (event.tie === 'start') {
      lines.push('          <tied type="start"/>')
    } else if (event.tie === 'end') {
      lines.push('          <tied type="stop"/>')
    } else if (event.tie === 'continue') {
      lines.push('          <tied type="stop"/>')
      lines.push('          <tied type="start"/>')
    }

    // Articulations
    if (event.articulation) {
      lines.push('          <articulations>')
      switch (event.articulation) {
        case 'staccato':
          lines.push('            <staccato/>')
          break
        case 'accent':
          lines.push('            <accent/>')
          break
        case 'tenuto':
          lines.push('            <tenuto/>')
          break
        case 'marcato':
          lines.push('            <strong-accent type="up"/>')
          break
        // legato doesn't have a specific articulation mark
      }
      lines.push('          </articulations>')
    }

    lines.push('        </notations>')
  }

  lines.push('      </note>')

  return lines
}

function generateRest(
  event: FlatEvent,
  divisions: number,
  measureStart: number
): string[] {
  const lines: string[] = []
  const duration = Math.round(event.duration * divisions)
  const type = durationToNoteType(event.duration)

  lines.push('      <note>')
  lines.push('        <rest/>')
  lines.push(`        <duration>${duration}</duration>`)
  lines.push(`        <type>${type}</type>`)

  if (isDotted(event.duration)) {
    lines.push('        <dot/>')
  }

  lines.push('      </note>')

  return lines
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

interface PitchInfo {
  step: string
  alter: number
  octave: number
}

function parseNoteName(note: string): PitchInfo {
  const match = note.match(/^([A-Ga-g])([#b]?)(-?\d+)$/)
  if (!match) {
    return { step: 'C', alter: 0, octave: 4 }
  }

  const step = match[1].toUpperCase()
  const accidental = match[2]
  const octave = parseInt(match[3], 10)

  let alter = 0
  if (accidental === '#') alter = 1
  else if (accidental === 'b') alter = -1

  return { step, alter, octave }
}

function transposeNoteName(note: string, semitones: number): string {
  if (semitones === 0) return note

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const flatToSharp: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B'
  }

  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/)
  if (!match) return note

  let name = match[1].toUpperCase()
  let octave = parseInt(match[2], 10)

  // Convert flats to sharps
  if (flatToSharp[name]) {
    name = flatToSharp[name]
  }

  const noteIndex = noteNames.indexOf(name)
  if (noteIndex === -1) return note

  // Calculate new note
  let newIndex = noteIndex + semitones
  while (newIndex < 0) {
    newIndex += 12
    octave--
  }
  while (newIndex >= 12) {
    newIndex -= 12
    octave++
  }

  return noteNames[newIndex] + octave
}

/**
 * Convert duration in beats to MusicXML note type.
 */
function durationToNoteType(beats: number): string {
  // Handle dotted durations
  const baseDuration = isDotted(beats) ? beats / 1.5 : beats

  // Handle triplet durations - triplet note type is the "normal" note type
  // e.g., an eighth triplet (1/3 beat) has type "eighth" with time-modification
  const tripletInfo = getTripletInfo(beats)
  if (tripletInfo) {
    return tripletInfo.noteType
  }

  if (baseDuration >= 4) return 'whole'
  if (baseDuration >= 2) return 'half'
  if (baseDuration >= 1) return 'quarter'
  if (baseDuration >= 0.5) return 'eighth'
  if (baseDuration >= 0.25) return '16th'
  if (baseDuration >= 0.125) return '32nd'
  return '64th'
}

/**
 * Check if duration is dotted (1.5x a standard duration).
 */
function isDotted(beats: number): boolean {
  // Common dotted durations: 1.5, 3, 6 (quarter note = 1 beat)
  const dottedValues = [0.1875, 0.375, 0.75, 1.5, 3, 6]
  return dottedValues.some(v => Math.abs(beats - v) < 0.001)
}

/**
 * Triplet duration info for time-modification element.
 */
interface TripletInfo {
  noteType: string     // The "normal" note type (quarter, eighth, etc.)
  actualNotes: number  // Number of notes in the time of normalNotes (3 for triplet)
  normalNotes: number  // Normal number of notes (2 for triplet)
}

/**
 * Get triplet info for a duration in beats.
 * Triplets are 3 notes in the time of 2 normal notes.
 * 
 * Common triplet beat values:
 * - Quarter triplet (4t): 2/3 beat ≈ 0.667
 * - Eighth triplet (8t): 1/3 beat ≈ 0.333
 * - Sixteenth triplet (16t): 1/6 beat ≈ 0.167
 * - Half triplet (2t): 4/3 beat ≈ 1.333
 */
function getTripletInfo(beats: number): TripletInfo | null {
  const tolerance = 0.01
  
  // Half triplet: 4/3 beat (1.333...)
  if (Math.abs(beats - 4/3) < tolerance) {
    return { noteType: 'half', actualNotes: 3, normalNotes: 2 }
  }
  
  // Quarter triplet: 2/3 beat (0.667...)
  if (Math.abs(beats - 2/3) < tolerance) {
    return { noteType: 'quarter', actualNotes: 3, normalNotes: 2 }
  }
  
  // Eighth triplet: 1/3 beat (0.333...)
  if (Math.abs(beats - 1/3) < tolerance) {
    return { noteType: 'eighth', actualNotes: 3, normalNotes: 2 }
  }
  
  // Sixteenth triplet: 1/6 beat (0.167...)
  if (Math.abs(beats - 1/6) < tolerance) {
    return { noteType: '16th', actualNotes: 3, normalNotes: 2 }
  }
  
  // 32nd triplet: 1/12 beat (0.083...)
  if (Math.abs(beats - 1/12) < tolerance) {
    return { noteType: '32nd', actualNotes: 3, normalNotes: 2 }
  }
  
  return null
}

/**
 * Check if a duration is a triplet.
 */
function isTriplet(beats: number): boolean {
  return getTripletInfo(beats) !== null
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
