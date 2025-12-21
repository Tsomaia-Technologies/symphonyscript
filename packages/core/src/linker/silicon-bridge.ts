// =============================================================================
// SymphonyScript - Silicon Bridge (RFC-043 Phase 4 + RFC-045-04 Zero-Alloc)
// =============================================================================
// Editor integration layer that wires ClipBuilder to Silicon Linker.
// Provides SOURCE_ID ↔ NodePtr bidirectional mapping.
//
// RFC-045-04 COMPLIANCE: ABSOLUTE ZERO ALLOCATIONS
// - No Maps, Sets, Arrays (use pre-allocated TypedArrays)
// - No throw/try/catch (use error codes)
// - No setTimeout/setInterval (use tick-based debounce)
// - No for...of/for...in (use index-based while loops)
// - No inline arrow functions as arguments

import { SiliconSynapse } from './silicon-synapse'
import {
  OPCODE,
  NULL_PTR,
  HDR,
  CMD,
  FLAG,
  NODE,
  PACKED,
  SYNAPSE,
  SYN_PACK,
  SYNAPSE_TABLE,
  BRIDGE_ERR,
  getSynapseTableOffset
} from './constants'
import type { NodePtr, SynapsePtr, BrainSnapshot } from './types'
import { LocalAllocator } from './local-allocator'
import { RingBuffer } from './ring-buffer'
import { SynapseAllocator } from './synapse-allocator'

// =============================================================================
// Types (interfaces are allocation-free - they describe shapes, not create objects)
// =============================================================================

/**
 * Source location information for editor integration.
 */
export interface SourceLocation {
  /** File path or identifier */
  file?: string
  /** Line number (1-based) */
  line: number
  /** Column number (1-based) */
  column: number
}

/**
 * Note data from the editor/ClipBuilder.
 */
export interface EditorNoteData {
  pitch: number
  velocity: number
  duration: number
  baseTick: number
  muted?: boolean
  source?: SourceLocation
}

/**
 * Patch operation type codes (zero-allocation enum replacement).
 */
export const PATCH_TYPE = {
  PITCH: 0,
  VELOCITY: 1,
  DURATION: 2,
  BASE_TICK: 3,
  MUTED: 4
} as const

export type PatchType = 'pitch' | 'velocity' | 'duration' | 'baseTick' | 'muted'

// Re-export snapshot types for convenience (RFC-045)
export type { BrainSnapshot, SynapseData } from './types'

/**
 * Bridge configuration options.
 */
export interface SiliconBridgeOptions {
  /** Debounce delay for attribute patches in ticks (default: 10) */
  attributeDebounceTicks?: number
  /** Debounce delay for structural edits in ticks (default: 10) */
  structuralDebounceTicks?: number
  /** Callback when a patch is applied */
  onPatchApplied?: (sourceId: number, type: PatchType, value: number | boolean) => void
  /** Callback when a structural edit is applied */
  onStructuralApplied?: (type: 'insert' | 'delete', sourceId: number) => void
  /** Callback when an error occurs (receives error code) */
  onError?: (errorCode: number) => void
  /** Learning rate for plasticity weight hardening (default: 10 = +1% per reward) */
  learningRate?: number
}

/**
 * Options for creating a synaptic connection.
 */
export interface SynapseOptions {
  /** Probability/Intensity (0-1000, where 1000 = 100%) */
  weight?: number
  /** Micro-timing deviation in ticks (0-65535) */
  jitter?: number
}

// =============================================================================
// SiliconBridge - Zero-Allocation Implementation
// =============================================================================

/**
 * Silicon Bridge - Editor integration layer for RFC-043.
 *
 * RFC-045-04 COMPLIANT: Absolute zero allocations in hot paths.
 * - All state uses pre-allocated TypedArrays
 * - Error handling via return codes (no throw/try/catch)
 * - Debouncing via tick counter (no setTimeout)
 * - All loops use index-based iteration (no for...of)
 */
export class SiliconBridge {
  private linker: SiliconSynapse

  // RFC-044: Zero-Blocking Command Ring Infrastructure
  private localAllocator: LocalAllocator
  private ringBuffer: RingBuffer
  private sab: Int32Array

  // RFC-045: Synapse Graph (Neural Audio Processor)
  private synapseAllocator: SynapseAllocator
  private synapseTableOffsetI32: number

  /** Learning rate for plasticity (default: 10 = +1% per reward) */
  private learningRate: number

  // =========================================================================
  // Pre-Allocated Ring Buffers (RFC-045-04)
  // =========================================================================

  // Fired synapse ring buffer
  private static readonly FIRED_RING_CAPACITY = 16
  private static readonly FIRED_RING_MASK = 15
  private readonly firedRing: Int32Array
  private firedRingHead: number = 0

  // Pending patches ring buffer (SoA pattern)
  private static readonly PATCH_RING_CAPACITY = 64
  private static readonly PATCH_RING_MASK = 63
  private readonly patchSourceIds: Int32Array
  private readonly patchTypes: Int8Array
  private readonly patchValues: Int32Array
  private patchHead: number = 0
  private patchTail: number = 0

  // Pending structural ring buffer (SoA pattern)
  private static readonly STRUCT_RING_CAPACITY = 32
  private static readonly STRUCT_RING_MASK = 31
  private readonly structTypes: Int8Array // 0=none, 1=insert, 2=delete
  private readonly structSourceIds: Int32Array
  private readonly structAfterIds: Int32Array
  private readonly structPitches: Int32Array
  private readonly structVelocities: Int32Array
  private readonly structDurations: Int32Array
  private readonly structBaseTicks: Int32Array
  private readonly structFlags: Int8Array
  private structHead: number = 0
  private structTail: number = 0

