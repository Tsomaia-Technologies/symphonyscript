// =============================================================================
// SymphonyScript - Legacy AST vs Zero-Alloc Parity Tests
// =============================================================================
//
// This test suite verifies MUSICAL EQUIVALENCE between:
// 1. Legacy AST Compiler (compileClip) - the original "source of truth"
// 2. Zero-Alloc Compiler (compileBuilderToVMZeroAlloc) - the new system
//
// Since output formats differ (seconds vs ticks, NoteName vs MIDI numbers),
// we normalize both to a common NormalizedNote[] format and compare.
// =============================================================================

import { describe, it, expect } from '@jest/globals'
import { compileClip } from '../../compiler/pipeline'
import type { CompiledClip } from '../../compiler/pipeline/types'
import { compileBuilderToVMZeroAlloc } from '../compiler-zero-alloc'
import { Clip } from '../index'
import { MelodyBuilder } from '../../clip/MelodyBuilder'
import { OP } from '../../vm/constants'
import { noteToMidi } from '../../util/midi'

// =============================================================================
// Configuration
// =============================================================================

const PPQ = 96
const BPM = 120
const SEED = 12345

// Conversion: seconds → ticks
// At 120 BPM: 1 beat = 0.5 seconds, 1 tick = 0.5/96 seconds
const TICKS_PER_SECOND = (PPQ * BPM) / 60 // 192 ticks/second at 120 BPM

// Tolerance for float→tick conversion (±1 tick)
const TICK_TOLERANCE = 1

// =============================================================================
// Normalized Note Type
// =============================================================================

interface NormalizedNote {
  tickOffset: number
  pitch: number // MIDI number (0-127)
  velocity: number // 0-127
  durationTicks: number
}

// =============================================================================
// Extraction Helpers
// =============================================================================

/**
 * Extract normalized notes from Legacy AST compiler output.
 * Converts seconds → ticks, NoteName → MIDI number.
 * Velocity is already 0-127 (MidiValue type).
 */
function extractLegacyNotes(compiled: CompiledClip): NormalizedNote[] {
  const notes: NormalizedNote[] = []

  for (const event of compiled.events) {
    if (event.kind === 'note') {
      // Convert NoteName string (e.g., "C4") to MIDI number (e.g., 60)
      const midiPitch = noteToMidi(event.payload.pitch)
      if (midiPitch === null) {
        throw new Error(`Invalid pitch: ${event.payload.pitch}`)
      }

      notes.push({
        tickOffset: Math.round(event.startSeconds * TICKS_PER_SECOND),
        pitch: midiPitch,
        velocity: event.payload.velocity, // Already 0-127 (MidiValue)
        durationTicks: Math.round(event.durationSeconds * TICKS_PER_SECOND)
      })
    }
  }

  // Sort by tick offset, then pitch (for consistent comparison)
  return notes.sort((a, b) => {
    if (a.tickOffset !== b.tickOffset) return a.tickOffset - b.tickOffset
    return a.pitch - b.pitch
  })
}

/**
 * Extract normalized notes from Zero-Alloc compiler output.
 * Parses VM bytecode directly and accumulates note events.
 */
function extractZeroAllocNotes(vmBytecode: Int32Array): NormalizedNote[] {
  const notes: NormalizedNote[] = []
  let currentTick = 0
  let i = 0

  while (i < vmBytecode.length) {
    const op = vmBytecode[i]

    if (op === OP.EOF) {
      break
    } else if (op === OP.REST) {
      currentTick += vmBytecode[i + 1]
      i += 2
    } else if (op === OP.NOTE) {
      notes.push({
        tickOffset: currentTick,
        pitch: vmBytecode[i + 1],
        velocity: vmBytecode[i + 2],
        durationTicks: vmBytecode[i + 3]
      })
      currentTick += vmBytecode[i + 3]
      i += 4
    } else if (op === OP.LOOP_START) {
      // LOOP_START has count argument
      i += 2
    } else if (op === OP.STACK_START) {
      // STACK_START has branch count argument
      i += 2
    } else if (
      op === OP.LOOP_END ||
      op === OP.STACK_END ||
      op === OP.BRANCH_START ||
      op === OP.BRANCH_END
    ) {
      i += 1
    } else if (op === OP.TEMPO) {
      i += 2
    } else if (op === OP.CC) {
      // CC: [opcode, controller, value, duration]
      i += 4
    } else if (op === OP.BEND) {
      // BEND: [opcode, value, duration]
      i += 3
    } else {
      // Unknown opcode - skip single byte and warn
      console.warn(`Unknown opcode at ${i}: ${op}`)
      i += 1
    }
  }

  // Sort by tick offset, then pitch
  return notes.sort((a, b) => {
    if (a.tickOffset !== b.tickOffset) return a.tickOffset - b.tickOffset
    return a.pitch - b.pitch
  })
}

