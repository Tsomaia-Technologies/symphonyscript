// =============================================================================
// SymphonyScript - MusicXML to ClipNode Converter
// Converts MusicXML files to editable ClipNode AST (sheet music only)
// =============================================================================

import type { ClipNode, ClipOperation, NoteOp, RestOp, StackOp, TempoOp, TimeSignatureOp } from '../clip/types'
import type { NoteDuration, NoteName, TimeSignatureString, Articulation } from '../../../../symphonyscript/packages/core/src/types/primitives'
import type { MusicXMLImportOptions, ClipImportResult, MultiClipImportResult } from './types'
import {
  parseXML,
  getElements,
  getElement,
  getDirectChildren,
  getText,
  getAttribute,
  getChildText,
  getAttributeInt,
  type XMLElement,
  type XMLDocument
} from './musicxml-parser'
import { parseDuration } from '../../../../symphonyscript/packages/core/src/util/duration'
import { SCHEMA_VERSION } from '../../../../symphonyscript/packages/core/src/schema/version'

// --- Public API ---

/**
 * Import a MusicXML file as multiple ClipNodes (one per part).
 * 
 * @param xml - MusicXML string
 * @param options - Import options
 * @returns Array of ClipNodes with part names
 */
export function importMusicXML(
  xml: string,
  options?: MusicXMLImportOptions
): MultiClipImportResult {
  const doc = parseXML(xml)
  return convertMusicXMLDocument(doc, options)
}

/**
 * Import a MusicXML file as a single ClipNode (merged or first part).
 * 
 * @param xml - MusicXML string
 * @param options - Import options
 * @returns Single ClipNode
 */
export function importMusicXMLAsClip(
  xml: string,
  options?: MusicXMLImportOptions
): ClipImportResult {
  const doc = parseXML(xml)
  const result = convertMusicXMLDocument(doc, { ...options, mergeAllParts: true })
  return {
    clip: result.clips[0],
    warnings: result.warnings
  }
}

// NOTE: File-based imports (importMusicXMLFile, importMusicXMLFileAsClip) 
// are in @symphonyscript/node package - not available in core.

// --- Internal Types ---

interface PartInfo {
  id: string
  name: string
}

interface NoteData {
  /** Position in divisions from start of part */
  position: number
  /** Note name with octave (e.g., "C4") */
  pitch: NoteName | null // null for rest
  /** Duration in divisions */
  duration: number
  /** Voice number (for multi-voice parts) */
  voice: number
  /** True if this is a chord (starts at same position as previous note) */
  isChord: boolean
  /** Tied to next note */
  tieStart: boolean
  /** Tied from previous note */
  tieEnd: boolean
  /** Articulation */
  articulation?: Articulation
  /** Dynamics (velocity 0-1) */
  dynamics?: number
}

interface MeasureContext {
  /** Divisions per quarter note (set by <attributes>) */
  divisions: number
  /** Current time signature */
  timeSignature: TimeSignatureString
  /** Current tempo (BPM) */
  tempo?: number
  /** Current dynamics level (0-1) */
  dynamics: number
}

// --- Conversion Logic ---