  // Tick-based debouncing (no setTimeout)
  private currentTick: number = 0
  private patchDebounceTick: number = 0
  private structDebounceTick: number = 0
  private attributeDebounceTicks: number
  private structuralDebounceTicks: number

  // Configuration callbacks
  private onPatchApplied: ((sourceId: number, type: PatchType, value: number | boolean) => void) | null = null
  private onStructuralApplied: ((type: 'insert' | 'delete', sourceId: number) => void) | null = null
  private onError: ((errorCode: number) => void) | null = null

  // Source ID generation
  private nextSourceId: number = 1

  // =========================================================================
  // Pre-Bound Callback Handlers (allocated once at construction)
  // =========================================================================

  // Traverse callback state
  private traverseNotesCallback:
    | ((
        sourceId: number,
        pitch: number,
        velocity: number,
        duration: number,
        baseTick: number,
        muted: boolean
      ) => void)
    | null = null

  // ReadNote callback state
  private readNoteCallback:
    | ((pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void)
    | null = null

  // GetSourceId temporary state
  private _getSourceIdResult: number = 0
  private _getSourceIdIsActive: boolean = false

  // GetSourceLocation callback state
  private getSourceLocationCallback: ((line: number, column: number) => void) | null = null

  // TraverseSourceIds callback state
  private traverseSourceIdsCallback: ((sourceId: number) => void) | null = null

  // Snapshot streaming callback state
  private snapshotOnSynapse: ((sourceId: number, targetId: number, weight: number, jitter: number) => void) | null =
    null
  private snapshotOnComplete: ((count: number) => void) | null = null

  constructor(linker: SiliconSynapse, options: SiliconBridgeOptions = {}) {
    this.linker = linker
    this.attributeDebounceTicks = options.attributeDebounceTicks ?? 10
    this.structuralDebounceTicks = options.structuralDebounceTicks ?? 10
    this.onPatchApplied = options.onPatchApplied ?? null
    this.onStructuralApplied = options.onStructuralApplied ?? null
    this.onError = options.onError ?? null

    // RFC-044: Initialize Zero-Blocking Command Ring infrastructure
    const sab = linker.getSAB()
    this.sab = new Int32Array(sab)
    const nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    this.localAllocator = new LocalAllocator(this.sab, nodeCapacity)
    this.ringBuffer = new RingBuffer(this.sab)

    // RFC-045: Initialize Synapse Graph infrastructure
    this.synapseAllocator = new SynapseAllocator(sab)
    this.learningRate = options.learningRate ?? 10
    this.synapseTableOffsetI32 = getSynapseTableOffset(nodeCapacity) / 4

    // Pre-allocate ring buffers (init-time allocation is acceptable)
    this.firedRing = new Int32Array(SiliconBridge.FIRED_RING_CAPACITY)

    this.patchSourceIds = new Int32Array(SiliconBridge.PATCH_RING_CAPACITY)
    this.patchTypes = new Int8Array(SiliconBridge.PATCH_RING_CAPACITY)
    this.patchValues = new Int32Array(SiliconBridge.PATCH_RING_CAPACITY)

    this.structTypes = new Int8Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structSourceIds = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structAfterIds = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structPitches = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structVelocities = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structDurations = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structBaseTicks = new Int32Array(SiliconBridge.STRUCT_RING_CAPACITY)
    this.structFlags = new Int8Array(SiliconBridge.STRUCT_RING_CAPACITY)

    // Initialize fired ring to NULL_PTR
    let i = 0
    while (i < SiliconBridge.FIRED_RING_CAPACITY) {
      this.firedRing[i] = NULL_PTR
      i = i + 1
    }
  }

  // ===========================================================================
  // Source ID Generation
  // ===========================================================================

  /**
   * Generate a SOURCE_ID from a source location.
   * Uses a hash of file:line:column for uniqueness.
   *
   * CRITICAL: SourceIds must fit in positive Int32 range (1 to 2^31-1)
   */
  generateSourceId(source?: SourceLocation): number {
    if (!source) {
      const id = this.nextSourceId
      this.nextSourceId = this.nextSourceId + 1
      return id
    }

    // Simple hash: combine file hash + line + column
    const fileHash = source.file ? this.hashString(source.file) : 0
    const locationHash = (fileHash * 31 + source.line) * 31 + source.column

    // Ensure positive Int32 range: 1 to 0x7FFFFFFF
    const maskedHash = (Math.abs(locationHash) >>> 0) & 0x7fffffff
    if (maskedHash === 0) {
      const id = this.nextSourceId
      this.nextSourceId = this.nextSourceId + 1
      return id
    }
    return maskedHash
  }

  /**
   * Simple string hash function.
   */
  private hashString(str: string): number {
    let hash = 0
    let i = 0
    while (i < str.length) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
      i = i + 1
    }
    return hash
  }

  // ===========================================================================
  // Bidirectional Mapping (via Identity Table in SAB)
  // ===========================================================================

  /**
   * Get NodePtr for a SOURCE_ID.
   * Uses Identity Table in SAB for O(1) lookup.
   */
  getNodePtr(sourceId: number): NodePtr | undefined {
    const ptr = this.linker.idTableLookup(sourceId)
    return ptr === NULL_PTR ? undefined : ptr
  }

  /**
   * Get SOURCE_ID for a NodePtr.
   * Returns undefined if node is not active or not found.
   *
   * **Zero-Alloc Implementation**: Uses hoisted handler.
   */
  getSourceId(ptr: NodePtr): number | undefined {
    if (ptr === NULL_PTR) return undefined

    this._getSourceIdResult = 0
    this._getSourceIdIsActive = false

    this.linker.readNode(ptr, this.handleGetSourceIdNode)

    return this._getSourceIdIsActive ? this._getSourceIdResult : undefined
  }

