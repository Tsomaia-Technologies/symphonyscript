// =============================================================================
// SymphonyScript - Export Types
// =============================================================================

import type { CompiledClip, CompiledEvent, TempoMap } from '../compiler/pipeline/types'
import type { CompiledOutput } from '../compiler/types'
import type { ClipNode } from '../clip/types'
import type { SessionNode } from '../session/types'

// =============================================================================
// MIDI Export Types
// =============================================================================

/**
 * Options for MIDI file export.
 */
export interface MidiExportOptions {
  /**
   * SMF format type.
   * - 0: Single track (all events merged)
   * - 1: Multi-track synchronous (separate tracks, common timeline)
   * @default 1
   */
  format?: 0 | 1

  /**
   * Pulses (ticks) per quarter note.
   * Higher values = more timing precision.
   * @default 480
   */
  ppq?: number

  /**
   * Include a separate conductor track for tempo and time signature events.
   * Only applies to format 1.
   * @default true
   */
  includeTempoTrack?: boolean

  /**
   * Include time signature meta events.
   * @default true
   */
  includeTimeSignatures?: boolean

  /**
   * Include track name meta events.
   * @default true
   */
  includeTrackNames?: boolean
}

/**
 * Result of MIDI export operation.
 */
export interface MidiExportResult {
  /** Raw MIDI file data as ArrayBuffer */
  buffer: ArrayBuffer
  /** Number of tracks in the exported file */
  trackCount: number
  /** Total duration in ticks */
  durationTicks: number
  /** PPQ used for export */
  ppq: number
}

// =============================================================================
// MusicXML Export Types
// =============================================================================

/**
 * Options for MusicXML export.
 */
export interface MusicXMLExportOptions {
  /**
   * Work title for the score.
   */
  title?: string

  /**
   * Composer/creator name.
   */
  creator?: string

  /**
   * Custom part names mapping.
   * Keys are track indices or instrument IDs, values are display names.
   */
  partNames?: Record<string, string>

  /**
   * Divisions per quarter note for duration encoding.
   * Higher values = more duration precision.
   * @default 4
   */
  divisions?: number

  /**
   * Include tempo markings in the output.
   * @default true
   */
  includeTempo?: boolean

  /**
   * Include dynamics markings.
   * @default true
   */
  includeDynamics?: boolean
}

/**
 * Result of MusicXML export operation.
 */
export interface MusicXMLExportResult {
  /** MusicXML document as string */
  xml: string
  /** Number of parts in the score */
  partCount: number
  /** Total number of measures */
  measureCount: number
}

// =============================================================================
// Internal MIDI Types (for building MIDI files)
// =============================================================================

/**
 * Internal representation of a MIDI event with timing.
 */
export interface MidiTrackEvent {
  /** Absolute tick position */
  tick: number
  /** Delta time from previous event (calculated during serialization) */
  deltaTick?: number
  /** Event data bytes (excluding delta time) */
  data: Uint8Array
}

/**
 * Internal representation of a MIDI track.
 */
export interface MidiTrackData {
  /** Track name (optional) */
  name?: string
  /** MIDI channel (0-15) */
  channel: number
  /** Events in this track */
  events: MidiTrackEvent[]
}

/**
 * Input types that can be exported to MIDI.
 */
export type MidiExportInput = CompiledClip | CompiledOutput

/**
 * Input types that can be exported to MusicXML.
 */
export type MusicXMLExportInput = ClipNode | SessionNode

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if input is a CompiledClip.
 */
export function isCompiledClip(input: MidiExportInput): input is CompiledClip {
  return 'events' in input && 'tempoMap' in input && 'durationSeconds' in input
}

/**
 * Check if input is a CompiledOutput.
 */
export function isCompiledOutput(input: MidiExportInput): input is CompiledOutput {
  return 'timeline' in input && 'manifest' in input && 'meta' in input
}

/**
 * Check if input is a ClipNode.
 */
export function isClipNode(input: MusicXMLExportInput): input is ClipNode {
  return 'kind' in input && input.kind === 'clip'
}

/**
 * Check if input is a SessionNode.
 */
export function isSessionNode(input: MusicXMLExportInput): input is SessionNode {
  return 'kind' in input && input.kind === 'session'
}