function convertMusicXMLDocument(
  doc: XMLDocument,
  options?: MusicXMLImportOptions
): MultiClipImportResult {
  const warnings: string[] = []

  // Determine root element type
  const root = doc.documentElement
  const isPartwise = root.tagName === 'score-partwise'
  const isTimewise = root.tagName === 'score-timewise'

  if (!isPartwise && !isTimewise) {
    throw new Error(`Unsupported MusicXML root element: ${root.tagName}. Expected score-partwise or score-timewise.`)
  }

  if (isTimewise) {
    warnings.push('score-timewise format detected. Converting to partwise structure.')
    // For now, we don't fully support timewise - we'd need to transpose the structure
    // Most MusicXML files are partwise anyway
  }

  // Get part list
  const partList = getElement(root, 'part-list')
  const parts: PartInfo[] = []

  if (partList) {
    const scoreParts = getElements(partList, 'score-part')
    for (const sp of scoreParts) {
      const id = getAttribute(sp, 'id') || ''
      const name = getChildText(sp, 'part-name') || id || 'Part'
      parts.push({ id, name })
    }
  }

  // Filter parts if specified
  let filteredParts = parts
  if (options?.parts && options.parts.length > 0) {
    filteredParts = parts.filter(p => options.parts!.includes(p.id))
  }

  // Get part elements
  const partElements = getElements(root, 'part')
  const partMap = new Map<string, XMLElement>()
  for (const pe of partElements) {
    const id = getAttribute(pe, 'id') || ''
    partMap.set(id, pe)
  }

  // Convert each part to ClipNode
  const clips: ClipNode[] = []
  const names: string[] = []

  if (options?.mergeAllParts) {
    // Merge all parts into one clip
    const allOperations: ClipOperation[] = []
    let globalTempo: number | undefined
    let globalTimeSig: TimeSignatureString | undefined

    for (const partInfo of filteredParts) {
      const partElement = partMap.get(partInfo.id)
      if (!partElement) {
        warnings.push(`Part "${partInfo.id}" not found in document`)
        continue
      }

      const { operations, tempo, timeSignature } = convertPart(partElement, partInfo.name, options, warnings)
      
      // Use first part's tempo/time signature as global
      if (!globalTempo && tempo) globalTempo = tempo
      if (!globalTimeSig && timeSignature) globalTimeSig = timeSignature

      allOperations.push(...operations)
    }

    // Sort by position (if we had position tracking)
    // For now, just concatenate

    const clip: ClipNode = {
      _version: SCHEMA_VERSION,
      kind: 'clip',
      name: 'Merged',
      operations: allOperations,
      tempo: globalTempo,
      timeSignature: globalTimeSig
    }

    clips.push(clip)
    names.push('Merged')
  } else {
    // Keep parts separate
    for (const partInfo of filteredParts) {
      const partElement = partMap.get(partInfo.id)
      if (!partElement) {
        warnings.push(`Part "${partInfo.id}" not found in document`)
        continue
      }

      const { operations, tempo, timeSignature } = convertPart(partElement, partInfo.name, options, warnings)

      const clip: ClipNode = {
        _version: SCHEMA_VERSION,
        kind: 'clip',
        name: partInfo.name,
        operations,
        tempo,
        timeSignature
      }

      clips.push(clip)
      names.push(partInfo.name)
    }
  }

  // Handle empty result
  if (clips.length === 0) {
    clips.push({
      _version: SCHEMA_VERSION,
      kind: 'clip',
      name: 'Empty',
      operations: []
    })
    names.push('Empty')
    warnings.push('No parts found in MusicXML document')
  }

  return { clips, names, warnings }
}

interface PartConversionResult {
  operations: ClipOperation[]
  tempo?: number
  timeSignature?: TimeSignatureString
}