  /**
   * Get source location for a SOURCE_ID with zero-allocation callback pattern.
   *
   * @param sourceId - Source ID to lookup
   * @param cb - Callback receiving (line, column) primitives
   * @returns true if found and callback invoked, false if not found
   */
  getSourceLocation(sourceId: number, cb: (line: number, column: number) => void): boolean {
    const prevCb = this.getSourceLocationCallback
    this.getSourceLocationCallback = cb

    const result = this.linker.symTableLookup(sourceId, this.handleGetSourceLocationLookup)

    this.getSourceLocationCallback = prevCb
    return result
  }

  /**
   * Register a mapping between SOURCE_ID and NodePtr.
   */
  private registerMapping(sourceId: number, ptr: NodePtr, source?: SourceLocation): void {
    if (source) {
      const fileHash = source.file ? this.hashString(source.file) : 0
      this.linker.symTableStore(sourceId, fileHash, source.line, source.column)
    }
    this.linker.idTableInsert(sourceId, ptr)
  }

  /**
   * Unregister a mapping.
   */
  private unregisterMapping(sourceId: number): void {
    this.linker.idTableRemove(sourceId)
    this.linker.symTableRemove(sourceId)
  }

  /**
   * Traverse all registered SOURCE_IDs with zero-allocation callback pattern.
   *
   * @param cb - Callback invoked with each sourceId
   */
  traverseSourceIds(cb: (sourceId: number) => void): void {
    const prevCb = this.traverseSourceIdsCallback
    this.traverseSourceIdsCallback = cb

    this.linker.traverse(this.handleTraverseSourceIdsNode)

    this.traverseSourceIdsCallback = prevCb
  }

  /**
   * Get mapping count.
   */
  getMappingCount(): number {
    return this.linker.getNodeCount()
  }

  // ===========================================================================
  // Immediate Operations (No Debounce)
  // ===========================================================================

  /**
   * @internal Test-only synchronous insert.
   *
   * DO NOT USE IN PRODUCTION. This method processes commands synchronously
   * which blocks the main thread. For production, use insertAsync() and
   * allow the Worker to process commands asynchronously.
   *
   * RFC-045-FINAL: Routes through command ring + processCommands for immediate effect.
   *
   * @returns The SOURCE_ID assigned to the new node, or BRIDGE_ERR.NOT_FOUND if afterSourceId not found
   */
  _insertImmediateInternal(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    muted: boolean = false,
    source?: SourceLocation,
    afterSourceId?: number,
    explicitSourceId?: number
  ): number {
    const sourceId = explicitSourceId ?? this.generateSourceId(source)

    // Use async path to allocate and queue command
    const ptr = this.insertAsync(opcode, pitch, velocity, duration, baseTick, muted, sourceId, afterSourceId)

    if (ptr < 0) {
      return ptr // Error code
    }

    // Process commands immediately to make it synchronous
    this.linker.processCommands()

    // Register mapping (ptr is now linked in chain)
    this.registerMapping(sourceId, ptr, source)
    return sourceId
  }

  /**
   * Insert a node asynchronously using RFC-044 Command Ring (zero-blocking).
   *
   * @returns The NODE pointer (byte offset) in Zone B, or negative error code
   */
  insertAsync(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    muted: boolean,
    sourceId: number,
    afterSourceId?: number
  ): number {
    // Validate afterSourceId BEFORE allocating (Zone B can't free individual nodes)
    let prevPtr = NULL_PTR
    if (afterSourceId !== undefined) {
      const afterPtr = this.getNodePtr(afterSourceId)
      if (afterPtr !== undefined) {
        prevPtr = afterPtr
      } else {
        // Invalid afterSourceId - return error without allocating
        return BRIDGE_ERR.NOT_FOUND
      }
    }

    // Allocate from Zone B
    const ptr = this.localAllocator.alloc()
    if (ptr < 0) {
      return ptr // Error code from allocator
    }

    const offset = (ptr / 4) | 0
    const flags = (muted ? FLAG.MUTED : 0) | FLAG.ACTIVE

    const packedA =
      (opcode << PACKED.OPCODE_SHIFT) | (pitch << PACKED.PITCH_SHIFT) | (velocity << PACKED.VELOCITY_SHIFT) | flags

    Atomics.store(this.sab, offset + NODE.PACKED_A, packedA)
    Atomics.store(this.sab, offset + NODE.BASE_TICK, baseTick)
    Atomics.store(this.sab, offset + NODE.DURATION, duration)
    Atomics.store(this.sab, offset + NODE.NEXT_PTR, NULL_PTR)
    Atomics.store(this.sab, offset + NODE.PREV_PTR, NULL_PTR)
    Atomics.store(this.sab, offset + NODE.SOURCE_ID, sourceId)
    Atomics.store(this.sab, offset + NODE.SEQ_FLAGS, 0)
    Atomics.store(this.sab, offset + NODE.LAST_PASS_ID, 0)

    this.ringBuffer.write(CMD.INSERT, ptr, prevPtr)
    Atomics.notify(this.sab, HDR.YIELD_SLOT, 1)

    return ptr
  }

  /**
   * Insert a note immediately (bypasses debounce).
   * Convenience wrapper for _insertImmediateInternal with OPCODE.NOTE.
   *
   * @deprecated Use insertAsync() for production code. This method is
   * retained only for test compatibility where synchronous semantics
   * are required for deterministic assertions.
   *
   * @internal
   */
  insertNoteImmediate(note: EditorNoteData, afterSourceId?: number): number {
    return this._insertImmediateInternal(
      OPCODE.NOTE,
      note.pitch,
      note.velocity,
      note.duration,
      note.baseTick,
      note.muted ?? false,
      note.source,
      afterSourceId,
      undefined
    )
  }

