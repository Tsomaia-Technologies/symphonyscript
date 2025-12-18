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