function convertPart(
  partElement: XMLElement,
  partName: string,
  options: MusicXMLImportOptions | undefined,
  warnings: string[]
): PartConversionResult {
  const operations: ClipOperation[] = []
  let firstTempo: number | undefined
  let firstTimeSig: TimeSignatureString | undefined

  // Context that persists across measures
  const context: MeasureContext = {
    divisions: 1,
    timeSignature: '4/4',
    dynamics: 0.8 // Default mf
  }

  const measures = getElements(partElement, 'measure')
  
  // Filter measures if range specified
  let measureRange = measures
  if (options?.measures) {
    const [start, end] = options.measures
    measureRange = measures.slice(start - 1, end) // Convert to 0-indexed
  }

  for (let measureIndex = 0; measureIndex < measureRange.length; measureIndex++) {
    const measure = measureRange[measureIndex]
    const measureNumber = getAttributeInt(measure, 'number', measureIndex + 1)

    // Process attributes (divisions, time signature, key, etc.)
    const attributes = getElement(measure, 'attributes')
    if (attributes) {
      // Divisions
      const divisionsText = getChildText(attributes, 'divisions')
      if (divisionsText) {
        context.divisions = parseInt(divisionsText, 10) || 1
      }

      // Time signature
      const timeEl = getElement(attributes, 'time')
      if (timeEl) {
        const beats = getChildText(timeEl, 'beats') || '4'
        const beatType = getChildText(timeEl, 'beat-type') || '4'
        const newTimeSig = `${beats}/${beatType}` as TimeSignatureString
        
        if (context.timeSignature !== newTimeSig) {
          context.timeSignature = newTimeSig
          operations.push({
            kind: 'time_signature',
            signature: newTimeSig
          } as TimeSignatureOp)
          
          if (!firstTimeSig) firstTimeSig = newTimeSig
        }
      }
    }

    // Process direction (tempo, dynamics)
    const directions = getDirectChildren(measure, 'direction')
    for (const direction of directions) {
      const sound = getElement(direction, 'sound')
      if (sound) {
        const tempoStr = getAttribute(sound, 'tempo')
        if (tempoStr) {
          const tempo = parseFloat(tempoStr)
          if (!isNaN(tempo)) {
            context.tempo = tempo
            operations.push({
              kind: 'tempo',
              bpm: Math.round(tempo)
            } as TempoOp)
            
            if (!firstTempo) firstTempo = tempo
          }
        }

        const dynamicsStr = getAttribute(sound, 'dynamics')
        if (dynamicsStr) {
          const dynamics = parseFloat(dynamicsStr)
          if (!isNaN(dynamics)) {
            context.dynamics = dynamics / 100 // Convert to 0-1
          }
        }
      }

      // Check for dynamics text (pp, p, mp, mf, f, ff, etc.)
      const dynamicsEl = getElement(direction, 'dynamics')
      if (dynamicsEl) {
        const dynamicsValue = parseDynamicsElement(dynamicsEl)
        if (dynamicsValue !== null) {
          context.dynamics = dynamicsValue
        }
      }
    }

    // Collect notes in this measure
    const noteElements = getDirectChildren(measure, 'note')
    const noteDataList: NoteData[] = []
    let currentPosition = 0

    for (const noteEl of noteElements) {
      // Check for chord
      const isChord = getElement(noteEl, 'chord') !== null

      // Check for rest
      const isRest = getElement(noteEl, 'rest') !== null

      // Get duration
      const durationText = getChildText(noteEl, 'duration')
      const duration = durationText ? parseInt(durationText, 10) : context.divisions

      // Get voice
      const voiceText = getChildText(noteEl, 'voice')
      const voice = voiceText ? parseInt(voiceText, 10) : 1

      // Get pitch
      let pitch: NoteName | null = null
      if (!isRest) {
        const pitchEl = getElement(noteEl, 'pitch')
        if (pitchEl) {
          pitch = parsePitch(pitchEl)
        }
      }

      // Get ties
      const ties = getElements(noteEl, 'tie')
      let tieStart = false
      let tieEnd = false
      for (const tie of ties) {
        const tieType = getAttribute(tie, 'type')
        if (tieType === 'start') tieStart = true
        if (tieType === 'stop') tieEnd = true
      }

      // Get articulations
      const articulation = parseArticulations(noteEl)

      // Handle position
      if (!isChord) {
        // Not a chord - advance position by previous duration
        // (Position is set before this note)
      }

      const noteData: NoteData = {
        position: isChord ? currentPosition : currentPosition,
        pitch,
        duration,
        voice,
        isChord,
        tieStart,
        tieEnd,
        articulation,
        dynamics: context.dynamics
      }

      noteDataList.push(noteData)

      // Update position for next note (unless this is part of a chord)
      if (!isChord) {
        // Check for forward/backup elements would go here
        // For now, just advance by duration
      }

      // Advance position after non-chord notes
      if (!isChord) {
        currentPosition += duration
      }
    }

    // Process forward/backup elements for position tracking
    const forwardBackups = [...getDirectChildren(measure, 'forward'), ...getDirectChildren(measure, 'backup')]
    for (const fb of forwardBackups) {
      const durationText = getChildText(fb, 'duration')
      const duration = durationText ? parseInt(durationText, 10) : 0
      if (fb.tagName === 'forward') {
        currentPosition += duration
      } else {
        currentPosition -= duration
      }
    }

    // Convert note data to operations
    const measureOps = convertNoteDataToOperations(noteDataList, context.divisions, options?.quantize, warnings)
    operations.push(...measureOps)
  }

  return {
    operations,
    tempo: firstTempo,
    timeSignature: firstTimeSig
  }
}

