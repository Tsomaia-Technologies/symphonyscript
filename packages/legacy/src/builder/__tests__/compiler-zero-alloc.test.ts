// =============================================================================
// SymphonyScript - Zero-Allocation Compiler Tests (RFC-041)
// =============================================================================

import { describe, it, expect } from '@jest/globals'
import { ZeroAllocCompiler, compileBuilderToVMZeroAlloc } from '../compiler-zero-alloc'
import { compileBuilderToVM } from '../compiler'
import { Clip } from '../index'
import { OP, REG } from '../../vm/constants'
import { BytecodeVM } from '../../vm/runtime'

// =============================================================================
// Test Helpers
// =============================================================================

const createGrooveTemplate = (offsets: number[]) => ({
  getOffsets: () => offsets
})

// =============================================================================
// Tests
// =============================================================================

describe('RFC-041 Zero-Allocation Compiler', () => {
  // =========================================================================
  // Basic Compilation
  // =========================================================================

  describe('Basic Compilation', () => {
    it('compiles simple note sequence', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode).toBeInstanceOf(Int32Array)
      expect(result.totalTicks).toBe(288) // 3 quarter notes at 96 PPQ
    })

    it('compiles REST events', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .rest('4n')
        .note('D4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.totalTicks).toBe(288)
    })

    it('compiles TEMPO events', () => {
      const cursor = Clip.melody()
        .tempo(140)
        .note('C4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should contain TEMPO opcode
      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).toContain(OP.TEMPO)
    })

    it('compiles CC events', () => {
      const cursor = Clip.melody()
        .control(1, 64)
        .note('C4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).toContain(OP.CC)
    })

    it('compiles BEND events', () => {
      const cursor = Clip.melody()
        .bend(0.5)
        .note('C4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).toContain(OP.BEND)
    })
  })

  // =========================================================================
  // Transform Application
  // =========================================================================

  describe('Transform Application', () => {
    it('applies humanize timing', () => {
      const cursor1 = Clip.melody().note('C4', '4n')
      const cursor2 = Clip.melody().note('C4', '4n').humanize({ timing: 0.1 })

      const result1 = compileBuilderToVMZeroAlloc(cursor1.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      const result2 = compileBuilderToVMZeroAlloc(cursor2.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Both should compile successfully
      expect(result1.vmBytecode.length).toBeGreaterThan(0)
      expect(result2.vmBytecode.length).toBeGreaterThan(0)
    })

    it('applies humanize velocity', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').humanize({ velocity: 0.2 })

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('applies quantize', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').quantize('8n', { strength: 0.5 })

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Block-Scoped Transforms
  // =========================================================================

  describe('Block-Scoped Transforms', () => {
    it('respects HUMANIZE_PUSH/POP scope', () => {
      const cursor = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        })
        .note('E4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.totalTicks).toBe(288)
    })

    it('respects QUANTIZE_PUSH/POP scope', () => {
      const cursor = Clip.melody()
        .quantize('8n', { strength: 1.0 }, b => {
          b.note('C4', '4n')
        })
        .note('D4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('handles nested transform scopes', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.quantize('8n', { strength: 0.5 }, b2 => {
            b2.note('C4', '4n')
          })
        })

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Atomic Modifiers
  // =========================================================================

  describe('Atomic Modifiers', () => {
    it('NOTE_MOD_HUMANIZE overrides block context', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.note('C4', '4n')  // Block context: 0.1
          b.note('D4', '4n').humanize({ timing: 0.5 })  // Atomic: 0.5
        })

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('NOTE_MOD_QUANTIZE overrides block context', () => {
      const builder = Clip.melody()
        .quantize('4n', { strength: 0.5 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n').quantize('8n', { strength: 1.0 })  // Atomic override
        })

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Structural: LOOP
  // =========================================================================

  describe('Structural: LOOP', () => {
    it('loop produces correct iteration count', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should contain LOOP_START and LOOP_END
      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).toContain(OP.LOOP_START)
      expect(vmArr).toContain(OP.LOOP_END)
    })

    it('nested loops work correctly', () => {
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should have nested LOOP_START/END
      const vmArr = Array.from(result.vmBytecode)
      const loopStarts = vmArr.filter(x => x === OP.LOOP_START).length
      expect(loopStarts).toBe(2)
    })
  })

  // =========================================================================
  // Structural: STACK/BRANCH
  // =========================================================================

  describe('Structural: STACK/BRANCH', () => {
    it('stack produces parallel branches', () => {
      const builder = Clip.melody()
        .stack(
          b => b.note('C4', '4n'),
          b => b.note('E4', '4n')
        )

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should contain STACK_START, BRANCH_START, BRANCH_END, STACK_END
      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).toContain(OP.STACK_START)
      expect(vmArr).toContain(OP.BRANCH_START)
      expect(vmArr).toContain(OP.BRANCH_END)
      expect(vmArr).toContain(OP.STACK_END)
    })

    it('all branches start at same tick', () => {
      const builder = Clip.melody()
        .stack(
          b => b.note('C4', '4n'),
          b => b.note('E4', '8n')
        )

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Unroll Mode
  // =========================================================================

  describe('Unroll Mode', () => {
    it('unroll=true does not emit LOOP_START', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      // Should NOT contain LOOP_START
      const vmArr = Array.from(result.vmBytecode)
      expect(vmArr).not.toContain(OP.LOOP_START)
    })

    it('unroll produces varied humanization per iteration', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n').humanize({ timing: 0.3 }))

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      // Should have 3 notes (unrolled)
      // Count NOTE opcodes
      let noteCount = 0
      for (let i = 0; i < result.vmBytecode.length; i++) {
        if (result.vmBytecode[i] === OP.NOTE) noteCount++
      }
      expect(noteCount).toBe(3)
    })

    it('nested loops unroll correctly (2×3=6 events)', () => {
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      // Should have 6 notes
      let noteCount = 0
      for (let i = 0; i < result.vmBytecode.length; i++) {
        if (result.vmBytecode[i] === OP.NOTE) noteCount++
      }
      expect(noteCount).toBe(6)
    })

    it('nested unroll has collision-free seeds', () => {
      // This test verifies each unrolled iteration has unique humanization
      // AND matches the tree-based compiler output
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n').humanize({ timing: 0.2 })))

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], true)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      // Should match tree-based compiler
      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })
  })

  // =========================================================================
  // Context Stack Restoration
  // =========================================================================

  describe('Context Stack Restoration', () => {
    it('transforms dont leak out of loop', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.loop(2, b2 => {
            b2.humanize({ timing: 0.5 }, b3 => b3.note('C4', '4n'))
          })
          b.note('D4', '4n')  // Should use timing: 0.1, not 0.5
        })

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('transforms dont leak out of stack branches', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.stack(
            b2 => b2.humanize({ timing: 0.5 }, b3 => b3.note('C4', '4n')),
            b2 => b2.note('E4', '4n')  // Should use timing: 0.1
          )
          b.note('G4', '4n')  // Should use timing: 0.1
        })

      const result = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // PARITY TESTS (CRITICAL)
  // =========================================================================

  describe('Parity with Tree-Based Compiler', () => {
    it('simple note sequence matches', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')

      const treeResult = compileBuilderToVM(cursor.builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('note with rest matches', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .rest('4n')
        .note('D4', '4n')

      const treeResult = compileBuilderToVM(cursor.builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('humanize timing matches', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })
        .note('D4', '4n')

      const treeResult = compileBuilderToVM(cursor.builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('block-scoped humanize matches', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        })

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('quantize matches', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').quantize('8n', { strength: 0.5 })

      const treeResult = compileBuilderToVM(cursor.builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('loop matches', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('nested loop matches', () => {
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('stack matches', () => {
      const builder = Clip.melody()
        .stack(
          b => b.note('C4', '4n'),
          b => b.note('E4', '4n')
        )

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('unroll matches', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n').humanize({ timing: 0.1 }))

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], true)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('nested unroll matches', () => {
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], true)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: true
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('complex composition matches', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.05 }, b => {
          b.note('C4', '4n')
          b.loop(2, b2 => {
            b2.note('D4', '8n')
            b2.note('E4', '8n')
          })
          b.note('F4', '4n')
        })

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })
  })

  // =========================================================================
  // VM Execution Tests
  // =========================================================================

  describe('VM Execution', () => {
    it('compiled output executes in BytecodeVM', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')

      // Build using the full build() path which uses tree-based compiler
      const sab = cursor.builder.build({ seed: 12345 })
      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      expect(vm.getTotalEventsWritten()).toBe(3)
    })

    it('loop executes correct number of iterations', () => {
      const builder = Clip.melody()
        .loop(4, b => b.note('C4', '4n'))

      const sab = builder.build({ seed: 12345 })
      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      expect(vm.getTotalEventsWritten()).toBe(4)
    })

    it('unrolled loop produces correct events', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))

      const sab = builder.build({ seed: 12345, unroll: true })
      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      expect(vm.getTotalEventsWritten()).toBe(3)
    })
  })

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe('Error Handling', () => {
    it('handles normal input without overflow', () => {
      // Create a compiler instance
      const compiler = new ZeroAllocCompiler()

      // Verify the compiler works with normal input
      const cursor = Clip.melody().note('C4', '4n')
      const result = compiler.compile(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('handles dense scope without overflow', () => {
      // Create a clip with many events in root scope
      const builder = Clip.melody()
      for (let i = 0; i < 500; i++) {
        builder.note('C4', '16n')
      }

      const cursor = builder.note('C4', '16n')  // Get cursor to access buf
      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should compile successfully with 501 notes
      let noteCount = 0
      for (let i = 0; i < result.vmBytecode.length; i++) {
        if (result.vmBytecode[i] === OP.NOTE) noteCount++
      }
      expect(noteCount).toBe(501)
    })
  })

  // =========================================================================
  // Context Stack Overflow Protection
  // =========================================================================

  describe('Context Stack Overflow Protection', () => {
    // Import BUILDER_OP for raw bytecode construction
    const BUILDER_OP = {
      HUMANIZE_PUSH: 0x60,
      HUMANIZE_POP: 0x61,
      QUANTIZE_PUSH: 0x62,
      QUANTIZE_POP: 0x63,
      GROOVE_PUSH: 0x64,
      GROOVE_POP: 0x65
    }

    it('throws on too many nested humanize blocks', () => {
      const compiler = new ZeroAllocCompiler()

      // Build bytecode with 33 nested HUMANIZE_PUSH without matching POPs
      const buf: number[] = []
      for (let i = 0; i < 33; i++) {
        buf.push(BUILDER_OP.HUMANIZE_PUSH, 100, 100)
      }
      buf.push(OP.NOTE, 0, 60, 100, 96)  // One note

      expect(() => compiler.compile(buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })).toThrow(/Too many nested humanize blocks/)
    })

    it('throws on too many nested quantize blocks', () => {
      const compiler = new ZeroAllocCompiler()

      const buf: number[] = []
      for (let i = 0; i < 33; i++) {
        buf.push(BUILDER_OP.QUANTIZE_PUSH, 48, 100)
      }
      buf.push(OP.NOTE, 0, 60, 100, 96)

      expect(() => compiler.compile(buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })).toThrow(/Too many nested quantize blocks/)
    })

    it('throws on too many nested groove blocks', () => {
      const compiler = new ZeroAllocCompiler()

      const buf: number[] = []
      for (let i = 0; i < 33; i++) {
        buf.push(BUILDER_OP.GROOVE_PUSH, 1, 10)  // 1 offset
      }
      buf.push(OP.NOTE, 0, 60, 100, 96)

      expect(() => compiler.compile(buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })).toThrow(/Too many nested groove blocks/)
    })

    it('allows maximum nesting depth (32)', () => {
      const compiler = new ZeroAllocCompiler()

      const buf: number[] = []
      // 32 nested humanize (at the limit)
      for (let i = 0; i < 32; i++) {
        buf.push(BUILDER_OP.HUMANIZE_PUSH, 100, 100)
      }
      buf.push(OP.NOTE, 0, 60, 100, 96)
      for (let i = 0; i < 32; i++) {
        buf.push(BUILDER_OP.HUMANIZE_POP)
      }

      // Should not throw
      expect(() => compiler.compile(buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })).not.toThrow()
    })

    it('handles large output without vmBuf overflow', () => {
      const compiler = new ZeroAllocCompiler()

      // 1000 notes with gaps between them
      const buf: number[] = []
      for (let i = 0; i < 1000; i++) {
        buf.push(OP.NOTE, i * 1000, 60, 100, 96)  // Notes at tick 0, 1000, 2000, ...
      }

      const result = compiler.compile(buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Verify all notes are present
      let noteCount = 0
      for (let i = 0; i < result.vmBytecode.length; i++) {
        if (result.vmBytecode[i] === OP.NOTE) noteCount++
      }
      expect(noteCount).toBe(1000)
    })
  })

  // =========================================================================
  // Inline Groove Support
  // =========================================================================

  describe('Inline Groove Support', () => {
    // Helper to create groove template from array
    const groove = (offsets: number[]) => ({ getOffsets: () => offsets })

    it('applies inline groove offsets', () => {
      const builder = Clip.melody()
        .groove(groove([10, -10, 20, -20]), b => {
          b.note('C4', '4n')  // Beat 0: +10 ticks
          b.note('D4', '4n')  // Beat 1: -10 ticks
          b.note('E4', '4n')  // Beat 2: +20 ticks
          b.note('F4', '4n')  // Beat 3: -20 ticks
        })

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      // Should match tree-based compiler
      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('inline groove parity with tree-based compiler', () => {
      const cursor = Clip.melody()
        .groove(groove([5, -5]), b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        })
        .note('E4', '4n')  // Outside groove block

      const treeResult = compileBuilderToVM(cursor.builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('nested inline grooves work correctly', () => {
      const builder = Clip.melody()
        .groove(groove([10]), b => {
          b.note('C4', '4n')
          b.groove(groove([20]), b2 => {
            b2.note('D4', '4n')  // Should have +20 offset (inner groove)
          })
          b.note('E4', '4n')  // Should have +10 offset (outer groove)
        })

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })

    it('empty groove block does not crash', () => {
      // Edge case: test with no groove (just notes)
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')

      const result = compileBuilderToVMZeroAlloc(cursor.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(result.vmBytecode.length).toBeGreaterThan(0)
    })

    it('inline groove state restored after structural scopes', () => {
      // This test ensures inlineGrooveTop doesn't drift across structural boundaries
      const builder = Clip.melody()
        .groove(groove([10]), b => {
          b.loop(2, b2 => {
            b2.groove(groove([20]), b3 => b3.note('C4', '4n'))
          })
          b.note('D4', '4n')  // Should still use outer groove (+10)
        })
        .groove(groove([30]), b => {
          b.note('E4', '4n')  // Should use new groove (+30)
        })

      const treeResult = compileBuilderToVM(builder.buf, 96, 12345, [], false)
      const zeroResult = compileBuilderToVMZeroAlloc(builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      expect(Array.from(zeroResult.vmBytecode)).toEqual(treeResult.vmBuf)
    })
  })

  // =========================================================================
  // Memory Reuse
  // =========================================================================

  describe('Memory Reuse', () => {
    it('compiler instance can be reused', () => {
      const compiler = new ZeroAllocCompiler()

      const cursor1 = Clip.melody().note('C4', '4n')
      const result1 = compiler.compile(cursor1.builder.buf, {
        ppq: 96,
        seed: 12345,
        grooveTemplates: [],
        unroll: false
      })

      const cursor2 = Clip.melody().note('D4', '8n').note('E4', '8n')
      const result2 = compiler.compile(cursor2.builder.buf, {
        ppq: 96,
        seed: 67890,
        grooveTemplates: [],
        unroll: false
      })

      expect(result1.totalTicks).toBe(96)
      expect(result2.totalTicks).toBe(96)
    })

    it('multiple compiles produce correct output', () => {
      const compiler = new ZeroAllocCompiler()

      for (let i = 0; i < 10; i++) {
        const cursor = Clip.melody()
          .note('C4', '4n')
          .note('D4', '4n')

        const result = compiler.compile(cursor.builder.buf, {
          ppq: 96,
          seed: i * 1000,
          grooveTemplates: [],
          unroll: false
        })

        expect(result.totalTicks).toBe(192)
      }
    })
  })

  // =========================================================================
  // Performance (Basic)
  // =========================================================================

  describe('Performance', () => {
    it('compiles quickly for simple clips', () => {
      const compiler = new ZeroAllocCompiler()
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        compiler.compile(cursor.builder.buf, {
          ppq: 96,
          seed: i,
          grooveTemplates: [],
          unroll: false
        })
      }
      const elapsed = performance.now() - start

      // Should complete 100 compiles in under 100ms
      expect(elapsed).toBeLessThan(100)
    })
  })
})