  /**
   * Delete a note immediately (synchronous via command ring).
   *
   * RFC-045-FINAL: Routes through command ring + processCommands for immediate effect.
   * RFC-045 Disconnect Protocol: Automatically disconnects all incoming
   * and outgoing synapses before deleting the node.
   *
   * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
   */
  deleteNoteImmediate(sourceId: number): number {
    const ptr = this.getNodePtr(sourceId)
    if (ptr === undefined) {
      return BRIDGE_ERR.NOT_FOUND
    }

    // RFC-045: Auto-disconnect synapses via table scan
    this.disconnectAllFromSource(ptr)
    this.disconnectAllToTarget(ptr)

    // Queue delete command
    this.ringBuffer.write(CMD.DELETE, ptr, 0)

    // Process commands immediately to make it synchronous
    this.linker.processCommands()

    // Unregister mapping
    this.unregisterMapping(sourceId)
    return BRIDGE_ERR.OK
  }

  /**
   * Patch an attribute immediately (bypasses debounce).
   *
   * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
   */
  patchImmediate(sourceId: number, type: PatchType, value: number | boolean): number {
    const ptr = this.getNodePtr(sourceId)
    if (ptr === undefined) {
      return BRIDGE_ERR.NOT_FOUND
    }

    if (type === 'pitch') {
      this.linker.patchPitch(ptr, value as number)
    } else if (type === 'velocity') {
      this.linker.patchVelocity(ptr, value as number)
    } else if (type === 'duration') {
      this.linker.patchDuration(ptr, value as number)
    } else if (type === 'baseTick') {
      this.linker.patchBaseTick(ptr, value as number)
    } else if (type === 'muted') {
      this.linker.patchMuted(ptr, value as boolean)
    }

    if (this.onPatchApplied !== null) {
      this.onPatchApplied(sourceId, type, value)
    }
    return BRIDGE_ERR.OK
  }

  // ===========================================================================
  // Tick-Based Debouncing (No setTimeout)
  // ===========================================================================

  /**
   * Advance the internal tick counter and flush any due debounced operations.
   * Call this from an external frame loop (e.g., requestAnimationFrame wrapper).
   */
  tick(): void {
    this.currentTick = this.currentTick + 1

    if (this.patchTail !== this.patchHead && this.currentTick >= this.patchDebounceTick) {
      this.flushPatches()
    }

    if (this.structTail !== this.structHead && this.currentTick >= this.structDebounceTick) {
      this.flushStructural()
    }
  }

  /**
   * Queue an attribute patch with debouncing.
   * RFC-045-06: Implements coalescing - updates existing pending patch if found.
   */
  patchDebounced(sourceId: number, type: PatchType, value: number | boolean): void {
    const patchType =
      type === 'pitch'
        ? PATCH_TYPE.PITCH
        : type === 'velocity'
          ? PATCH_TYPE.VELOCITY
          : type === 'duration'
            ? PATCH_TYPE.DURATION
            : type === 'baseTick'
              ? PATCH_TYPE.BASE_TICK
              : PATCH_TYPE.MUTED
    const patchValue = typeof value === 'boolean' ? (value ? 1 : 0) : (value as number)

    // RFC-045-06: Coalesce - scan pending patches for matching sourceId+type
    let i = this.patchHead
    while (i < this.patchTail) {
      const idx = i & SiliconBridge.PATCH_RING_MASK
      if (this.patchSourceIds[idx] === sourceId && this.patchTypes[idx] === patchType) {
        // Found match - update in place
        this.patchValues[idx] = patchValue
        this.patchDebounceTick = this.currentTick + this.attributeDebounceTicks
        return
      }
      i = i + 1
    }

    // No match - append new patch
    const idx = this.patchTail & SiliconBridge.PATCH_RING_MASK
    this.patchSourceIds[idx] = sourceId
    this.patchTypes[idx] = patchType
    this.patchValues[idx] = patchValue

    this.patchTail = this.patchTail + 1
    this.patchDebounceTick = this.currentTick + this.attributeDebounceTicks
  }

  /**
   * Queue a structural insert with debouncing.
   *
   * @returns The pre-assigned sourceId for tracking
   */
  insertNoteDebounced(
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    muted: boolean,
    afterSourceId?: number
  ): number {
    const sourceId = this.generateSourceId()
    const idx = this.structTail & SiliconBridge.STRUCT_RING_MASK

    this.structTypes[idx] = 1 // insert
    this.structSourceIds[idx] = sourceId
    this.structAfterIds[idx] = afterSourceId ?? -1
    this.structPitches[idx] = pitch
    this.structVelocities[idx] = velocity
    this.structDurations[idx] = duration
    this.structBaseTicks[idx] = baseTick
    this.structFlags[idx] = muted ? 1 : 0

    this.structTail = this.structTail + 1
    this.structDebounceTick = this.currentTick + this.structuralDebounceTicks

    return sourceId
  }

  /**
   * Queue a structural delete with debouncing.
   */
  deleteNoteDebounced(sourceId: number): void {
    const idx = this.structTail & SiliconBridge.STRUCT_RING_MASK

    this.structTypes[idx] = 2 // delete
    this.structSourceIds[idx] = sourceId
    this.structAfterIds[idx] = -1
    this.structPitches[idx] = 0
    this.structVelocities[idx] = 0
    this.structDurations[idx] = 0
    this.structBaseTicks[idx] = 0
    this.structFlags[idx] = 0

    this.structTail = this.structTail + 1
    this.structDebounceTick = this.currentTick + this.structuralDebounceTicks
  }

