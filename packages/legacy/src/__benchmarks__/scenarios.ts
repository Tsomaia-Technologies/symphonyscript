// =============================================================================
// SymphonyScript - Benchmark Scenarios
// =============================================================================

import type { ClipNode } from '../clip/types'
import { MelodyBuilder } from '../clip/MelodyBuilder'
import { Clip } from '../builder'
import type { MelodyBuilder as NewMelodyBuilder } from '../builder/MelodyBuilder'
import { unsafeNoteName, type NoteName } from '@symphonyscript/core/types/primitives'

// =============================================================================
// Types
// =============================================================================

export type TransformType = 'humanize' | 'quantize' | 'groove'

export interface ScenarioConfig {
  /** Name of the scenario */
  name: string
  /** Total number of notes */
  notes: number
  /** Number of loops (0 = no loops) */
  loops: number
  /** Transforms to apply */
  transforms: TransformType[]
  /** Description for output */
  description: string
}

export interface LegacyScenarioData {
  /** Pre-built ClipNode for compilation */
  clip: ClipNode
}

export interface BuilderScenarioData {
  /** Pre-built bytecode buffer */
  buf: number[]
  /** Groove templates (if any) */
  grooveTemplates: number[][]
}

// =============================================================================
// Scenario Configurations
// =============================================================================

export const SCENARIOS: Record<string, ScenarioConfig> = {
  tiny: {
    name: 'Tiny',
    notes: 10,
    loops: 0,
    transforms: [],
    description: '10 notes, no loops, no transforms'
  },
  small: {
    name: 'Small',
    notes: 100,
    loops: 0,
    transforms: [],
    description: '100 notes, no loops, no transforms'
  },
  medium: {
    name: 'Medium',
    notes: 500,
    loops: 2,
    transforms: ['humanize'],
    description: '500 notes, 2 loops, humanize'
  },
  large: {
    name: 'Large',
    notes: 1000,
    loops: 4,
    transforms: ['humanize', 'quantize'],
    description: '1000 notes, 4 loops, humanize + quantize'
  },
  stress: {
    name: 'Stress',
    notes: 5000,
    loops: 10,
    transforms: ['humanize', 'quantize', 'groove'],
    description: '5000 notes, 10 loops, all transforms'
  }
}

// =============================================================================
// Note Generation Helpers
// =============================================================================

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/**
 * Get a note name for a given index.
 * Cycles through C4-B5 range.
 */
function getNoteForIndex(i: number): NoteName {
  const noteIndex = i % 7
  const octave = 4 + Math.floor((i % 14) / 7)  // Alternates between octave 4 and 5
  return unsafeNoteName(`${NOTES[noteIndex]}${octave}`)
}

// =============================================================================
// Legacy Builder Scenario Creation
// =============================================================================

/**
 * Create a ClipNode using the legacy MelodyBuilder API.
 * This produces AST-based data for the pipeline compiler.
 */
export function createLegacyClip(config: ScenarioConfig): LegacyScenarioData {
  let builder: MelodyBuilder<any> = new MelodyBuilder({ name: `Benchmark-${config.name}` })

  // Apply transforms if requested
  if (config.transforms.includes('humanize')) {
    builder = builder.defaultHumanize({ timing: 0.1, velocity: 0.1 })
  }
  if (config.transforms.includes('quantize')) {
    builder = builder.quantize('8n', { strength: 0.5 })
  }
  // Note: Legacy groove is applied via groove template on builder, not per-note

  if (config.loops > 0) {
    // Distribute notes across loops
    const notesPerLoop = Math.ceil(config.notes / config.loops)

    for (let l = 0; l < config.loops; l++) {
      // Create loop content using builder function
      builder = builder.loop(1, (loopBuilder: MelodyBuilder<any>) => {
        let lb = loopBuilder
        const startNote = l * notesPerLoop
        const endNote = Math.min(startNote + notesPerLoop, config.notes)

        for (let i = startNote; i < endNote; i++) {
          const noteName = getNoteForIndex(i)
          lb = lb.note(noteName, '4n').commit() as MelodyBuilder<any>
        }
        return lb
      }) as MelodyBuilder<any>
    }
  } else {
    // No loops - create notes directly
    for (let i = 0; i < config.notes; i++) {
      const noteName = getNoteForIndex(i)
      builder = builder.note(noteName, '4n').commit() as MelodyBuilder<any>
    }
  }

  return {
    clip: builder.build()
  }
}