// =============================================================================
// Comparison Helper
// =============================================================================

interface ComparisonResult {
  match: boolean
  errors: string[]
}

/**
 * Compare two normalized note arrays with tolerance.
 */
function compareNotes(
  legacy: NormalizedNote[],
  zeroAlloc: NormalizedNote[],
  tolerance: number = TICK_TOLERANCE
): ComparisonResult {
  const errors: string[] = []

  if (legacy.length !== zeroAlloc.length) {
    errors.push(
      `Note count mismatch: Legacy=${legacy.length}, Zero-Alloc=${zeroAlloc.length}`
    )
    return { match: false, errors }
  }

  for (let i = 0; i < legacy.length; i++) {
    const l = legacy[i]
    const z = zeroAlloc[i]

    // Pitch must match exactly
    if (l.pitch !== z.pitch) {
      errors.push(
        `Note ${i}: Pitch mismatch - Legacy=${l.pitch}, Zero-Alloc=${z.pitch}`
      )
    }

    // Velocity must match exactly
    if (l.velocity !== z.velocity) {
      errors.push(
        `Note ${i}: Velocity mismatch - Legacy=${l.velocity}, Zero-Alloc=${z.velocity}`
      )
    }

    // Tick offset with tolerance
    if (Math.abs(l.tickOffset - z.tickOffset) > tolerance) {
      errors.push(
        `Note ${i}: Tick offset mismatch - Legacy=${l.tickOffset}, Zero-Alloc=${z.tickOffset} (tolerance=${tolerance})`
      )
    }

    // Duration with tolerance
    if (Math.abs(l.durationTicks - z.durationTicks) > tolerance) {
      errors.push(
        `Note ${i}: Duration mismatch - Legacy=${l.durationTicks}, Zero-Alloc=${z.durationTicks} (tolerance=${tolerance})`
      )
    }
  }

  return { match: errors.length === 0, errors }
}

// =============================================================================
// Test Case Interface
// =============================================================================

interface LegacyParityTest {
  name: string
  /** Create Legacy clip using MelodyBuilder */
  createLegacy: () => ReturnType<MelodyBuilder['build']>
  /** Create Builder bytecode using Clip.melody() */
  createBuilder: () => { buf: number[]; grooveTemplates: number[][] }
}

// =============================================================================
// Test Cases
// =============================================================================

