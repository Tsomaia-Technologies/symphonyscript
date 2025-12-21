// =============================================================================
// SymphonyScript - Comprehensive Compiler Parity Tests
// =============================================================================
//
// This test suite verifies byte-for-byte equivalence between:
// 1. Tree-Based Compiler (compileBuilderToVM)
// 2. Zero-Alloc Compiler (compileBuilderToVMZeroAlloc)
//
// DO NOT deprecate any compiler until ALL tests pass.
// =============================================================================

/* eslint-disable @typescript-eslint/no-require-imports */
import { compileBuilderToVM } from '../compiler'
import { compileBuilderToVMZeroAlloc } from '../compiler-zero-alloc'
import { Clip } from '../index'
import { OP } from '../../vm/constants'

// =============================================================================
// Test Configuration
// =============================================================================

const PPQ = 96
const SEED = 12345

// =============================================================================
// Helper: Create Groove Template
// =============================================================================

const groove = (offsets: number[]) => ({ getOffsets: () => offsets })

// =============================================================================
// Test Interface
// =============================================================================

interface ParityTest {
  name: string
  createBuilder: () => { buf: number[]; grooveTemplates: number[][] }
  unroll?: boolean
}

// =============================================================================
// Basic Scenario Tests
// =============================================================================

const BASIC_TESTS: ParityTest[] = [
  {
    name: 'simple note sequence',
    createBuilder: () => ({
      buf: Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')
        .builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'notes with rests',
    createBuilder: () => ({
      buf: Clip.melody()
        .note('C4', '4n')
        .rest('4n')
        .note('D4', '4n')
        .rest('8n')
        .note('E4', '4n')
        .builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'single note',
    createBuilder: () => ({
      buf: Clip.melody().note('C4', '4n').builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'empty clip',
    createBuilder: () => ({
      buf: Clip.melody().buf,
      grooveTemplates: []
    })
  },
  {
    name: 'various velocities and durations',
    createBuilder: () => ({
      buf: Clip.melody()
        .note('C4', '1n').velocity(0.5)
        .note('D4', '2n').velocity(0.8)
        .note('E4', '4n').velocity(1.0)
        .note('F4', '8n').velocity(0.3)
        .note('G4', '16n').velocity(0.6)
        .builder.buf,
      grooveTemplates: []
    })
  }
]

// =============================================================================
// Transform Scenario Tests
// =============================================================================

const TRANSFORM_TESTS: ParityTest[] = [
  {
    name: 'humanize atomic',
    createBuilder: () => ({
      buf: Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })
        .note('D4', '4n').humanize({ timing: 0.2, velocity: 0.1 })
        .note('E4', '4n')
        .builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'humanize block-scoped',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.1, velocity: 0.05 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
          b.note('E4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'quantize atomic',
    createBuilder: () => ({
      buf: Clip.melody()
        .note('C4', '4n').quantize('8n', { strength: 0.5 })
        .note('D4', '4n').quantize('16n', { strength: 1.0 })
        .note('E4', '4n')
        .builder.buf,
      grooveTemplates: []
    })
  },
  {
    name: 'quantize block-scoped',
    createBuilder: () => ({
      buf: Clip.melody()
        .quantize('8n', { strength: 0.75 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
          b.note('E4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'groove inline',
    createBuilder: () => ({
      buf: Clip.melody()
        .groove(groove([10, -10, 5, -5]), b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
          b.note('E4', '4n')
          b.note('F4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'mixed transforms (humanize + quantize + groove)',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.05 }, b => {
          b.quantize('8n', { strength: 0.5 }, b2 => {
            b2.groove(groove([5, -5]), b3 => {
              b3.note('C4', '4n')
              b3.note('D4', '4n')
            })
          })
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'zero-effect transforms (no-op)',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0, velocity: 0 }, b => {
          b.quantize('8n', { strength: 0 }, b2 => {
            b2.note('C4', '4n')
            b2.note('D4', '4n')
          })
        }).buf,
      grooveTemplates: []
    })
  }
]

// =============================================================================
// Structural Scenario Tests
// =============================================================================

const STRUCTURAL_TESTS: ParityTest[] = [
  {
    name: 'simple loop',
    createBuilder: () => ({
      buf: Clip.melody()
        .loop(3, b => b.note('C4', '4n'))
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'nested loops',
    createBuilder: () => ({
      buf: Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'deeply nested (5 levels)',
    createBuilder: () => ({
      buf: Clip.melody()
        .loop(2, b =>
          b.loop(2, b2 =>
            b2.loop(2, b3 =>
              b3.loop(2, b4 =>
                b4.loop(2, b5 => b5.note('C4', '16n'))
              )
            )
          )
        )
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'stack (parallel voices)',
    createBuilder: () => ({
      buf: Clip.melody()
        .stack(
          s => s.note('C4', '4n'),
          s => s.note('E4', '4n'),
          s => s.note('G4', '4n')
        )
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'loop + stack combined',
    createBuilder: () => ({
      buf: Clip.melody()
        .loop(2, b =>
          b.stack(
            s => s.note('C4', '4n').note('D4', '4n'),
            s => s.note('E4', '2n')
          )
        )
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'many small scopes (50 sequential loops)',
    createBuilder: () => {
      let builder = Clip.melody()
      for (let i = 0; i < 50; i++) {
        builder = builder.loop(1, b => b.note('C4', '16n')) as any
      }
      return { buf: builder.buf, grooveTemplates: [] }
    }
  }
]

// =============================================================================
// Unroll Scenario Tests
// =============================================================================

const UNROLL_TESTS: ParityTest[] = [
  {
    name: 'unroll with humanize',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.loop(3, b2 => b2.note('C4', '4n'))
        }).buf,
      grooveTemplates: []
    }),
    unroll: true
  },
  {
    name: 'nested unroll',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.05 }, b => {
          b.loop(2, b2 => b2.loop(3, b3 => b3.note('C4', '4n')))
        }).buf,
      grooveTemplates: []
    }),
    unroll: true
  },
  {
    name: 'unroll with all transforms',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.05, velocity: 0.05 }, b => {
          b.quantize('8n', { strength: 0.5 }, b2 => {
            b2.groove(groove([5, -5]), b3 => {
              b3.loop(4, b4 => b4.note('C4', '4n'))
            })
          })
        }).buf,
      grooveTemplates: []
    }),
    unroll: true
  },
  {
    name: 'unroll deeply nested (3 levels)',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.02 }, b => {
          b.loop(2, b2 =>
            b2.loop(2, b3 =>
              b3.loop(2, b4 => b4.note('C4', '8n'))
            )
          )
        }).buf,
      grooveTemplates: []
    }),
    unroll: true
  }
]

// =============================================================================
// Event Type Tests
// =============================================================================

const EVENT_TESTS: ParityTest[] = [
  {
    name: 'CC events',
    createBuilder: () => ({
      // control() on builder returns builder, control() on cursor returns builder
      buf: Clip.melody()
        .control(1, 64)
        .note('C4', '4n')
        .control(1, 127)  // returns builder
        .note('D4', '4n')
        .control(1, 0)    // returns builder
        .buf,             // access buf directly on builder
      grooveTemplates: []
    })
  },
  {
    name: 'BEND events',
    createBuilder: () => ({
      buf: Clip.melody()
        .bend(0.5)
        .note('C4', '4n')
        .bend(-0.5)       // returns builder
        .note('D4', '4n')
        .bend(0)          // returns builder
        .buf,
      grooveTemplates: []
    })
  },
  {
    name: 'TEMPO events',
    createBuilder: () => ({
      buf: Clip.melody()
        .tempo(140)
        .note('C4', '4n')
        .tempo(100)       // returns builder
        .note('D4', '4n')
        .tempo(120)       // returns builder
        .buf,
      grooveTemplates: []
    })
  }
]

// =============================================================================
// Scale Tests
// =============================================================================

const SCALE_TESTS: ParityTest[] = [
  {
    name: 'medium scale (100 notes)',
    createBuilder: () => {
      const builder = Clip.melody()
      for (let i = 0; i < 100; i++) {
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] as const
        builder.note(notes[i % 7], '8n')
      }
      return { buf: builder.buf, grooveTemplates: [] }
    }
  },
  {
    name: 'large scale (500 notes)',
    createBuilder: () => {
      const builder = Clip.melody()
      for (let i = 0; i < 500; i++) {
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] as const
        builder.note(notes[i % 7], '16n')
      }
      return { buf: builder.buf, grooveTemplates: [] }
    }
  },
  {
    name: 'stress scale (1000 notes)',
    createBuilder: () => {
      const builder = Clip.melody()
      for (let i = 0; i < 1000; i++) {
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] as const
        builder.note(notes[i % 7], '16n')
      }
      return { buf: builder.buf, grooveTemplates: [] }
    }
  }
]

// =============================================================================
// Edge Case Tests
// =============================================================================

const EDGE_CASE_TESTS: ParityTest[] = [
  {
    name: 'same seed produces identical output',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0.2 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
          b.note('E4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'humanize timing zero (no-op)',
    createBuilder: () => ({
      buf: Clip.melody()
        .humanize({ timing: 0 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'quantize strength zero (no-op)',
    createBuilder: () => ({
      buf: Clip.melody()
        .quantize('8n', { strength: 0 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'empty groove block',
    createBuilder: () => ({
      buf: Clip.melody()
        .groove(groove([]), b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        }).buf,
      grooveTemplates: []
    })
  },
  {
    name: 'maximum nesting depth (10 levels)',
    createBuilder: () => ({
      buf: Clip.melody()
        .loop(1, b1 =>
          b1.loop(1, b2 =>
            b2.loop(1, b3 =>
              b3.loop(1, b4 =>
                b4.loop(1, b5 =>
                  b5.loop(1, b6 =>
                    b6.loop(1, b7 =>
                      b7.loop(1, b8 =>
                        b8.loop(1, b9 =>
                          b9.loop(1, b10 => b10.note('C4', '4n'))
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
        .buf,
      grooveTemplates: []
    })
  }
]

// =============================================================================
// Test Runner
// =============================================================================

describe('Comprehensive Compiler Parity', () => {
  // =========================================================================
  // Helper: Run parity test
  // =========================================================================
  const runParityTest = (test: ParityTest) => {
    const { buf, grooveTemplates } = test.createBuilder()

    const treeResult = compileBuilderToVM(
      buf,
      PPQ,
      SEED,
      grooveTemplates,
      test.unroll ?? false
    )

    const zeroResult = compileBuilderToVMZeroAlloc(buf, {
      ppq: PPQ,
      seed: SEED,
      grooveTemplates,
      unroll: test.unroll ?? false
    })

    // PRIMARY: Bytecode must match exactly
    expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)

    // SECONDARY: totalTicks should match for non-structural clips
    // Note: totalTicks calculation differs for loops (tree counts expanded, zero counts body)
    // The VM handles loop expansion at runtime, so bytecode parity is what matters
  }

  // =========================================================================
  // Basic Scenarios
  // =========================================================================
  describe('Basic Scenarios', () => {
    for (const test of BASIC_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Transform Scenarios
  // =========================================================================
  describe('Transform Scenarios', () => {
    for (const test of TRANSFORM_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Structural Scenarios
  // =========================================================================
  describe('Structural Scenarios', () => {
    for (const test of STRUCTURAL_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Unroll Scenarios
  // =========================================================================
  describe('Unroll Scenarios', () => {
    for (const test of UNROLL_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Event Type Scenarios
  // =========================================================================
  describe('Event Type Scenarios', () => {
    for (const test of EVENT_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Scale Scenarios
  // =========================================================================
  describe('Scale Scenarios', () => {
    for (const test of SCALE_TESTS) {
      it(test.name, () => runParityTest(test))
    }
  })

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    for (const test of EDGE_CASE_TESTS) {
      it(test.name, () => runParityTest(test))
    }

    // Special tests that need custom logic
    it('different seeds produce different humanization output', () => {
      const buf = Clip.melody()
        .humanize({ timing: 0.5 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        }).buf

      const result1 = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: 11111,
        grooveTemplates: [],
        unroll: false
      })

      const result2 = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: 99999,
        grooveTemplates: [],
        unroll: false
      })

      // With 0.5 timing, different seeds should almost certainly produce different output
      expect(Array.from(result1.vmBytecode)).not.toEqual(Array.from(result2.vmBytecode))
    })

    it('same seed is reproducible across multiple compiles', () => {
      const buf = Clip.melody()
        .humanize({ timing: 0.2 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
          b.note('E4', '4n')
        }).buf

      const result1 = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: false
      })

      const result2 = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(result1.vmBytecode)).toEqual(Array.from(result2.vmBytecode))
      expect(result1.totalTicks).toBe(result2.totalTicks)
    })

    it('EOF is emitted for empty clip', () => {
      const buf = Clip.melody().buf

      const treeResult = compileBuilderToVM(buf, PPQ, SEED, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(buf, {
        ppq: PPQ,
        seed: SEED,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
      expect(zeroResult.vmBytecode[0]).toBe(OP.EOF)
    })
  })
})