// =============================================================================
// New Builder Scenario Creation (RFC-040/041)
// =============================================================================

/**
 * Create Builder Bytecode using the new Clip.melody() API.
 * This produces bytecode for tree-based and zero-alloc compilers.
 */
export function createBuilderClip(config: ScenarioConfig): BuilderScenarioData {
  const grooveTemplates: number[][] = []

  // Start building
  let builder = Clip.melody()

  // Apply transforms if requested (block-scoped)
  if (config.transforms.includes('humanize')) {
    // Use block-scoped humanize
    if (config.transforms.includes('quantize')) {
      // Nested transforms
      builder = builder.humanize({ timing: 0.1, velocity: 0.1 }, hb => {
        return hb.quantize('8n', { strength: 0.5 }, qb => {
          return addNotesToBuilder(qb as NewMelodyBuilder, config)
        })
      })
    } else {
      builder = builder.humanize({ timing: 0.1, velocity: 0.1 }, hb => {
        return addNotesToBuilder(hb as NewMelodyBuilder, config)
      })
    }
  } else if (config.transforms.includes('quantize')) {
    builder = builder.quantize('8n', { strength: 0.5 }, qb => {
      return addNotesToBuilder(qb as NewMelodyBuilder, config)
    })
  } else {
    // No transforms
    builder = addNotesToBuilder(builder, config)
  }

  // Handle groove separately if needed (outside other transforms for clarity)
  if (config.transforms.includes('groove')) {
    // Register a groove template
    grooveTemplates.push([10, -10, 5, -5])  // Simple swing-like pattern
  }

  return {
    buf: builder.buf,
    grooveTemplates
  }
}

/**
 * Helper to add notes to a builder with optional loops.
 */
function addNotesToBuilder(builder: NewMelodyBuilder, config: ScenarioConfig): NewMelodyBuilder {
  if (config.loops > 0) {
    const notesPerLoop = Math.ceil(config.notes / config.loops)

    for (let l = 0; l < config.loops; l++) {
      const startNote = l * notesPerLoop
      const endNote = Math.min(startNote + notesPerLoop, config.notes)

      builder = builder.loop(1, lb => {
        let loopBuilder = lb as NewMelodyBuilder
        for (let i = startNote; i < endNote; i++) {
          const noteName = getNoteForIndex(i)
          loopBuilder = loopBuilder.note(noteName, '4n').builder as NewMelodyBuilder
        }
        return loopBuilder
      }) as NewMelodyBuilder
    }
  } else {
    // No loops - create notes directly
    for (let i = 0; i < config.notes; i++) {
      const noteName = getNoteForIndex(i)
      builder = builder.note(noteName, '4n').builder as NewMelodyBuilder
    }
  }

  return builder
}

// =============================================================================
// Pre-built Scenarios (for repeated benchmarking without setup overhead)
// =============================================================================

export interface PrebuiltScenarios {
  legacy: LegacyScenarioData
  builder: BuilderScenarioData
}

/**
 * Create all scenarios upfront.
 * This separates setup time from benchmark time.
 */
export function prebuildAllScenarios(): Record<string, PrebuiltScenarios> {
  const result: Record<string, PrebuiltScenarios> = {}

  for (const [key, config] of Object.entries(SCENARIOS)) {
    result[key] = {
      legacy: createLegacyClip(config),
      builder: createBuilderClip(config)
    }
  }

  return result
}