function convertNoteDataToOperations(
  noteDataList: NoteData[],
  divisions: number,
  quantize: MusicXMLImportOptions['quantize'],
  warnings: string[]
): ClipOperation[] {
  const operations: ClipOperation[] = []

  // Group notes by position for chord detection
  const notesByPosition = new Map<number, NoteData[]>()
  for (const note of noteDataList) {
    const notes = notesByPosition.get(note.position) || []
    notes.push(note)
    notesByPosition.set(note.position, notes)
  }

  // Sort positions
  const positions = Array.from(notesByPosition.keys()).sort((a, b) => a - b)

  let lastPosition = 0

  for (const position of positions) {
    const notes = notesByPosition.get(position)!

    // Add rest if there's a gap
    if (position > lastPosition) {
      const restDivisions = position - lastPosition
      const restDuration = divisionsToNoteDuration(restDivisions, divisions, quantize)
      if (restDuration) {
        operations.push({
          kind: 'rest',
          duration: restDuration
        } as RestOp)
      }
    }

    // Filter out rests (handled separately)
    const pitchedNotes = notes.filter(n => n.pitch !== null)
    const rests = notes.filter(n => n.pitch === null)

    if (pitchedNotes.length === 0 && rests.length > 0) {
      // Only rests at this position
      const rest = rests[0]
      const restDuration = divisionsToNoteDuration(rest.duration, divisions, quantize)
      if (restDuration) {
        operations.push({
          kind: 'rest',
          duration: restDuration
        } as RestOp)
      }
      lastPosition = position + rest.duration
    } else if (pitchedNotes.length === 1) {
      // Single note
      const note = pitchedNotes[0]
      const noteOp = createNoteOpFromData(note, divisions, quantize)
      operations.push(noteOp)
      lastPosition = position + note.duration
    } else if (pitchedNotes.length > 1) {
      // Chord (StackOp)
      const noteOps = pitchedNotes.map(n => createNoteOpFromData(n, divisions, quantize))
      operations.push({
        kind: 'stack',
        operations: noteOps
      } as StackOp)
      // Use the longest duration
      const maxDuration = Math.max(...pitchedNotes.map(n => n.duration))
      lastPosition = position + maxDuration
    }
  }

  return operations
}

function createNoteOpFromData(
  note: NoteData,
  divisions: number,
  quantize?: MusicXMLImportOptions['quantize']
): NoteOp {
  const duration = divisionsToNoteDuration(note.duration, divisions, quantize)

  const noteOp: NoteOp = {
    kind: 'note',
    note: note.pitch!,
    duration: duration || '4n',
    velocity: note.dynamics ?? 0.8
  }

  if (note.articulation) {
    noteOp.articulation = note.articulation
  }

  if (note.tieStart) {
    noteOp.tie = 'start'
  } else if (note.tieEnd) {
    noteOp.tie = 'end'
  }

  return noteOp
}

// --- Utility Functions ---

function parsePitch(pitchEl: XMLElement): NoteName {
  const step = getChildText(pitchEl, 'step') || 'C'
  const octaveText = getChildText(pitchEl, 'octave')
  const octave = octaveText ? parseInt(octaveText, 10) : 4
  const alterText = getChildText(pitchEl, 'alter')
  const alter = alterText ? parseInt(alterText, 10) : 0

  let noteName = step
  if (alter === 1) noteName += '#'
  else if (alter === -1) noteName += 'b'
  else if (alter === 2) noteName += '##'
  else if (alter === -2) noteName += 'bb'

  return `${noteName}${octave}` as NoteName
}

function parseArticulations(noteEl: XMLElement): Articulation | undefined {
  const notations = getElement(noteEl, 'notations')
  if (!notations) return undefined

  const articulations = getElement(notations, 'articulations')
  if (!articulations) return undefined

  // Check for specific articulations
  if (getElement(articulations, 'staccato')) return 'staccato'
  if (getElement(articulations, 'accent')) return 'accent'
  if (getElement(articulations, 'tenuto')) return 'tenuto'
  if (getElement(articulations, 'staccatissimo')) return 'staccato' // Map to staccato

  return undefined
}

function parseDynamicsElement(dynamicsEl: XMLElement): number | null {
  const dynamicsMap: Record<string, number> = {
    'ppp': 0.15,
    'pp': 0.25,
    'p': 0.4,
    'mp': 0.55,
    'mf': 0.7,
    'f': 0.85,
    'ff': 0.95,
    'fff': 1.0
  }

  // Check for dynamic marking elements
  for (const [name, value] of Object.entries(dynamicsMap)) {
    if (getElement(dynamicsEl, name)) {
      return value
    }
  }

  return null
}

function divisionsToNoteDuration(
  divisionValue: number,
  divisions: number,
  quantize?: MusicXMLImportOptions['quantize']
): NoteDuration | null {
  if (divisionValue <= 0) return null

  // Convert divisions to beats (quarter notes)
  let beats = divisionValue / divisions

  // Apply quantization if specified
  if (quantize) {
    const gridBeats = parseDuration(quantize.grid)
    const strength = quantize.strength ?? 1.0
    const nearestGrid = Math.round(beats / gridBeats) * gridBeats
    beats = beats + (nearestGrid - beats) * strength
  }

  // Find the closest standard duration
  const durations: Array<[NoteDuration, number]> = [
    ['1n', 4.0],
    ['2n.', 3.0],
    ['2n', 2.0],
    ['4n.', 1.5],
    ['4n', 1.0],
    ['8n.', 0.75],
    ['8n', 0.5],
    ['16n.', 0.375],
    ['16n', 0.25],
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
