// =============================================================================
// SymphonyScript - Import Types
// =============================================================================

import type { QuantizeSettings, ClipNode } from '../clip/types'

/**
 * Options for MIDI file import.
 */
export interface MidiImportOptions {
  /**
   * Quantization settings (reuses RFC-028 QuantizeSettings).
   * Snaps note start times and optionally durations to a grid.
   */
  quantize?: QuantizeSettings

  /**
   * Ignore notes below this velocity threshold (0-127).
   * Useful for filtering out ghost notes or noise.
   */
  velocityThreshold?: number

  /**
   * Merge all tracks into a single clip (default: false).
   * When true, all tracks are combined into one ClipNode.
   * When false, each track becomes a separate ClipNode.
   */
  mergeAllTracks?: boolean

  /**
   * Preserve exact tick timing as numeric beat values (default: false).
   * When true, durations are stored as exact beat numbers instead of
   * being quantized to standard note values like '4n', '8n'.
   * Useful for precision workflows or when the exact timing matters.
   */
  preserveExactTiming?: boolean

  /**
   * Pitch bend range in semitones (default: 2).
   * Standard MIDI uses ±2 semitones, but some synths use 12 or 24.
   */
  pitchBendRange?: number
}

/**
 * Options for MusicXML file import.
 */
export interface MusicXMLImportOptions {
  /**
   * Filter specific part IDs to import.
   * If not specified, all parts are imported.
   */
  parts?: string[]

  /**
   * Measure range [start, end] (1-indexed, inclusive).
   * Only measures within this range will be imported.
   */
  measures?: [number, number]

  /**
   * Quantization settings (reuses RFC-028 QuantizeSettings).
   * Snaps note start times and optionally durations to a grid.
   */
  quantize?: QuantizeSettings

  /**
   * Merge all parts into a single clip (default: false).
   * When true, all parts are combined into one ClipNode.
   * When false, each part becomes a separate ClipNode.
   */
  mergeAllParts?: boolean
}

/**
 * Result for single-clip import.
 * Use this when importing with merge option or when only one track/part exists.
 */
export interface ClipImportResult {
  /** The imported clip (sheet music) */
  clip: ClipNode
  /** Non-fatal warnings encountered during import */
  warnings: string[]
}

/**
 * Result for multi-track/part import.
 * Use this when importing multiple tracks or parts as separate clips.
 */
export interface MultiClipImportResult {
  /** Array of imported clips (one per track/part) */
  clips: ClipNode[]
  /** Track/part names from source file (same order as clips) */
  names: string[]
  /** Non-fatal warnings encountered during import */
  warnings: string[]
}