  /**
   * Flush all pending attribute patches.
   */
  flushPatches(): void {
    while (this.patchHead !== this.patchTail) {
      const idx = this.patchHead & SiliconBridge.PATCH_RING_MASK

      const sourceId = this.patchSourceIds[idx]
      const patchType = this.patchTypes[idx]
      const value = this.patchValues[idx]

      const type: PatchType =
        patchType === PATCH_TYPE.PITCH
          ? 'pitch'
          : patchType === PATCH_TYPE.VELOCITY
            ? 'velocity'
            : patchType === PATCH_TYPE.DURATION
              ? 'duration'
              : patchType === PATCH_TYPE.BASE_TICK
                ? 'baseTick'
                : 'muted'

      const actualValue = type === 'muted' ? value !== 0 : value
      const result = this.patchImmediate(sourceId, type, actualValue)

      if (result < 0 && this.onError !== null) {
        this.onError(result)
      }

      this.patchHead = this.patchHead + 1
    }
  }

  /**
   * Flush all pending structural edits.
   */
  flushStructural(): void {
    while (this.structHead !== this.structTail) {
      const idx = this.structHead & SiliconBridge.STRUCT_RING_MASK

      const opType = this.structTypes[idx]
      const sourceId = this.structSourceIds[idx]

      if (opType === 1) {
        // insert - RFC-045-FINAL: Use async command ring instead of immediate
        const afterId = this.structAfterIds[idx]
        const pitch = this.structPitches[idx]
        const velocity = this.structVelocities[idx]
        const duration = this.structDurations[idx]
        const baseTick = this.structBaseTicks[idx]
        const muted = this.structFlags[idx] !== 0

        const result = this.insertAsync(
          OPCODE.NOTE,
          pitch,
          velocity,
          duration,
          baseTick,
          muted,
          sourceId,
          afterId >= 0 ? afterId : undefined
        )

        // Register mapping immediately (ptr is in Zone B, will be linked by worker)
        if (result >= 0) {
          this.registerMapping(sourceId, result, undefined)
          if (this.onStructuralApplied !== null) {
            this.onStructuralApplied('insert', sourceId)
          }
        } else if (this.onError !== null) {
          this.onError(result)
        }
      } else if (opType === 2) {
        // delete - RFC-045-FINAL: Use async command ring
        const ptr = this.getNodePtr(sourceId)
        if (ptr !== undefined) {
          // RFC-045: Auto-disconnect synapses before delete
          this.disconnectAllFromSource(ptr)
          this.disconnectAllToTarget(ptr)

          // Queue delete command
          this.ringBuffer.write(CMD.DELETE, ptr, 0)
          Atomics.notify(this.sab, HDR.YIELD_SLOT, 1)

          // Unregister immediately (worker will process delete)
          this.unregisterMapping(sourceId)

          if (this.onStructuralApplied !== null) {
            this.onStructuralApplied('delete', sourceId)
          }
        } else if (this.onError !== null) {
          this.onError(BRIDGE_ERR.NOT_FOUND)
        }
      }

      this.structHead = this.structHead + 1
    }
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Load notes from parallel TypedArrays. COLD PATH.
   *
   * RFC-045-FINAL: Uses command ring + processCommands for synchronous loading.
   *
   * @param pitches - Pitch values
   * @param velocities - Velocity values
   * @param durations - Duration values
   * @param baseTicks - BaseTick values
   * @param flags - Flag values (muted etc)
   * @param count - Number of notes
   * @param outSourceIds - Pre-allocated output array for assigned sourceIds
   * @returns Number of notes loaded
   */
  loadNotesFromArrays(
    pitches: Int32Array,
    velocities: Int32Array,
    durations: Int32Array,
    baseTicks: Int32Array,
    flags: Int8Array,
    count: number,
    outSourceIds: Int32Array
  ): number {
    let loaded = 0
    let i = count - 1 // Insert in reverse for sorted chain

    while (i >= 0) {
      const sourceId = this.nextSourceId
      this.nextSourceId = this.nextSourceId + 1

      const muted = (flags[i] & 0x02) !== 0

      // Use insertAsync to allocate and queue
      const ptr = this.insertAsync(
        OPCODE.NOTE,
        pitches[i],
        velocities[i],
        durations[i],
        baseTicks[i],
        muted,
        sourceId,
        undefined // always head insert
      )

      if (ptr >= 0) {
        outSourceIds[count - 1 - i] = sourceId
        loaded = loaded + 1
      }
      i = i - 1
    }

    // Process all commands at once
    this.linker.processCommands()

    return loaded
  }

  /**
   * Load notes from EditorNoteData array. COLD PATH - TEST COMPATIBILITY.
   *
   * RFC-045-FINAL: Uses command ring + processCommands for synchronous loading.
   * This method allocates and is NOT zero-allocation compliant.
   * Use loadNotesFromArrays for hot paths.
   *
   * @param notes - Array of EditorNoteData objects
   * @returns Array of assigned sourceIds
   */
  loadClip(notes: EditorNoteData[]): number[] {
    const sourceIds: number[] = []

    // Insert in reverse order to maintain sorted chain
    let i = notes.length - 1
    while (i >= 0) {
      const note = notes[i]
      const sourceId = this.generateSourceId(note.source)

      // Use insertAsync to allocate and queue
      const ptr = this.insertAsync(
        OPCODE.NOTE,
        note.pitch,
        note.velocity,
        note.duration,
        note.baseTick,
        note.muted ?? false,
        sourceId,
        undefined // always head insert for sorted loading
      )

      if (ptr >= 0) {
        sourceIds[i] = sourceId
      }
      i = i - 1
    }

    // Process all commands at once
    this.linker.processCommands()

    // Register all mappings after processing
    let j = 0
    while (j < notes.length) {
      const note = notes[j]
      const ptr = this.linker.idTableLookup(sourceIds[j])
      if (ptr !== NULL_PTR) {
        this.registerMapping(sourceIds[j], ptr, note.source)
      }
      j = j + 1
    }

    return sourceIds
  }

  /**
   * Clear all notes and mappings.
   *
   * RFC-045-FINAL: Routes through command ring + processCommands for synchronous clear.
   */
  clear(): void {
    // Queue CLEAR command
    this.ringBuffer.write(CMD.CLEAR, 0, 0)

    // Process command immediately
    this.linker.processCommands()

    // Clear bridge state
    // (linker.executeClear already cleared idTable and symTable)

    // Reset fired ring
    this.firedRingHead = 0
    let i = 0
    while (i < SiliconBridge.FIRED_RING_CAPACITY) {
      this.firedRing[i] = NULL_PTR
      i = i + 1
    }

    // Reset patch ring
    this.patchHead = 0
    this.patchTail = 0

    // Reset struct ring
    this.structHead = 0
    this.structTail = 0
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Hoisted readNode callback handler (zero-allocation).
   */
  private handleReadNoteNode = (
    _ptr: number,
    _opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    _nextPtr: number,
    _sourceId: number,
    flags: number,
    _seq: number
  ): void => {
    if (this.readNoteCallback !== null) {
      this.readNoteCallback(pitch, velocity, duration, baseTick, (flags & 0x02) !== 0)
    }
  }

  /**
   * Read note data by SOURCE_ID with zero-allocation callback pattern.
   *
   * @param sourceId - Source ID to read
   * @param cb - Callback receiving note data as primitive arguments
   * @returns true if read succeeded, false if not found
   */
  readNote(
    sourceId: number,
    cb: (pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void
  ): boolean {
    const ptr = this.getNodePtr(sourceId)
    if (ptr === undefined) return false

    const prevCb = this.readNoteCallback
    this.readNoteCallback = cb

    const success = this.linker.readNode(ptr, this.handleReadNoteNode)

    this.readNoteCallback = prevCb
    return success
  }

  /**
   * Hoisted traverse callback handler (zero-allocation).
   */
  private handleTraverseNode = (
    _ptr: number,
    _opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    flags: number,
    sourceId: number,
    _seq: number
  ): void => {
    if (sourceId !== 0 && this.traverseNotesCallback !== null) {
      this.traverseNotesCallback(sourceId, pitch, velocity, duration, baseTick, (flags & 0x02) !== 0)
    }
  }

  /**
   * Hoisted getSourceId callback handler (zero-allocation).
   */
  private handleGetSourceIdNode = (
    _ptr: number,
    _opcode: number,
    _pitch: number,
    _velocity: number,
    _duration: number,
    _baseTick: number,
    _nextPtr: number,
    sourceId: number,
    flags: number,
    _seq: number
  ): void => {
    this._getSourceIdIsActive = (flags & 0x01) !== 0
    if (this._getSourceIdIsActive) {
      this._getSourceIdResult = sourceId
    }
  }

  /**
   * Hoisted getSourceLocation callback handler (zero-allocation).
   */
  private handleGetSourceLocationLookup = (_fileHash: number, line: number, column: number): void => {
    if (this.getSourceLocationCallback !== null) {
      this.getSourceLocationCallback(line, column)
    }
  }

  /**
   * Hoisted traverseSourceIds callback handler (zero-allocation).
   */
  private handleTraverseSourceIdsNode = (
    _ptr: number,
    _opcode: number,
    _pitch: number,
    _velocity: number,
    _duration: number,
    _baseTick: number,
    _flags: number,
    sourceId: number,
    _seq: number
  ): void => {
    if (sourceId > 0 && this.traverseSourceIdsCallback !== null) {
      this.traverseSourceIdsCallback(sourceId)
    }
  }

  /**
   * Traverse all notes in chain order with zero-allocation callback pattern.
   *
   * @param cb - Callback receiving note data as primitive arguments
   */
  traverseNotes(
    cb: (
      sourceId: number,
      pitch: number,
      velocity: number,
      duration: number,
      baseTick: number,
      muted: boolean
    ) => void
  ): void {
    const prevCb = this.traverseNotesCallback
    this.traverseNotesCallback = cb

    this.linker.traverse(this.handleTraverseNode)

    this.traverseNotesCallback = prevCb
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get pending patch count.
   */
  getPendingPatchCount(): number {
    return this.patchTail - this.patchHead
  }

  /**
   * Get pending structural edit count.
   */
  getPendingStructuralCount(): number {
    return this.structTail - this.structHead
  }

  /**
   * Check if there are pending operations.
   */
  hasPending(): boolean {
    return this.patchTail !== this.patchHead || this.structTail !== this.structHead
  }

  /**
   * Hard reset the entire system (RFC-044 Resilience).
   */
  hardReset(): void {
    this.linker.reset()

    const nodeCapacity = this.sab[HDR.NODE_CAPACITY]
    this.localAllocator.reset(nodeCapacity)

    // Reset ring buffer indices
    this.patchHead = 0
    this.patchTail = 0
    this.structHead = 0
    this.structTail = 0

    // Reset fired ring
    this.firedRingHead = 0
    let i = 0
    while (i < SiliconBridge.FIRED_RING_CAPACITY) {
      this.firedRing[i] = NULL_PTR
      i = i + 1
    }

    // Reset tick counter
    this.currentTick = 0
    this.patchDebounceTick = 0
    this.structDebounceTick = 0
  }

  /**
   * Get Zone B statistics (RFC-044 Telemetry).
   */
  getZoneBStats(): { usage: number; freeNodes: number } {
    return {
      usage: this.localAllocator.getUtilization(),
      freeNodes: this.localAllocator.getFreeCount()
    }
  }

  /**
   * Get the underlying Silicon Linker.
   */
  getLinker(): SiliconSynapse {
    return this.linker
  }

  // ===========================================================================
  // RFC-045: Synapse Graph API (Neural Audio Processor)
  // ===========================================================================

  /**
   * Create a synaptic connection between two clips (RFC-045 §6.2).
   *
   * @param sourceId - SOURCE_ID of the trigger node (end of clip)
   * @param targetId - SOURCE_ID of the destination node (start of next clip)
   * @param options - Optional weight (0-1000) and jitter (0-65535)
   * @returns The SynapsePtr on success, or negative error code
   */
  connect(sourceId: number, targetId: number, options: SynapseOptions = {}): number {
    const sourcePtr = this.linker.idTableLookup(sourceId)
    if (sourcePtr === NULL_PTR) {
      return BRIDGE_ERR.NOT_FOUND
    }

    const targetPtr = this.linker.idTableLookup(targetId)
    if (targetPtr === NULL_PTR) {
      return BRIDGE_ERR.NOT_FOUND
    }

    const weight = options.weight ?? 500
    const jitter = options.jitter ?? 0

    const result = this.synapseAllocator.connect(sourcePtr, targetPtr, weight, jitter)
    return result
  }

  /**
   * Remove a synaptic connection (RFC-045 §6.1).
   *
   * Sets TARGET_PTR to NULL_PTR (tombstone), making the synapse inactive.
   *
   * @param sourceId - SOURCE_ID of the trigger node
   * @param targetId - SOURCE_ID of the destination node
   * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
   */
  disconnect(sourceId: number, targetId?: number): number {
    const sourcePtr = this.linker.idTableLookup(sourceId)
    if (sourcePtr === NULL_PTR) {
      return BRIDGE_ERR.NOT_FOUND
    }

    if (targetId !== undefined) {
      const targetPtr = this.linker.idTableLookup(targetId)
      if (targetPtr === NULL_PTR) {
        return BRIDGE_ERR.NOT_FOUND
      }
      this.synapseAllocator.disconnect(sourcePtr, targetPtr)
    } else {
      this.synapseAllocator.disconnect(sourcePtr)
    }

    return BRIDGE_ERR.OK
  }

  /**
   * Disconnect all synapses FROM a source pointer. COLD PATH.
   * O(n) table scan. Zero allocations.
   */
  private disconnectAllFromSource(sourcePtr: number): number {
    this.synapseAllocator.disconnect(sourcePtr)
    return 0
  }

  /**
   * Disconnect all synapses TO a target pointer. COLD PATH.
   * O(n) table scan. Zero allocations.
   */
  private disconnectAllToTarget(targetPtr: number): number {
    let count = 0
    let slot = 0

    while (slot < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = this.synapseTableOffsetI32 + slot * SYNAPSE_TABLE.STRIDE_I32

      const target = Atomics.load(this.sab, offset + SYNAPSE.TARGET_PTR)
      if (target === targetPtr) {
        const source = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)
        if (source !== NULL_PTR) {
          // Tombstone
          Atomics.store(this.sab, offset + SYNAPSE.TARGET_PTR, NULL_PTR)
          count = count + 1
        }
      }

      slot = slot + 1
    }

    return count
  }

  /**
   * Record a fired synapse for plasticity reward distribution.
   */
  recordFiredSynapse(synapsePtr: SynapsePtr): void {
    this.firedRing[this.firedRingHead] = synapsePtr
    this.firedRingHead = (this.firedRingHead + 1) & SiliconBridge.FIRED_RING_MASK
  }

  /**
   * Apply reward to recently fired synapses (RFC-045 §5.1 Weight-Hardening).
   */
  reward(multiplier: number = 1.0): void {
    const delta = (this.learningRate * multiplier) | 0
    if (delta === 0) return

    let i = 0
    while (i < SiliconBridge.FIRED_RING_CAPACITY) {
      const synapsePtr = this.firedRing[i]
      if (synapsePtr !== NULL_PTR) {
        const offset = (synapsePtr >> 2) | 0
        const weightData = Atomics.load(this.sab, offset + SYNAPSE.WEIGHT_DATA)

        const weight = (weightData >>> SYN_PACK.WEIGHT_SHIFT) & SYN_PACK.WEIGHT_MASK
        const jitter = (weightData >>> SYN_PACK.JITTER_SHIFT) & SYN_PACK.JITTER_MASK

        let newWeight = weight + delta
        if (newWeight < 0) newWeight = 0
        if (newWeight > 1000) newWeight = 1000

        const newWeightData =
          ((newWeight & SYN_PACK.WEIGHT_MASK) << SYN_PACK.WEIGHT_SHIFT) |
          ((jitter & SYN_PACK.JITTER_MASK) << SYN_PACK.JITTER_SHIFT)

        Atomics.store(this.sab, offset + SYNAPSE.WEIGHT_DATA, newWeightData)
      }
      i = i + 1
    }
  }

  /**
   * Apply penalty to recently fired synapses (inverse of reward).
   */
  penalize(multiplier: number = 1.0): void {
    this.reward(-multiplier)
  }

  /**
   * Set the learning rate for plasticity (RFC-045 §5.1).
   */
  setLearningRate(rate: number): void {
    this.learningRate = rate
  }

  /**
   * Get the current learning rate.
   */
  getLearningRate(): number {
    return this.learningRate
  }

  /**
   * Get synapse table statistics (RFC-045 Telemetry).
   */
  getSynapseStats(): { loadFactor: number; usedSlots: number; capacity: number } {
    return {
      loadFactor: this.synapseAllocator.getLoadFactor(),
      usedSlots: this.synapseAllocator.getUsedSlots(),
      capacity: SYNAPSE_TABLE.MAX_CAPACITY
    }
  }

  // ===========================================================================
  // RFC-045: Persistence (Long-Term Memory) - Zero-Alloc Streaming API
  // ===========================================================================

  /**
   * Hoisted snapshot entry handler (zero-allocation).
   */
  private handleSnapshotEntry = (
    _slot: number,
    sourcePtr: number,
    targetPtr: number,
    weightData: number
  ): void => {
    if (this.snapshotOnSynapse === null) return

    const weight = (weightData >>> SYN_PACK.WEIGHT_SHIFT) & SYN_PACK.WEIGHT_MASK
    const jitter = (weightData >>> SYN_PACK.JITTER_SHIFT) & SYN_PACK.JITTER_MASK

    // Resolve pointers to IDs
    const sourceId = Atomics.load(this.sab, (sourcePtr >> 2) + NODE.SOURCE_ID)
    const targetId = Atomics.load(this.sab, (targetPtr >> 2) + NODE.SOURCE_ID)

    this.snapshotOnSynapse(sourceId, targetId, weight, jitter)
  }

  /**
   * Stream brain state to callbacks. COLD PATH.
   *
   * CALLER MUST provide pre-bound functions, NOT inline arrows.
   *
   * @param onSynapse - Pre-bound callback for each synapse
   * @param onComplete - Pre-bound callback when done
   */
  snapshotStream(
    onSynapse: (sourceId: number, targetId: number, weight: number, jitter: number) => void,
    onComplete: (count: number) => void
  ): void {
    this.snapshotOnSynapse = onSynapse
    this.snapshotOnComplete = onComplete

    let count = 0
    let slot = 0

    while (slot < SYNAPSE_TABLE.MAX_CAPACITY) {
      const offset = this.synapseTableOffsetI32 + slot * SYNAPSE_TABLE.STRIDE_I32

      const sourcePtr = Atomics.load(this.sab, offset + SYNAPSE.SOURCE_PTR)
      if (sourcePtr !== NULL_PTR) {
        const targetPtr = Atomics.load(this.sab, offset + SYNAPSE.TARGET_PTR)
        if (targetPtr !== NULL_PTR) {
          const weightData = Atomics.load(this.sab, offset + SYNAPSE.WEIGHT_DATA)
          this.handleSnapshotEntry(slot, sourcePtr, targetPtr, weightData)
          count = count + 1
        }
      }
      slot = slot + 1
    }

    if (this.snapshotOnComplete !== null) {
      this.snapshotOnComplete(count)
    }

    this.snapshotOnSynapse = null
    this.snapshotOnComplete = null
  }

  /**
   * Restore synapses from BrainSnapshot. COLD PATH.
   * RFC-045-04 Compliant: Zero allocations, error code handling.
   *
   * @param snapshot - Brain snapshot containing synapse connections
   * @returns Number of synapses successfully restored
   */
  restore(snapshot: BrainSnapshot): number {
    let restored = 0
    const synapses = snapshot.synapses
    const count = synapses.length
    let i = 0

    while (i < count) {
      const syn = synapses[i]

      // 1. Resolve Pointers Once (avoid double lookup)
      const sourcePtr = this.getNodePtr(syn.sourceId)
      const targetPtr = this.getNodePtr(syn.targetId)

      // 2. Direct Validation
      if (sourcePtr !== undefined && targetPtr !== undefined) {
        // 3. Direct Low-Level Write (Zero-Overhead)
        // Returns offset (positive) or error (negative)
        const result = this.synapseAllocator.connect(
          sourcePtr,
          targetPtr,
          syn.weight,
          syn.jitter
        )

        // 4. Validate Success
        if (result >= 0) {
          restored = restored + 1
        }
      }

      i = i + 1
    }

    return restored
  }

  /**
   * Restore synapses from parallel TypedArrays. COLD PATH.
   *
   * @returns Number of synapses restored
   */
  restoreFromArrays(
    sourceIds: Int32Array,
    targetIds: Int32Array,
    weights: Int32Array,
    jitters: Int32Array,
    count: number
  ): number {
    let restored = 0
    let i = 0

    while (i < count) {
      const sourceId = sourceIds[i]
      const targetId = targetIds[i]
      const weight = weights[i]
      const jitter = jitters[i]

      const sourcePtr = this.linker.idTableLookup(sourceId)
      if (sourcePtr !== NULL_PTR) {
        const targetPtr = this.linker.idTableLookup(targetId)
        if (targetPtr !== NULL_PTR) {
          const result = this.synapseAllocator.connect(sourcePtr, targetPtr, weight, jitter)
          if (result >= 0) {
            restored = restored + 1
          }
        }
      }

      i = i + 1
    }

    return restored
  }

  /**
   * Get the underlying Synapse Allocator.
   */
  getSynapseAllocator(): SynapseAllocator {
    return this.synapseAllocator
  }
}

/**
 * Create a SiliconBridge with a new linker.
 */
export function createSiliconBridge(
  options?: SiliconBridgeOptions & { nodeCapacity?: number; safeZoneTicks?: number }
): SiliconBridge {
  const linker = SiliconSynapse.create({
    nodeCapacity: options?.nodeCapacity ?? 4096,
    safeZoneTicks: options?.safeZoneTicks
  })
  return new SiliconBridge(linker, options)
}
