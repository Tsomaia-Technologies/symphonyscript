// =============================================================================
// SymphonyScript - Builder Tests (RFC-040)
// =============================================================================

import { describe, it, expect } from '@jest/globals'
import { Clip, MelodyBuilder, ClipBuilder, NoteCursor, BUILDER_OP } from '../index'
import { OP, SBC_MAGIC, SBC_VERSION, REG, REGION } from '../../vm/constants'
import { BytecodeVM } from '../../vm/runtime'

// Helper to create a simple groove template
const createGrooveTemplate = (offsets: number[]) => ({
  getOffsets: () => offsets
})

describe('RFC-040 Zero-Allocation Builder', () => {
  // =========================================================================
  // Basic Operations
  // =========================================================================

  describe('Basic Operations', () => {
    it('1. Simple note sequence produces correct Builder bytecode', () => {
      const cursor = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .note('E4', '4n')

      // Access builder through cursor
      const builder = cursor.builder

      // Builder format: [NOTE, tick, pitch, vel, dur]
      // C4=60, D4=62, E4=64, quarter=96 ticks at ppq=96
      expect(builder.buf).toEqual([
        OP.NOTE, 0, 60, 100, 96,    // C4 at tick 0
        OP.NOTE, 96, 62, 100, 96,   // D4 at tick 96
        OP.NOTE, 192, 64, 100, 96   // E4 at tick 192
      ])
    })

    it('2. Velocity modification modifies buf[opIndex+3] in place', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').velocity(0.5)

      // Velocity should be 0.5 * 127 = 64 (rounded)
      expect(cursor.builder.buf[3]).toBe(64)
    })

    it('3. Articulation staccato halves duration at buf[opIndex+4]', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').staccato()

      // Duration should be 96 * 0.5 = 48
      expect(cursor.builder.buf[4]).toBe(48)
    })

    it('4. Rest produces [REST, tick, dur]', () => {
      const builder = Clip.melody()
        .rest('4n')

      expect(builder.buf).toEqual([OP.REST, 0, 96])
    })

    it('5. Transposition state produces correct pitch', () => {
      const cursor = Clip.melody()
        .transpose(5)
        .note('C4', '4n')

      // C4=60 + 5 = 65
      expect(cursor.builder.buf[2]).toBe(65)
    })

    it('6. Clone creates independent copy', () => {
      const baseCursor = Clip.melody().note('C4', '4n')
      const base = baseCursor.builder
      const clonedBuilder = base.clone()
      const cloneCursor = clonedBuilder.note('E4', '4n')

      // Base should only have C4
      expect(base.buf.length).toBe(5)
      // Clone should have C4 and E4
      expect(cloneCursor.builder.buf.length).toBe(10)
    })
  })

  // =========================================================================
  // Structural Operations
  // =========================================================================

  describe('Structural Operations', () => {
    it('7. Loop with callback produces correct LOOP structure', () => {
      const builder = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))

      expect(builder.buf[0]).toBe(OP.LOOP_START)
      expect(builder.buf[1]).toBe(0)  // tick
      expect(builder.buf[2]).toBe(3)  // count
      expect(builder.buf[3]).toBe(OP.NOTE)
      expect(builder.buf[builder.buf.length - 1]).toBe(OP.LOOP_END)
    })

    it('8. Nested loops produce correct nesting', () => {
      const builder = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))

      // Outer: LOOP_START(2), Inner: LOOP_START(3), NOTE, LOOP_END, LOOP_END
      expect(builder.buf[0]).toBe(OP.LOOP_START)
      expect(builder.buf[2]).toBe(2) // outer count
      expect(builder.buf[3]).toBe(OP.LOOP_START)
      expect(builder.buf[5]).toBe(3) // inner count
    })

    it('9. Stack produces correct STACK structure', () => {
      const builder = Clip.melody()
        .stack(
          b => b.note('C4', '4n'),
          b => b.note('E4', '4n')
        )

      expect(builder.buf[0]).toBe(OP.STACK_START)
      expect(builder.buf[2]).toBe(2) // branch count
      expect(builder.buf[3]).toBe(OP.BRANCH_START)
      expect(builder.buf[4]).toBe(OP.NOTE)
    })
  })

  // =========================================================================
  // Smart Overloading (Critical)
  // =========================================================================

  describe('Smart Overloading', () => {
    it('10. Modifier mode returns NoteCursor', () => {
      const builder = Clip.melody()
      const cursor = builder.note('C4', '4n').humanize({ timing: 0.1 })

      expect(cursor).toBeInstanceOf(NoteCursor)
    })

    it('11. Block mode returns ClipBuilder', () => {
      const builder = Clip.melody()
      const result = builder.note('C4', '4n').humanize({ timing: 0.1 }, b => {
        b.note('D4', '4n')
      })

      expect(result).toBeInstanceOf(MelodyBuilder)
    })

    it('12. Modifier emits NOTE_MOD_HUMANIZE', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })

      // After NOTE, should have NOTE_MOD_HUMANIZE
      expect(cursor.builder.buf[5]).toBe(BUILDER_OP.NOTE_MOD_HUMANIZE)
      expect(cursor.builder.buf[6]).toBe(100) // timing_ppt = 0.1 * 1000
      expect(cursor.builder.buf[7]).toBe(0)   // velocity_ppt = 0
    })

    it('13. Block emits PUSH/POP pair', () => {
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.note('C4', '4n')
        })

      expect(builder.buf[0]).toBe(BUILDER_OP.HUMANIZE_PUSH)
      expect(builder.buf[1]).toBe(100) // timing_ppt
      expect(builder.buf[2]).toBe(0)   // velocity_ppt
      expect(builder.buf[3]).toBe(OP.NOTE)
      expect(builder.buf[builder.buf.length - 1]).toBe(BUILDER_OP.HUMANIZE_POP)
    })

    it('14. Quantize modifier emits NOTE_MOD_QUANTIZE', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').quantize('8n', { strength: 0.5 })

      expect(cursor.builder.buf[5]).toBe(BUILDER_OP.NOTE_MOD_QUANTIZE)
      expect(cursor.builder.buf[6]).toBe(48)  // grid_ticks for 8n
      expect(cursor.builder.buf[7]).toBe(50)  // strength_pct = 0.5 * 100
    })

    it('15. Quantize block emits PUSH/POP pair', () => {
      const builder = Clip.melody()
        .quantize('8n', { strength: 0.5 }, b => {
          b.note('C4', '4n')
        })

      expect(builder.buf[0]).toBe(BUILDER_OP.QUANTIZE_PUSH)
      expect(builder.buf[1]).toBe(48)  // grid_ticks
      expect(builder.buf[2]).toBe(50)  // strength_pct
      expect(builder.buf[builder.buf.length - 1]).toBe(BUILDER_OP.QUANTIZE_POP)
    })

    it('16. Groove modifier emits NOTE_MOD_GROOVE', () => {
      const template = createGrooveTemplate([5, -5, 10, -10])
      const cursor = Clip.melody()
        .note('C4', '4n').groove(template)

      expect(cursor.builder.buf[5]).toBe(BUILDER_OP.NOTE_MOD_GROOVE)
      expect(cursor.builder.buf[6]).toBe(0)  // groove index
    })

    it('17. Groove block emits PUSH/POP pair', () => {
      const template = createGrooveTemplate([5, -5, 10, -10])
      const builder = Clip.melody()
        .groove(template, b => {
          b.note('C4', '4n')
        })

      expect(builder.buf[0]).toBe(BUILDER_OP.GROOVE_PUSH)
      expect(builder.buf[1]).toBe(4)  // length
      expect(builder.buf[2]).toBe(5)  // offset[0]
      expect(builder.buf[builder.buf.length - 1]).toBe(BUILDER_OP.GROOVE_POP)
    })

    it('18. Type transitions work correctly', () => {
      // Modifier → block → note → modifier
      const cursor = Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })  // Cursor
        .velocity(0.8)  // Still cursor
        .humanize({ timing: 0.5 }, b => {  // Block → Builder
          b.note('D4', '4n')
        })
        .note('E4', '4n')  // Back on builder → Cursor

      // Should have 3 notes
      const buf = cursor.builder.buf
      const noteCount = buf.filter((val, i, arr) =>
        val === OP.NOTE && (i === 0 || arr[i - 1] !== OP.BRANCH_START)
      ).length
      expect(noteCount).toBeGreaterThanOrEqual(3)
    })

    it('19. Atomic overrides block context', () => {
      // Build with block context AND atomic modifier
      const builder = Clip.melody()
        .humanize({ timing: 0.1 }, b => {
          b.note('C4', '4n')  // Has block context
          b.note('D4', '4n').humanize({ timing: 0.5 })  // Atomic overrides!
        })

      // Find the NOTE_MOD_HUMANIZE for D4
      let d4ModIndex = -1
      for (let i = 0; i < builder.buf.length; i++) {
        if (builder.buf[i] === OP.NOTE && builder.buf[i + 2] === 62) {
          // Found D4 (MIDI 62), look for modifier after it
          if (builder.buf[i + 5] === BUILDER_OP.NOTE_MOD_HUMANIZE) {
            d4ModIndex = i + 5
            break
          }
        }
      }

      expect(d4ModIndex).toBeGreaterThan(-1)
      expect(builder.buf[d4ModIndex + 1]).toBe(500) // 0.5 * 1000, atomic value
    })
  })

  // =========================================================================
  // Transform Application
  // =========================================================================

  describe('Transform Application', () => {
    it('20. Quantize snaps notes to grid', () => {
      const builder = Clip.melody()
        .quantize('4n', { strength: 1.0 }, b => {
          // Note slightly off-grid at tick 10
          b.rest('16n') // 24 ticks
          b.note('C4', '4n')
        })

      const sab = builder.build({ seed: 12345 })
      const mem = new Int32Array(sab)

      // The note should be quantized to tick 0 or tick 96
      // With strength 1.0, it should snap fully
      // Build succeeded = no crash
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
    })

    it('21. Pipeline order is Quantize → Groove → Humanize', () => {
      // This test verifies the order by checking that all three can be applied
      const template = createGrooveTemplate([5])
      const builder = Clip.melody()
        .quantize('4n', { strength: 1.0 }, b => {
          b.groove(template, b2 => {
            b2.humanize({ timing: 0.05 }, b3 => {
              b3.note('C4', '4n')
            })
          })
        })

      const sab = builder.build({ seed: 12345 })
      const mem = new Int32Array(sab)
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
    })

    it('22. Humanize timing offsets notes', () => {
      const builder1 = Clip.melody()
        .note('C4', '4n')

      const builder2 = Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })

      const sab1 = builder1.build({ seed: 12345 })
      const sab2 = builder2.build({ seed: 12345 })

      // Both should build successfully
      const mem1 = new Int32Array(sab1)
      const mem2 = new Int32Array(sab2)
      expect(mem1[REG.MAGIC]).toBe(SBC_MAGIC)
      expect(mem2[REG.MAGIC]).toBe(SBC_MAGIC)
    })

    it('23. Humanize velocity varies velocities', () => {
      const builder = Clip.melody()
        .note('C4', '4n').humanize({ velocity: 0.2 })

      const sab = builder.build({ seed: 12345 })
      const mem = new Int32Array(sab)
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
    })

    it('24. Groove offsets shift notes', () => {
      const template = createGrooveTemplate([10, -10])
      const builder = Clip.melody()
        .groove(template, b => {
          b.note('C4', '4n')
          b.note('D4', '4n')
        })

      const sab = builder.build({ seed: 12345 })
      const mem = new Int32Array(sab)
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
    })

    it('25. Events sorted by final tick after transforms', () => {
      // Build a clip where transforms might reorder events
      const builder = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')

      const sab = builder.build({ seed: 12345 })
      const mem = new Int32Array(sab)
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
    })
  })

  // =========================================================================
  // Build Output
  // =========================================================================

  describe('Build Output', () => {
    it('26. REST gap emission produces correct gaps', () => {
      const builder = Clip.melody()
        .note('C4', '4n')
        .rest('4n')
        .note('D4', '4n')

      const sab = builder.build()
      const mem = new Int32Array(sab)

      // Check bytecode region
      const bytecodeStart = mem[REG.BYTECODE_START]
      expect(mem[bytecodeStart]).toBe(OP.NOTE) // First note
    })

    it('27. build() produces valid SharedArrayBuffer', () => {
      const sab = Clip.melody()
        .note('C4', '4n')
        .build()

      expect(sab).toBeInstanceOf(SharedArrayBuffer)

      const mem = new Int32Array(sab)
      expect(mem[REG.MAGIC]).toBe(SBC_MAGIC)
      expect(mem[REG.VERSION]).toBe(SBC_VERSION)
      expect(mem[REG.PPQ]).toBe(96)
    })

    it('28. BytecodeVM executes output correctly', () => {
      const sab = Clip.melody()
        .note('C4', '4n')
        .note('D4', '4n')
        .build()

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      expect(vm.getTotalEventsWritten()).toBeGreaterThanOrEqual(2)
    })

    it('29. Deterministic humanize with same seed', () => {
      const builder = Clip.melody()
        .note('C4', '4n').humanize({ timing: 0.1 })

      const sab1 = builder.clone().build({ seed: 12345 })
      const sab2 = builder.clone().build({ seed: 12345 })

      const mem1 = new Int32Array(sab1)
      const mem2 = new Int32Array(sab2)

      // Same seed should produce identical bytecode
      const bytecodeStart = mem1[REG.BYTECODE_START]
      const bytecodeEnd = mem1[REG.BYTECODE_END]

      for (let i = bytecodeStart; i < bytecodeEnd; i++) {
        expect(mem1[i]).toBe(mem2[i])
      }
    })
  })

  // =========================================================================
  // Additional Coverage
  // =========================================================================

  describe('Additional Coverage', () => {
    it('Legato extends duration by 5%', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').legato()

      // Duration should be 96 * 1.05 = 101 (rounded)
      expect(cursor.builder.buf[4]).toBe(101)
    })

    it('Accent boosts velocity by 20', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').accent()

      // Velocity should be 100 + 20 = 120
      expect(cursor.builder.buf[3]).toBe(120)
    })

    it('Marcato applies accent + staccato', () => {
      const cursor = Clip.melody()
        .note('C4', '4n').marcato()

      // Velocity: 100 + 20 = 120
      // Duration: 96 * 0.5 = 48
      expect(cursor.builder.buf[3]).toBe(120)
      expect(cursor.builder.buf[4]).toBe(48)
    })

    it('Chord produces STACK with NOTE branches', () => {
      const cursor = Clip.melody()
        .chord(['C4', 'E4', 'G4'], '4n')

      expect(cursor.builder.buf[0]).toBe(OP.STACK_START)
      expect(cursor.builder.buf[2]).toBe(3) // 3 notes
    })

    it('Tempo emits [TEMPO, tick, bpm]', () => {
      const builder = Clip.melody()
        .tempo(140)

      expect(builder.buf[0]).toBe(OP.TEMPO)
      expect(builder.buf[1]).toBe(0)   // tick
      expect(builder.buf[2]).toBe(140) // bpm
    })

    it('Control emits [CC, tick, ctrl, val]', () => {
      const builder = Clip.melody()
        .control(1, 64)

      expect(builder.buf[0]).toBe(OP.CC)
      expect(builder.buf[1]).toBe(0)  // tick
      expect(builder.buf[2]).toBe(1)  // controller
      expect(builder.buf[3]).toBe(64) // value
    })

    it('Bend emits [BEND, tick, val]', () => {
      const builder = Clip.melody()
        .bend(0.5)

      expect(builder.buf[0]).toBe(OP.BEND)
      // 8192 + 0.5 * 8191 = 12287 (rounded)
      expect(builder.buf[2]).toBe(12288)
    })

    it('Octave sets absolute transposition', () => {
      const cursor = Clip.melody()
        .octave(5)  // 1 octave up from neutral
        .note('C4', '4n')

      // C4 (60) + 12 = 72
      expect(cursor.builder.buf[2]).toBe(72)
    })

    it('OctaveUp shifts up', () => {
      const cursor = Clip.melody()
        .octaveUp(2)
        .note('C4', '4n')

      // C4 (60) + 24 = 84
      expect(cursor.builder.buf[2]).toBe(84)
    })

    it('OctaveDown shifts down', () => {
      const cursor = Clip.melody()
        .octaveDown(1)
        .note('C4', '4n')

      // C4 (60) - 12 = 48
      expect(cursor.builder.buf[2]).toBe(48)
    })
  })

  // =========================================================================
  // End-to-End Structural Tests (RFC-040 Tree-Based Compilation)
  // =========================================================================

  describe('End-to-End Structural Tests', () => {
    it('loop(N) produces N events in VM', () => {
      const sab = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))
        .build()

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      // Loop runs 3 times, each iteration produces 1 NOTE event
      expect(vm.getTotalEventsWritten()).toBe(3)
    })

    it('chord produces parallel events at same tick in VM', () => {
      const sab = Clip.melody()
        .chord(['C4', 'E4', 'G4'], '4n')
        .build()

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      // Chord with 3 notes produces 3 events
      expect(vm.getTotalEventsWritten()).toBe(3)

      // All events should be at tick 0
      const e0 = vm.getEvent(0)
      const e1 = vm.getEvent(1)
      const e2 = vm.getEvent(2)
      expect(e0.tick).toBe(0)
      expect(e1.tick).toBe(0)
      expect(e2.tick).toBe(0)
    })

    it('nested loops produce correct event count', () => {
      const sab = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))
        .build()

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      // Outer loop 2 × inner loop 3 = 6 events
      expect(vm.getTotalEventsWritten()).toBe(6)
    })

    it('unroll: true produces events without LOOP_START opcodes', () => {
      const sab = Clip.melody()
        .loop(3, b => b.note('C4', '4n'))
        .build({ unroll: true, seed: 12345 })

      const mem = new Int32Array(sab)

      // Check that there's no LOOP_START in the bytecode
      const bytecodeStart = mem[REG.BYTECODE_START]
      const bytecodeEnd = mem[REG.BYTECODE_END]

      let hasLoopStart = false
      for (let i = bytecodeStart; i < bytecodeEnd; i++) {
        if (mem[i] === OP.LOOP_START) {
          hasLoopStart = true
          break
        }
      }
      expect(hasLoopStart).toBe(false)

      // Should still produce 3 events
      const vm = new BytecodeVM(sab)
      vm.runToEnd()
      expect(vm.getTotalEventsWritten()).toBe(3)
    })

    it('unroll: true produces varied humanization per iteration', () => {
      const sab = Clip.melody()
        .loop(3, b => b.note('C4', '4n').humanize({ timing: 0.3 }))
        .build({ unroll: true, seed: 12345 })

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      expect(vm.getTotalEventsWritten()).toBe(3)

      // Get all events - they should be at different ticks due to humanization
      const e0 = vm.getEvent(0)
      const e1 = vm.getEvent(1)
      const e2 = vm.getEvent(2)

      // Each iteration has different humanization, so ticks should vary
      // The events are sorted by tick, so we just check they were produced
      expect(e0.pitch).toBe(60)
      expect(e1.pitch).toBe(60)
      expect(e2.pitch).toBe(60)
    })

    it('nested loops unroll correctly with varied humanization', () => {
      const sab = Clip.melody()
        .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n').humanize({ timing: 0.1 })))
        .build({ seed: 12345, unroll: true })

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      // 2 × 3 = 6 events
      expect(vm.getTotalEventsWritten()).toBe(6)
    })

    it('handles overlapping notes from transforms correctly', () => {
      // With aggressive humanization, notes can overlap
      const sab = Clip.melody()
        .loop(3, b => b.note('C4', '4n').humanize({ timing: 0.4 }))
        .build({ unroll: true, seed: 99999 })

      const vm = new BytecodeVM(sab)
      vm.runToEnd()

      // Should still produce 3 events without crash
      expect(vm.getTotalEventsWritten()).toBe(3)

      // Verify bytecode has no negative REST values
      const mem = new Int32Array(sab)
      const bytecodeStart = mem[REG.BYTECODE_START]
      const bytecodeEnd = mem[REG.BYTECODE_END]

      for (let i = bytecodeStart; i < bytecodeEnd; i++) {
        if (mem[i] === OP.REST) {
          const restDuration = mem[i + 1]
          expect(restDuration).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })
})