const BASIC_TESTS: LegacyParityTest[] = [
  {
    name: 'simple note sequence',
    createLegacy: () =>
      new MelodyBuilder({ name: 'test' })
        .note('C4', '4n')
        .commit()
        .note('D4', '4n')
        .commit()
        .note('E4', '4n')
        .commit()
        .build(),
    createBuilder: () => ({
      // Set velocity to 1.0 (127) to match Legacy default
      buf: Clip.melody()
        .setVelocity(1.0)
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n').builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'notes with rests',
    createLegacy: () =>
      new MelodyBuilder({ name: 'test' })
        .note('C4', '4n')
        .commit()
        .rest('4n')
        .note('D4', '4n')
        .commit()
        .build(),
    createBuilder: () => ({
      buf: Clip.melody()
        .setVelocity(1.0)
        .note('C4', '4n')
        .rest('4n')
        .note('D4', '4n').builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'various durations',
    createLegacy: () =>
      new MelodyBuilder({ name: 'test' })
        .note('C4', '1n')
        .commit()
        .note('D4', '2n')
        .commit()
        .note('E4', '4n')
        .commit()
        .note('F4', '8n')
        .commit()
        .note('G4', '16n')
        .commit()
        .build(),
    createBuilder: () => ({
      buf: Clip.melody()
        .setVelocity(1.0)
        .note('C4', '1n')
        .note('D4', '2n')
        .note('E4', '4n')
        .note('F4', '8n')
        .note('G4', '16n').builder.buf,
      grooveTemplates: []
    })
  }
]

const PITCH_TESTS: LegacyParityTest[] = [
  {
    name: 'chromatic scale',
    createLegacy: () => {
      const notes = [
        'C4',
        'C#4',
        'D4',
        'D#4',
        'E4',
        'F4',
        'F#4',
        'G4',
        'G#4',
        'A4',
        'A#4',
        'B4'
      ] as const
      let builder: MelodyBuilder<any> = new MelodyBuilder({ name: 'test' })
      for (const note of notes) {
        builder = builder.note(note, '8n').commit() as MelodyBuilder<any>
      }
      return builder.build()
    },
    createBuilder: () => {
      const notes = [
        'C4',
        'C#4',
        'D4',
        'D#4',
        'E4',
        'F4',
        'F#4',
        'G4',
        'G#4',
        'A4',
        'A#4',
        'B4'
      ] as const
      let cursor = Clip.melody().setVelocity(1.0)
      for (const note of notes) {
        cursor = cursor.note(note, '8n')
      }
      return { buf: cursor.builder.buf, grooveTemplates: [] }
    }
  },
  {
    name: 'wide octave range',
    createLegacy: () =>
      new MelodyBuilder({ name: 'test' })
        .note('C2', '4n')
        .commit()
        .note('C3', '4n')
        .commit()
        .note('C4', '4n')
        .commit()
        .note('C5', '4n')
        .commit()
        .note('C6', '4n')
        .commit()
        .build(),
    createBuilder: () => ({
      buf: Clip.melody()
        .setVelocity(1.0)
        .note('C2', '4n')
        .note('C3', '4n')
        .note('C4', '4n')
        .note('C5', '4n')
        .note('C6', '4n').builder.buf,
      grooveTemplates: []
    })
  }
]

const SCALE_TESTS: LegacyParityTest[] = [
  {
    name: 'medium scale (50 notes)',
    createLegacy: () => {
      let builder: MelodyBuilder<any> = new MelodyBuilder({ name: 'test' })
      for (let i = 0; i < 50; i++) {
        builder = builder.note('C4', '8n').commit() as MelodyBuilder<any>
      }
      return builder.build()
    },
    createBuilder: () => {
      let cursor = Clip.melody().setVelocity(1.0)
      for (let i = 0; i < 50; i++) {
        cursor = cursor.note('C4', '8n')
      }
      return { buf: cursor.builder.buf, grooveTemplates: [] }
    }
  },
  {
    name: 'large scale (100 notes)',
    createLegacy: () => {
      let builder: MelodyBuilder<any> = new MelodyBuilder({ name: 'test' })
      for (let i = 0; i < 100; i++) {
        builder = builder.note('C4', '16n').commit() as MelodyBuilder<any>
      }
      return builder.build()
    },
    createBuilder: () => {
      let cursor = Clip.melody().setVelocity(1.0)
      for (let i = 0; i < 100; i++) {
        cursor = cursor.note('C4', '16n')
      }
      return { buf: cursor.builder.buf, grooveTemplates: [] }
    }
  }
]

// =============================================================================
// Test Helper
// =============================================================================

function runLegacyParityTest(test: LegacyParityTest) {
  // Compile with Legacy AST
  const legacyClip = test.createLegacy()
  const legacyResult = compileClip(legacyClip, {
    bpm: BPM,
    seed: SEED
  })

  // Compile with Zero-Alloc
  const { buf, grooveTemplates } = test.createBuilder()
  const zeroResult = compileBuilderToVMZeroAlloc(buf, {
    ppq: PPQ,
    seed: SEED,
    grooveTemplates,
    unroll: true // Unroll loops for direct comparison
  })

  // Extract normalized notes
  const legacyNotes = extractLegacyNotes(legacyResult)
  const zeroNotes = extractZeroAllocNotes(zeroResult.vmBytecode)

  // Compare
  const comparison = compareNotes(legacyNotes, zeroNotes)

  if (!comparison.match) {
    console.error(`Parity failure for "${test.name}":`)
    for (const error of comparison.errors) {
      console.error(`  - ${error}`)
    }
    console.error('Legacy notes:', JSON.stringify(legacyNotes, null, 2))
    console.error('Zero-Alloc notes:', JSON.stringify(zeroNotes, null, 2))
  }

  return { comparison, legacyNotes, zeroNotes }
}

// =============================================================================
// Test Runner
// =============================================================================

describe('Legacy AST vs Zero-Alloc Parity', () => {
  // =========================================================================
  // Basic Scenarios
  // =========================================================================
  describe('Basic Scenarios', () => {
    for (const test of BASIC_TESTS) {
      it(test.name, () => {
        const { comparison } = runLegacyParityTest(test)
        expect(comparison.match).toBe(true)
      })
    }
  })

  // =========================================================================
  // Pitch Scenarios
  // =========================================================================
  describe('Pitch Scenarios', () => {
    for (const test of PITCH_TESTS) {
      it(test.name, () => {
        const { comparison } = runLegacyParityTest(test)
        expect(comparison.match).toBe(true)
      })
    }
  })

  // =========================================================================
  // Scale Scenarios
  // =========================================================================
  describe('Scale Scenarios', () => {
    for (const test of SCALE_TESTS) {
      it(test.name, () => {
        const { comparison } = runLegacyParityTest(test)
        expect(comparison.match).toBe(true)
      })
    }
  })

  // =========================================================================
  // Verification Tests
  // =========================================================================
  describe('Verification Tests', () => {
    it('both compilers produce same number of notes', () => {
      const legacyClip = new MelodyBuilder({ name: 'test' })
        .note('C4', '4n')
        .commit()
        .note('D4', '4n')
        .commit()
        .note('E4', '4n')
        .commit()
        .note('F4', '4n')
        .commit()
        .note('G4', '4n')
        .commit()
        .build()

      const buf = Clip.melody()
        .setVelocity(1.0)
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .note('F4', '4n')
        .note('G4', '4n').builder.buf

      const legacyResult = compileClip(legacyClip, { bpm: BPM, seed: SEED })
      const zeroResult = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: true
      })

      const legacyNotes = extractLegacyNotes(legacyResult)
      const zeroNotes = extractZeroAllocNotes(zeroResult.vmBytecode)

      expect(legacyNotes.length).toBe(5)
      expect(zeroNotes.length).toBe(5)
    })

    it('MIDI pitch values match exactly', () => {
      const pitches = ['C4', 'E4', 'G4', 'C5'] as const // C major chord

      let legacyBuilder: MelodyBuilder<any> = new MelodyBuilder({ name: 'test' })
      for (const p of pitches) {
        legacyBuilder = legacyBuilder.note(p, '4n').commit() as MelodyBuilder<any>
      }

      let cursor = Clip.melody().setVelocity(1.0)
      for (const p of pitches) {
        cursor = cursor.note(p, '4n')
      }

      const legacyResult = compileClip(legacyBuilder.build(), {
        bpm: BPM,
        seed: SEED
      })
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: true
      })

      const legacyPitches = extractLegacyNotes(legacyResult).map((n) => n.pitch)
      const zeroPitches = extractZeroAllocNotes(zeroResult.vmBytecode).map(
        (n) => n.pitch
      )

      // Expected: C4=60, E4=64, G4=67, C5=72
      expect(zeroPitches).toEqual(legacyPitches)
      expect(zeroPitches).toEqual([60, 64, 67, 72])
    })

    it('note durations are equivalent within tolerance', () => {
      // Quarter note = 96 ticks at 96 PPQ
      const legacyClip = new MelodyBuilder({ name: 'test' })
        .note('C4', '4n')
        .commit()
        .build()

      const buf = Clip.melody().setVelocity(1.0).note('C4', '4n').builder.buf

      const legacyResult = compileClip(legacyClip, { bpm: BPM, seed: SEED })
      const zeroResult = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: true
      })

      const legacyNotes = extractLegacyNotes(legacyResult)
      const zeroNotes = extractZeroAllocNotes(zeroResult.vmBytecode)

      // Both should be ~96 ticks (tolerance for float conversion)
      expect(legacyNotes[0].durationTicks).toBeCloseTo(96, 0) // Within integer
      expect(zeroNotes[0].durationTicks).toBe(96)
      expect(
        Math.abs(legacyNotes[0].durationTicks - zeroNotes[0].durationTicks)
      ).toBeLessThanOrEqual(TICK_TOLERANCE)
    })
  })
})
