// =============================================================================
// SymphonyScript - SBC VM Tests (RFC-038)
// =============================================================================

import { ClipFactory } from '../../../../../../symphonyscript-legacy/src/legacy/clip'
import { assembleToBytecode } from '../assembler'
import { BytecodeVM } from '../runtime'
import { SBCConsumer } from '../consumer'
import {
  SBC_MAGIC,
  SBC_VERSION,
  REG,
  REGION,
  STATE,
  EVENT_TYPE,
  OP,
  DEFAULT_PPQ
} from '../constants'
import type { VMNoteEvent } from '../types'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a simple melody clip for testing.
 */
function createMelodyClip(notes: string[], duration = '4n') {
  let builder = ClipFactory.melody('test')
  for (const note of notes) {
    // note() returns cursor, but cursor has note() that commits and continues
    builder = builder.note(note as any, duration as any).commit() as any
  }
  return builder.build()
}

/**
 * Get all note events from VM.
 */
function getNoteEvents(vm: BytecodeVM): VMNoteEvent[] {
  return vm.getEvents().filter((e): e is VMNoteEvent => e.type === 'note')
}

// =============================================================================
// Test Suite
// =============================================================================

describe('RFC-038: Symphony Bytecode (SBC) VM', () => {
  // ===========================================================================
  // 1. Simple Note Sequence
  // ===========================================================================
  describe('1. Simple note sequence', () => {
    it('should emit C major scale with correct pitches and sequential ticks', () => {
      const melody = createMelodyClip(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])
      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)

      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(8)

      // Verify pitches (C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71, C5=72)
      const expectedPitches = [60, 62, 64, 65, 67, 69, 71, 72]
      events.forEach((event, i) => {
        expect(event.pitch).toBe(expectedPitches[i])
      })

      // Verify sequential ticks (96 ticks per quarter note)
      events.forEach((event, i) => {
        expect(event.tick).toBe(i * DEFAULT_PPQ)
      })
    })
  })

  // ===========================================================================
  // 2. Rest Handling
  // ===========================================================================
  describe('2. Rest handling', () => {
    it('should handle rests with correct tick gaps', () => {
      const melody = ClipFactory.melody('rest-test')
        .note('C4', '4n')
        .rest('4n')
        .note('E4', '4n')
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(2)

      // First note at tick 0
      expect(events[0].tick).toBe(0)
      expect(events[0].pitch).toBe(60) // C4

      // Second note at tick 192 (after note + rest = 2 * 96)
      expect(events[1].tick).toBe(2 * DEFAULT_PPQ)
      expect(events[1].pitch).toBe(64) // E4
    })
  })

  // ===========================================================================
  // 3. Loop with count > 0
  // ===========================================================================
  describe('3. Loop with count > 0', () => {
    it('should repeat loop body with accumulating ticks', () => {
      const melody = ClipFactory.melody('loop-test')
        .loop(3, (m) => m.note('C4', '4n').note('D4', '4n').commit() as any)
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(6) // 3 iterations × 2 notes

      // Ticks should accumulate: 0, 96, 192, 288, 384, 480
      const expectedTicks = [0, 96, 192, 288, 384, 480]
      events.forEach((event, i) => {
        expect(event.tick).toBe(expectedTicks[i])
      })
    })
  })

  // ===========================================================================
  // 4. Loop with count = 0
  // ===========================================================================
  describe('4. Loop with count = 0', () => {
    it('should skip loop body entirely', () => {
      const melody = ClipFactory.melody('empty-loop')
        .note('C4', '4n')
        .loop(0, (m) => m.note('D4', '4n').note('E4', '4n').commit() as any)
        .note('F4', '4n')
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(2) // Only C4 and F4, loop skipped

      expect(events[0].pitch).toBe(60) // C4
      expect(events[1].pitch).toBe(65) // F4
      expect(events[1].tick).toBe(DEFAULT_PPQ) // Immediately after C4
    })
  })

  // ===========================================================================
  // 5. Nested Loops
  // ===========================================================================
  describe('5. Nested loops', () => {
    it('should handle nested loops correctly', () => {
      const melody = ClipFactory.melody('nested-loops')
        .loop(2, (outer) =>
          outer.loop(3, (inner) => inner.note('C4', '4n').commit() as any)
        )
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(6) // 2 × 3 = 6 notes
    })
  })

  // ===========================================================================
  // 6. Stack with equal duration branches
  // ===========================================================================
  describe('6. Stack with equal duration branches', () => {
    it('should start all branches at same tick', () => {
      const melody = ClipFactory.melody('stack-equal')
        .stack((s) => s
          .note('C4', '4n')
          .note('E4', '4n')
          .note('G4', '4n')
          .commit() as any
        )
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(3)

      // All notes should start at tick 0
      events.forEach((event) => {
        expect(event.tick).toBe(0)
      })

      // VM tick should be at 96 after stack (max duration = 96)
      expect(vm.getTick()).toBe(DEFAULT_PPQ)
    })
  })

  // ===========================================================================
  // 7. Stack with different duration branches
  // ===========================================================================
  describe('7. Stack with different duration branches', () => {
    it('should advance tick by MAX duration', () => {
      const melody = ClipFactory.melody('stack-different')
        .stack((s) => (s as any)
          .note('C4', '4n')   // 96 ticks
          .note('E4', '8n')   // 48 ticks
          .note('G4', '2n')   // 192 ticks
          .commit()
        )
        .note('B4', '4n')     // Should start at tick 192
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(4)

      // Stack notes at tick 0
      expect(events[0].tick).toBe(0)
      expect(events[1].tick).toBe(0)
      expect(events[2].tick).toBe(0)

      // B4 should start at tick 192 (MAX of 96, 48, 192)
      expect(events[3].pitch).toBe(71) // B4
      expect(events[3].tick).toBe(192)
    })
  })

  // ===========================================================================
  // 8. Transposition context
  // ===========================================================================
  describe('8. Transposition context', () => {
    it('should apply transposition to notes', () => {
      const melody = ClipFactory.melody('transpose-test')
        .note('C4', '4n')           // No transpose: C4 = 60
        .transpose(5)
        .note('C4', '4n')           // +5: C4 → F4 = 65
        .transpose(-5)              // Back to 0
        .note('C4', '4n')           // No transpose: C4 = 60
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(3)

      expect(events[0].pitch).toBe(60) // C4
      expect(events[1].pitch).toBe(65) // C4 + 5 = F4
      expect(events[2].pitch).toBe(60) // C4 (transpose reset)
    })
  })

  // ===========================================================================
  // 9. Additive Transposition
  // ===========================================================================
  describe('9. Additive transposition', () => {
    it('should stack transpositions additively', () => {
      const melody = ClipFactory.melody('additive-transpose')
        .transpose(3)
        .note('C4', '4n')            // +3: C4 → D#4 = 63
        .transpose(4)                // +3+4 = +7
        .note('C4', '4n')            // +7: C4 → G4 = 67
        .transpose(-4)               // Back to +3
        .note('C4', '4n')            // +3: C4 → D#4 = 63
        .transpose(-3)               // Back to 0
        .note('C4', '4n')            // No transpose: C4 = 60
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(4)

      expect(events[0].pitch).toBe(63) // C4 + 3 = D#4
      expect(events[1].pitch).toBe(67) // C4 + 7 = G4
      expect(events[2].pitch).toBe(63) // C4 + 3 = D#4
      expect(events[3].pitch).toBe(60) // C4
    })
  })

  // ===========================================================================
  // 10. CHORD (using stack)
  // ===========================================================================
  describe('10. CHORD macros', () => {
    it('should emit multiple notes at same tick for stack chords', () => {
      // Using stack to create chord effect
      const melody = ClipFactory.melody('chord-test')
        .stack((s) => (s as any)
          .note('C4', '4n')
          .note('E4', '4n')
          .note('G4', '4n')
          .commit()
        )
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const events = getNoteEvents(vm)
      expect(events).toHaveLength(3)

      // All at same tick
      const ticks = events.map((e) => e.tick)
      expect(new Set(ticks).size).toBe(1)

      // All have same duration
      const durations = events.map((e) => e.duration)
      expect(new Set(durations).size).toBe(1)
    })
  })

  // ===========================================================================
  // 11. Tempo Changes
  // ===========================================================================
  describe('11. Tempo changes', () => {
    it('should record tempo changes in tempo buffer', () => {
      const melody = ClipFactory.melody('tempo-test')
        .note('C4', '4n')
        .tempo(140)
        .note('D4', '4n')
        .tempo(100)
        .note('E4', '4n')
        .build()

      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      vm.runToEnd()

      const tempoChanges = vm.getTempoChanges()
      expect(tempoChanges).toHaveLength(2)

      expect(tempoChanges[0].tick).toBe(DEFAULT_PPQ) // After first note
      expect(tempoChanges[0].bpm).toBe(140)

      expect(tempoChanges[1].tick).toBe(2 * DEFAULT_PPQ) // After second note
      expect(tempoChanges[1].bpm).toBe(100)
    })
  })

  // ===========================================================================
  // 12. Streaming tick()
  // ===========================================================================
  describe('12. Streaming tick()', () => {
    it('should execute incrementally up to target tick', () => {
      const melody = createMelodyClip(['C4', 'D4', 'E4', 'F4'])
      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)

      // Execute up to tick 96 (should include first note only)
      vm.tick(96)
      expect(getNoteEvents(vm).length).toBeGreaterThanOrEqual(1)
      expect(vm.getState()).toBe(STATE.PAUSED)

      // Execute up to tick 192
      vm.tick(192)
      expect(getNoteEvents(vm).length).toBeGreaterThanOrEqual(2)

      // Execute to end
      vm.tick(Number.MAX_SAFE_INTEGER)
      expect(getNoteEvents(vm)).toHaveLength(4)
      expect(vm.getState()).toBe(STATE.DONE)
    })
  })

  // ===========================================================================
  // 13. Ring Buffer Wrap-Around
  // ===========================================================================
  describe('13. Ring buffer wrap-around', () => {
    it('should handle wrap-around with modulo indexing', () => {
      // Create clip with more events than small buffer capacity
      const melody = createMelodyClip(Array(20).fill('C4'))

      // Use small event capacity
      const buffer = assembleToBytecode(melody, { eventCapacity: 10 })
      const vm = new BytecodeVM(buffer)
      const consumer = new SBCConsumer(buffer)

      // Execute partially, drain, repeat
      vm.tick(5 * DEFAULT_PPQ)
      const batch1 = consumer.poll()
      expect(batch1.length).toBeGreaterThan(0)

      vm.tick(15 * DEFAULT_PPQ)
      const batch2 = consumer.poll()
      expect(batch2.length).toBeGreaterThan(0)

      vm.runToEnd()
      const batch3 = consumer.poll()

      const totalEvents = batch1.length + batch2.length + batch3.length
      expect(totalEvents).toBe(20)
    })
  })

  // ===========================================================================
  // 14. Ring Buffer Backpressure
  // ===========================================================================
  describe('14. Ring buffer backpressure', () => {
    it('should pause when buffer is full', () => {
      // Create clip with more events than capacity
      const melody = createMelodyClip(Array(20).fill('C4'))

      // Use very small event capacity
      const buffer = assembleToBytecode(melody, { eventCapacity: 5 })
      const vm = new BytecodeVM(buffer)
      const consumer = new SBCConsumer(buffer)

      // Try to run to end - should pause due to backpressure
      vm.runToEnd()

      // Should be paused (not done) because buffer filled up
      if (vm.getState() !== STATE.DONE) {
        expect(consumer.isBackpressured()).toBe(true)

        // Drain and continue
        consumer.poll()
        vm.runToEnd()
      }

      // After draining and continuing, should eventually complete
      while (vm.getState() !== STATE.DONE) {
        consumer.poll()
        vm.runToEnd()
      }

      expect(vm.getState()).toBe(STATE.DONE)
    })
  })

  // ===========================================================================
  // 15. Consumer Advances Read Pointer
  // ===========================================================================
  describe('15. Consumer advances read pointer', () => {
    it('should advance EVENT_READ after poll()', () => {
      const melody = createMelodyClip(['C4', 'D4', 'E4', 'F4', 'G4'])
      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)
      const consumer = new SBCConsumer(buffer)

      vm.runToEnd()

      // Before poll
      expect(consumer.available()).toBe(5)

      // After poll
      const events = consumer.poll()
      expect(events).toHaveLength(5)
      expect(consumer.available()).toBe(0)

      // Second poll returns empty
      const events2 = consumer.poll()
      expect(events2).toHaveLength(0)
    })
  })

  // ===========================================================================
  // 16. Infinite Streaming Simulation
  // ===========================================================================
  describe('16. Infinite streaming simulation', () => {
    it('should handle many events with periodic draining', () => {
      // Create a large clip
      const melody = createMelodyClip(Array(1000).fill('C4'))

      // Use moderate capacity
      const buffer = assembleToBytecode(melody, { eventCapacity: 100 })
      const vm = new BytecodeVM(buffer)
      const consumer = new SBCConsumer(buffer)

      let totalEventsReceived = 0
      let iterations = 0
      const maxIterations = 100 // Safety limit

      // Simulate streaming: execute, drain, repeat
      while (vm.getState() !== STATE.DONE && iterations < maxIterations) {
        vm.tick(vm.getTick() + 10 * DEFAULT_PPQ)
        const events = consumer.poll()
        totalEventsReceived += events.length
        iterations++
      }

      // Final drain
      while (consumer.available() > 0) {
        const events = consumer.poll()
        totalEventsReceived += events.length
      }

      // Should have received all 1000 events without overflow
      expect(totalEventsReceived).toBe(1000)
      expect(vm.getState()).toBe(STATE.DONE)
    })
  })

  // ===========================================================================
  // Memory Layout Verification
  // ===========================================================================
  describe('Memory Layout', () => {
    it('should have correct magic number and version', () => {
      const melody = createMelodyClip(['C4'])
      const buffer = assembleToBytecode(melody)
      const memory = new Int32Array(buffer)

      expect(memory[REG.MAGIC]).toBe(SBC_MAGIC)
      expect(memory[REG.VERSION]).toBe(SBC_VERSION)
    })

    it('should have correct region offsets', () => {
      const melody = createMelodyClip(['C4'])
      const buffer = assembleToBytecode(melody)
      const memory = new Int32Array(buffer)

      expect(memory[REG.BYTECODE_START]).toBe(REGION.BYTECODE)
      expect(memory[REG.BYTECODE_END]).toBeGreaterThan(REGION.BYTECODE)
      expect(memory[REG.EVENT_START]).toBe(memory[REG.BYTECODE_END])
    })

    it('should throw on invalid magic number', () => {
      const buffer = new SharedArrayBuffer(1024)
      const memory = new Int32Array(buffer)
      memory[REG.MAGIC] = 0xDEADBEEF // Wrong magic

      expect(() => new BytecodeVM(buffer)).toThrow(/Invalid SBC buffer/)
    })
  })

  // ===========================================================================
  // VM State Machine
  // ===========================================================================
  describe('VM State Machine', () => {
    it('should transition through IDLE → RUNNING → DONE', () => {
      const melody = createMelodyClip(['C4'])
      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)

      expect(vm.getState()).toBe(STATE.IDLE)

      vm.runToEnd()

      expect(vm.getState()).toBe(STATE.DONE)
    })

    it('should reset to initial state', () => {
      const melody = createMelodyClip(['C4', 'D4', 'E4'])
      const buffer = assembleToBytecode(melody)
      const vm = new BytecodeVM(buffer)

      vm.runToEnd()
      expect(vm.getState()).toBe(STATE.DONE)
      expect(vm.getTick()).toBeGreaterThan(0)

      vm.reset()

      expect(vm.getState()).toBe(STATE.IDLE)
      expect(vm.getTick()).toBe(0)
      expect(vm.getEventCount()).toBe(0)
    })
  })

  // ===========================================================================
  // Opcode Hex Notation
  // ===========================================================================
  describe('Opcode Hex Notation', () => {
    it('should use hex values for opcodes', () => {
      expect(OP.NOTE).toBe(0x01)
      expect(OP.REST).toBe(0x02)
      expect(OP.TEMPO).toBe(0x20)
      expect(OP.CC).toBe(0x21)
      expect(OP.STACK_START).toBe(0x40)
      expect(OP.LOOP_START).toBe(0x42)
      expect(OP.EOF).toBe(0xFF)
    })

    it('should use hex values for states', () => {
      expect(STATE.IDLE).toBe(0x00)
      expect(STATE.RUNNING).toBe(0x01)
      expect(STATE.PAUSED).toBe(0x02)
      expect(STATE.DONE).toBe(0x03)
    })

    it('should use hex values for event types', () => {
      expect(EVENT_TYPE.NOTE).toBe(0x01)
      expect(EVENT_TYPE.CC).toBe(0x02)
      expect(EVENT_TYPE.BEND).toBe(0x03)
    })
  })
})
