// =============================================================================
// SymphonyScript - Ring Buffer Controller (RFC-044)
// =============================================================================
// Lock-free circular buffer for Command Ring communication.

import {
  HDR,
  COMMAND,
  DEFAULT_RING_CAPACITY,
  getRingBufferOffset
} from './constants'
import { CommandQueueOverflowError } from './types'

/**
 * Ring Buffer Controller for Command Ring (RFC-044).
 *
 * This class manages the atomic Head/Tail pointers and data region of the
 * Command Ring Buffer, enabling lock-free communication between Main Thread
 * (producer) and Worker Thread (consumer).
 *
 * **Protocol:**
 * - **Main Thread (Producer):** Calls `write()` to enqueue commands
 * - **Worker Thread (Consumer):** Calls `read()` to dequeue commands
 *
 * **Memory Layout:**
 * - `HDR.RB_HEAD`: Read index (Worker)
 * - `HDR.RB_TAIL`: Write index (Main Thread)
 * - `HDR.RB_CAPACITY`: Buffer capacity in commands
 * - `HDR.COMMAND_RING_PTR`: Byte offset to data region
 * - Data Region: capacity × 4 × i32 (16 bytes per command)
 *
 * **Command Format:**
 * - [0] OPCODE: Command type (INSERT, DELETE, PATCH, CLEAR)
 * - [1] PARAM_1: First parameter (e.g., node pointer)
 * - [2] PARAM_2: Second parameter (e.g., prev pointer)
 * - [3] RESERVED: Reserved for future use
 *
 * @remarks
 * This is a single-producer, single-consumer (SPSC) lock-free queue.
 * Full condition: (tail + 1) % capacity === head
 * Empty condition: head === tail
 */
export class RingBuffer {
  private readonly sab: Int32Array
  private readonly dataStartI32: number // i32 index where ring data begins
  private readonly capacity: number

  /**
   * Create a Ring Buffer Controller.
   *
   * @param sab - SharedArrayBuffer as Int32Array view
   *
   * @remarks
   * RFC-044 Hygiene: The ring buffer header fields are initialized by init.ts.
   * This constructor merely loads the pre-formatted values from the SAB.
   * This ensures the Worker can safely access the ring buffer even if the Main Thread
   * hasn't instantiated RingBuffer yet.
   */
  constructor(sab: Int32Array) {
    this.sab = sab

    // Load capacity from header (set by init.ts)
    this.capacity = Atomics.load(this.sab, HDR.RB_CAPACITY)

    // Load data region offset from header (set by init.ts)
    const dataStartBytes = Atomics.load(this.sab, HDR.COMMAND_RING_PTR)
    this.dataStartI32 = dataStartBytes / 4

    // Validate that header was properly initialized
    if (this.capacity === 0 || dataStartBytes === 0) {
      throw new Error(
        'RingBuffer: SAB not properly initialized. ' +
          'Ensure createLinkerSAB() was called before instantiating RingBuffer.'
      )
    }
  }

  /**
   * Write a command to the ring buffer (Main Thread / Producer).
   *
   * @param opcode - Command opcode (INSERT, DELETE, PATCH, CLEAR)
   * @param param1 - First parameter (e.g., node pointer)
   * @param param2 - Second parameter (e.g., prev pointer)
   * @throws {CommandQueueOverflowError} if buffer is full
   *
   * @remarks
   * This method uses atomic operations to ensure thread-safe communication.
   * The Worker must process commands fast enough to prevent overflow.
   */
  write(opcode: number, param1: number, param2: number): void {
    const head = Atomics.load(this.sab, HDR.RB_HEAD)
    const tail = Atomics.load(this.sab, HDR.RB_TAIL)

    // Check if buffer is full: (tail + 1) % capacity === head
    const nextTail = (tail + 1) % this.capacity
    if (nextTail === head) {
      throw new CommandQueueOverflowError(head, tail, this.capacity)
    }

    // Calculate write position in data region
    const writeIndex = this.dataStartI32 + tail * COMMAND.STRIDE_I32

    // Write command (4 words, 16 bytes)
    this.sab[writeIndex + 0] = opcode
    this.sab[writeIndex + 1] = param1
    this.sab[writeIndex + 2] = param2
    this.sab[writeIndex + 3] = 0 // RESERVED

    // Advance tail atomically (release semantics)
    Atomics.store(this.sab, HDR.RB_TAIL, nextTail)
  }

  /**
   * Read a command from the ring buffer (Worker Thread / Consumer).
   *
   * @param outCommand - Int32Array[4] to receive the command data
   * @returns true if command was read, false if buffer is empty
   *
   * @remarks
   * This method uses atomic operations to ensure thread-safe communication.
   * The output array must be pre-allocated to avoid allocations in the hot path.
   */
  read(outCommand: Int32Array): boolean {
    const head = Atomics.load(this.sab, HDR.RB_HEAD)
    const tail = Atomics.load(this.sab, HDR.RB_TAIL)

    // Check if buffer is empty: head === tail
    if (head === tail) {
      return false
    }

    // Calculate read position in data region
    const readIndex = this.dataStartI32 + head * COMMAND.STRIDE_I32

    // Read command (4 words, 16 bytes)
    outCommand[0] = this.sab[readIndex + 0] // OPCODE
    outCommand[1] = this.sab[readIndex + 1] // PARAM_1
    outCommand[2] = this.sab[readIndex + 2] // PARAM_2
    outCommand[3] = this.sab[readIndex + 3] // RESERVED

    // Advance head atomically (acquire semantics)
    const nextHead = (head + 1) % this.capacity
    Atomics.store(this.sab, HDR.RB_HEAD, nextHead)

    return true
  }

  /**
   * Check if the ring buffer is empty.
   *
   * @returns true if no commands are pending
   */
  isEmpty(): boolean {
    const head = Atomics.load(this.sab, HDR.RB_HEAD)
    const tail = Atomics.load(this.sab, HDR.RB_TAIL)
    return head === tail
  }

  /**
   * Check if the ring buffer is full.
   *
   * @returns true if buffer cannot accept more commands
   */
  isFull(): boolean {
    const head = Atomics.load(this.sab, HDR.RB_HEAD)
    const tail = Atomics.load(this.sab, HDR.RB_TAIL)
    const nextTail = (tail + 1) % this.capacity
    return nextTail === head
  }

  /**
   * Get the number of pending commands in the buffer.
   *
   * @returns Number of commands waiting to be processed
   */
  getPendingCount(): number {
    const head = Atomics.load(this.sab, HDR.RB_HEAD)
    const tail = Atomics.load(this.sab, HDR.RB_TAIL)

    if (tail >= head) {
      return tail - head
    } else {
      return this.capacity - head + tail
    }
  }

  /**
   * Get the capacity of the ring buffer.
   *
   * @returns Maximum number of commands that can be queued
   */
  getCapacity(): number {
    return this.capacity
  }
}
