// =============================================================================
// SymphonyScript - Silicon Linker Attribute Patching (RFC-043)
// =============================================================================
// Immediate attribute patching with SEQ counter updates for ABA protection.

import {
  NODE,
  NODE_SIZE_I32,
  PACKED,
  SEQ,
  FLAG,
  NULL_PTR,
  HEAP_START_OFFSET
} from './constants'
import type { NodePtr } from './types'
import { InvalidPointerError } from './types'

/**
 * Attribute patcher for immediate, sub-millisecond node updates.
 *
 * These operations:
 * - Do NOT require COMMIT_FLAG (consumer sees changes on next read)
 * - DO increment SEQ counter for ABA protection
 * - Are atomic at the individual field level
 *
 * Thread safety:
 * - Each patch is a single Atomics.store (atomic for aligned i32)
 * - SEQ increment ensures consumer detects the change
 */
export class AttributePatcher {
  private sab: Int32Array
  private heapStartI32: number
  private nodeCapacity: number

  constructor(sab: Int32Array, nodeCapacity: number) {
    this.sab = sab
    this.heapStartI32 = HEAP_START_OFFSET / 4
    this.nodeCapacity = nodeCapacity
  }

  /**
   * Convert a byte pointer to i32 index within the SAB.
   */
  private ptrToI32Index(ptr: NodePtr): number {
    return ptr / 4
  }

  /**
   * Get the i32 offset for a node given its byte pointer.
   */
  nodeOffset(ptr: NodePtr): number {
    return this.ptrToI32Index(ptr)
  }

  /**
   * Validate that a pointer is within the heap bounds and properly aligned.
   */
  private validatePtr(ptr: NodePtr): void {
    if (ptr === NULL_PTR) {
      throw new InvalidPointerError(ptr)
    }

    const i32Index = this.ptrToI32Index(ptr)
    const nodeIndex = (i32Index - this.heapStartI32) / NODE_SIZE_I32

    if (
      nodeIndex < 0 ||
      nodeIndex >= this.nodeCapacity ||
      (i32Index - this.heapStartI32) % NODE_SIZE_I32 !== 0
    ) {
      throw new InvalidPointerError(ptr)
    }
  }

  /**
   * Increment the SEQ counter for ABA protection.
   * Called before any attribute mutation.
   */
  private bumpSeq(offset: number): void {
    Atomics.add(this.sab, offset + NODE.SEQ_FLAGS, 1 << SEQ.SEQ_SHIFT)
  }

  /**
   * Patch the pitch attribute (bits 16-23 of PACKED_A).
   *
   * @param ptr - Node byte pointer
   * @param pitch - New pitch value (0-127)
   */
  patchPitch(ptr: NodePtr, pitch: number): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Clamp pitch to valid MIDI range
    pitch = Math.max(0, Math.min(127, pitch | 0))

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Read-modify-write PACKED_A
    const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
    const newPacked = (packed & ~PACKED.PITCH_MASK) | (pitch << PACKED.PITCH_SHIFT)
    Atomics.store(this.sab, offset + NODE.PACKED_A, newPacked)
  }

  /**
   * Patch the velocity attribute (bits 8-15 of PACKED_A).
   *
   * @param ptr - Node byte pointer
   * @param velocity - New velocity value (0-127)
   */
  patchVelocity(ptr: NodePtr, velocity: number): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Clamp velocity to valid MIDI range
    velocity = Math.max(0, Math.min(127, velocity | 0))

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Read-modify-write PACKED_A
    const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
    const newPacked =
      (packed & ~PACKED.VELOCITY_MASK) | (velocity << PACKED.VELOCITY_SHIFT)
    Atomics.store(this.sab, offset + NODE.PACKED_A, newPacked)
  }

  /**
   * Patch the duration attribute.
   *
   * @param ptr - Node byte pointer
   * @param duration - New duration in ticks
   */
  patchDuration(ptr: NodePtr, duration: number): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Ensure duration is non-negative integer
    duration = Math.max(0, duration | 0)

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Direct write to DURATION field
    Atomics.store(this.sab, offset + NODE.DURATION, duration)
  }

  /**
   * Patch the base tick attribute.
   *
   * @param ptr - Node byte pointer
   * @param baseTick - New base tick (grid-aligned timing)
   */
  patchBaseTick(ptr: NodePtr, baseTick: number): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Ensure baseTick is non-negative integer
    baseTick = Math.max(0, baseTick | 0)

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Direct write to BASE_TICK field
    Atomics.store(this.sab, offset + NODE.BASE_TICK, baseTick)
  }

  /**
   * Set or clear the MUTED flag.
   *
   * @param ptr - Node byte pointer
   * @param muted - Whether the node should be muted
   */
  patchMuted(ptr: NodePtr, muted: boolean): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Read-modify-write PACKED_A flags
    const packed = Atomics.load(this.sab, offset + NODE.PACKED_A)
    const newPacked = muted
      ? packed | FLAG.MUTED
      : packed & ~FLAG.MUTED
    Atomics.store(this.sab, offset + NODE.PACKED_A, newPacked)
  }

  /**
   * Patch the source ID (editor location hash).
   *
   * @param ptr - Node byte pointer
   * @param sourceId - New source ID
   */
  patchSourceId(ptr: NodePtr, sourceId: number): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Bump SEQ for ABA protection
    this.bumpSeq(offset)

    // Direct write to SOURCE_ID field
    Atomics.store(this.sab, offset + NODE.SOURCE_ID, sourceId | 0)
  }

  /**
   * Patch multiple attributes at once (batch update).
   * More efficient than individual patches when changing multiple fields.
   *
   * @param ptr - Node byte pointer
   * @param updates - Object with optional pitch, velocity, duration, baseTick, muted
   */
  patchMultiple(
    ptr: NodePtr,
    updates: {
      pitch?: number
      velocity?: number
      duration?: number
      baseTick?: number
      muted?: boolean
      sourceId?: number
    }
  ): void {
    this.validatePtr(ptr)
    const offset = this.nodeOffset(ptr)

    // Single SEQ bump for all updates
    this.bumpSeq(offset)

    // Update PACKED_A if any relevant fields changed
    if (
      updates.pitch !== undefined ||
      updates.velocity !== undefined ||
      updates.muted !== undefined
    ) {
      let packed = Atomics.load(this.sab, offset + NODE.PACKED_A)

      if (updates.pitch !== undefined) {
        const pitch = Math.max(0, Math.min(127, updates.pitch | 0))
        packed = (packed & ~PACKED.PITCH_MASK) | (pitch << PACKED.PITCH_SHIFT)
      }

      if (updates.velocity !== undefined) {
        const velocity = Math.max(0, Math.min(127, updates.velocity | 0))
        packed =
          (packed & ~PACKED.VELOCITY_MASK) | (velocity << PACKED.VELOCITY_SHIFT)
      }

      if (updates.muted !== undefined) {
        packed = updates.muted ? packed | FLAG.MUTED : packed & ~FLAG.MUTED
      }

      Atomics.store(this.sab, offset + NODE.PACKED_A, packed)
    }

    // Update individual fields
    if (updates.duration !== undefined) {
      Atomics.store(
        this.sab,
        offset + NODE.DURATION,
        Math.max(0, updates.duration | 0)
      )
    }

    if (updates.baseTick !== undefined) {
      Atomics.store(
        this.sab,
        offset + NODE.BASE_TICK,
        Math.max(0, updates.baseTick | 0)
      )
    }

    if (updates.sourceId !== undefined) {
      Atomics.store(this.sab, offset + NODE.SOURCE_ID, updates.sourceId | 0)
    }
  }

}
