// =============================================================================
// SymphonyScript - VM Types
// =============================================================================

/**
 * VM Event - Discriminated union for events emitted by the VM.
 * All events share tick timing; payload varies by type.
 */
export type VMEvent =
  | VMNoteEvent
  | VMControlEvent
  | VMBendEvent

export interface VMNoteEvent {
  type: 'note'
  tick: number
  pitch: number      // MIDI note number (0-127)
  velocity: number   // MIDI velocity (0-127)
  duration: number   // Duration in ticks
}

export interface VMControlEvent {
  type: 'cc'
  tick: number
  controller: number // MIDI CC number (0-127)
  value: number      // CC value (0-127)
}

export interface VMBendEvent {
  type: 'bend'
  tick: number
  value: number      // Pitch bend value (0-16383, center 8192)
}

/**
 * Assembler options for bytecode generation.
 */
export interface AssemblerOptions {
  /** Initial tempo in BPM (default: 120) */
  bpm?: number
  /** Pulses per quarter note (default: 96) */
  ppq?: number
  /** Event ring buffer capacity in entries (default: 10000) */
  eventCapacity?: number
  /** Tempo change buffer capacity (default: 100) */
  tempoCapacity?: number
}

/**
 * VM State type alias for type safety.
 */
export type VMStateValue = 0x00 | 0x01 | 0x02 | 0x03
