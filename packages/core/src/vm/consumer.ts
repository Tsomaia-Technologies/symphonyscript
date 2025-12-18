// =============================================================================
// SymphonyScript - SBC Consumer (RFC-038)
// =============================================================================
// Audio thread consumer for reading events from the VM's ring buffer.

import type { VMEvent, VMNoteEvent, VMControlEvent, VMBendEvent } from './types'
import {
  REG,
  EVENT_TYPE,
  EVENT_SIZE,
  STATE
} from './constants'

/**
 * Consumer for reading events from the SBC VM's ring buffer.
 *
 * This class is designed for use in an AudioWorklet where it reads
 * events written by the main thread VM. It uses atomic operations
 * for safe cross-thread communication.
 *
 * Usage:
 * ```typescript
 * // In AudioWorklet
 * const consumer = new SBCConsumer(sharedBuffer)
 *
 * process(inputs, outputs, parameters) {
 *   const events = consumer.poll()
 *   for (const event of events) {
 *     // Schedule MIDI events...
 *   }
 * }
 * ```
 */
export class SBCConsumer {
  private memory: Int32Array

  /**
   * Create a new consumer for the given SharedArrayBuffer.
   *
   * @param buffer - SharedArrayBuffer containing SBC program
   */
  constructor(buffer: SharedArrayBuffer) {
    this.memory = new Int32Array(buffer)
  }

  /**
   * Poll for new events that have been written but not yet read.
   * Advances the read pointer after reading.
   *
   * @returns Array of new events (empty if none available)
   */
  poll(): VMEvent[] {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]
    const eventStart = this.memory[REG.EVENT_START]

    const events: VMEvent[] = []
    let currentRead = readCount

    while (currentRead < writeCount) {
      const readIndex = currentRead % capacity // RING BUFFER WRAP
      const offset = eventStart + readIndex * EVENT_SIZE

      const type = this.memory[offset + 0]
      const tick = this.memory[offset + 1]

      if (type === EVENT_TYPE.NOTE) {
        events.push({
          type: 'note',
          tick,
          pitch: this.memory[offset + 2],
          velocity: this.memory[offset + 3],
          duration: this.memory[offset + 4]
        } as VMNoteEvent)
      } else if (type === EVENT_TYPE.CC) {
        events.push({
          type: 'cc',
          tick,
          controller: this.memory[offset + 2],
          value: this.memory[offset + 3]
        } as VMControlEvent)
      } else if (type === EVENT_TYPE.BEND) {
        events.push({
          type: 'bend',
          tick,
          value: this.memory[offset + 2]
        } as VMBendEvent)
      }

      currentRead++
    }

    // Advance read pointer - frees buffer space for writer
    if (currentRead > readCount) {
      Atomics.store(this.memory, REG.EVENT_READ, currentRead)
    }

    return events
  }

  /**
   * Poll for events up to a specific tick.
   * Only reads events with tick <= targetTick.
   *
   * @param targetTick - Maximum tick to read up to
   * @returns Array of events up to targetTick
   */
  pollUntil(targetTick: number): VMEvent[] {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]
    const eventStart = this.memory[REG.EVENT_START]

    const events: VMEvent[] = []
    let currentRead = readCount

    while (currentRead < writeCount) {
      const readIndex = currentRead % capacity
      const offset = eventStart + readIndex * EVENT_SIZE

      const tick = this.memory[offset + 1]

      // Stop if we've reached events beyond targetTick
      if (tick > targetTick) {
        break
      }

      const type = this.memory[offset + 0]

      if (type === EVENT_TYPE.NOTE) {
        events.push({
          type: 'note',
          tick,
          pitch: this.memory[offset + 2],
          velocity: this.memory[offset + 3],
          duration: this.memory[offset + 4]
        } as VMNoteEvent)
      } else if (type === EVENT_TYPE.CC) {
        events.push({
          type: 'cc',
          tick,
          controller: this.memory[offset + 2],
          value: this.memory[offset + 3]
        } as VMControlEvent)
      } else if (type === EVENT_TYPE.BEND) {
        events.push({
          type: 'bend',
          tick,
          value: this.memory[offset + 2]
        } as VMBendEvent)
      }

      currentRead++
    }

    // Advance read pointer for events we consumed
    if (currentRead > readCount) {
      Atomics.store(this.memory, REG.EVENT_READ, currentRead)
    }

    return events
  }

  /**
   * Check how many events are available without reading them.
   *
   * @returns Number of unread events
   */
  available(): number {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    return writeCount - readCount
  }

  /**
   * Check if the VM is waiting due to backpressure.
   * This happens when the buffer is full and the VM can't write more events.
   *
   * @returns true if buffer is full
   */
  isBackpressured(): boolean {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]
    return (writeCount - readCount) >= capacity
  }

  /**
   * Check if the VM has finished execution.
   *
   * @returns true if VM state is DONE
   */
  isDone(): boolean {
    return Atomics.load(this.memory, REG.STATE) === STATE.DONE
  }

  /**
   * Check if the VM is currently paused.
   *
   * @returns true if VM state is PAUSED
   */
  isPaused(): boolean {
    return Atomics.load(this.memory, REG.STATE) === STATE.PAUSED
  }

  /**
   * Get the current VM state.
   *
   * @returns VM state code (IDLE=0, RUNNING=1, PAUSED=2, DONE=3)
   */
  getState(): number {
    return Atomics.load(this.memory, REG.STATE)
  }

  /**
   * Get the current tick from the VM.
   *
   * @returns Current VM tick
   */
  getTick(): number {
    return this.memory[REG.TICK]
  }

  /**
   * Get the total program length in ticks.
   *
   * @returns Total program length
   */
  getTotalLength(): number {
    return this.memory[REG.TOTAL_LENGTH]
  }

  /**
   * Get the PPQ (pulses per quarter note) setting.
   *
   * @returns PPQ value
   */
  getPPQ(): number {
    return this.memory[REG.PPQ]
  }

  /**
   * Get the initial BPM setting.
   *
   * @returns BPM value
   */
  getBPM(): number {
    return this.memory[REG.BPM]
  }

  /**
   * Peek at the next event without consuming it.
   *
   * @returns Next event or null if none available
   */
  peek(): VMEvent | null {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)

    if (readCount >= writeCount) {
      return null
    }

    const capacity = this.memory[REG.EVENT_CAPACITY]
    const eventStart = this.memory[REG.EVENT_START]
    const readIndex = readCount % capacity
    const offset = eventStart + readIndex * EVENT_SIZE

    const type = this.memory[offset + 0]
    const tick = this.memory[offset + 1]

    if (type === EVENT_TYPE.NOTE) {
      return {
        type: 'note',
        tick,
        pitch: this.memory[offset + 2],
        velocity: this.memory[offset + 3],
        duration: this.memory[offset + 4]
      } as VMNoteEvent
    } else if (type === EVENT_TYPE.CC) {
      return {
        type: 'cc',
        tick,
        controller: this.memory[offset + 2],
        value: this.memory[offset + 3]
      } as VMControlEvent
    } else {
      return {
        type: 'bend',
        tick,
        value: this.memory[offset + 2]
      } as VMBendEvent
    }
  }
}
