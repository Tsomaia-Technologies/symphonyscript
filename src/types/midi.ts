/**
 * SymphonyScript - Rigid MIDI Type Definitions
 */

/**
 * Branded type for 7-bit MIDI values (0-127).
 */
export type MidiValue = number & { readonly __brand: 'MidiValue' }

/**
 * Branded type for MIDI Channel (1-16).
 * Note: Internal MIDI processing is often 0-indexed, but this typifies the user-facing 1-16.
 */
export type MidiChannel = number & { readonly __brand: 'MidiChannel' }

/**
 * Branded type for MIDI Control Change (CC) numbers (0-127).
 */
export type MidiControlID = number & { readonly __brand: 'MidiControlID' }

/**
 * Helper to validate and brand a MIDI Value (0-127).
 */
export function midiValue(val: number): MidiValue {
  if (val < 0 || val > 127 || !Number.isInteger(val)) {
    throw new Error(`Invalid MIDI value: ${val}. Must be integer 0-127.`)
  }
  return val as MidiValue
}

/**
 * Helper to validate and brand a MIDI Octave (-2 to 8 usually).
 */
export function midiChannel(val: number): MidiChannel {
  if (val < 1 || val > 16 || !Number.isInteger(val)) {
    throw new Error(`Invalid MIDI Channel: ${val}. Must be integer 1-16.`)
  }
  return val as MidiChannel
}

/**
 * Helper to validate and brand a MIDI CC ID.
 */
export function midiControl(val: number): MidiControlID {
  if (val < 0 || val > 127 || !Number.isInteger(val)) {
    throw new Error(`Invalid MIDI CC: ${val}. Must be integer 0-127.`)
  }
  return val as MidiControlID
}

/**
 * Standard MIDI Control Change (CC) Numbers.
 * Use these constants instead of raw numbers for readability and safety.
 */
export const CC = {
  ModWheel: 1 as MidiControlID,
  Breath: 2 as MidiControlID,
  FootPedal: 4 as MidiControlID,
  PortamentoTime: 5 as MidiControlID,
  Volume: 7 as MidiControlID,
  Balance: 8 as MidiControlID,
  Pan: 10 as MidiControlID,
  Expression: 11 as MidiControlID,
  EffectControl1: 12 as MidiControlID,
  EffectControl2: 13 as MidiControlID,
  Sustain: 64 as MidiControlID,
  PortamentoSwitch: 65 as MidiControlID,
  Sostenuto: 66 as MidiControlID,
  SoftPedal: 67 as MidiControlID,
  LegatoSwitch: 68 as MidiControlID,
  Resonance: 71 as MidiControlID,
  ReleaseTime: 72 as MidiControlID,
  AttackTime: 73 as MidiControlID,
  Frequency: 74 as MidiControlID, // Brightness/Filter Cutoff in MPE/GM2
  DecayTime: 75 as MidiControlID,
  VibratoRate: 76 as MidiControlID,
  VibratoDepth: 77 as MidiControlID,
  VibratoDelay: 78 as MidiControlID,
  SoundControl10: 79 as MidiControlID,
  ReverbSend: 91 as MidiControlID,
  ChorusSend: 93 as MidiControlID,
  AllSoundOff: 120 as MidiControlID,
  ResetControllers: 121 as MidiControlID,
  AllNotesOff: 123 as MidiControlID,
} as const
