// =============================================================================
// SymphonyScript - Silicon Bridge (RFC-043 Phase 4)
// =============================================================================
// Editor integration layer that wires ClipBuilder to Silicon Linker.
// Provides SOURCE_ID ↔ NodePtr bidirectional mapping and 10ms debounce.

import { SiliconLinker } from './silicon-linker'
import { OPCODE, NULL_PTR } from './constants'
import type { NodePtr } from './types'

// =============================================================================
// Types
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
 * Patch operation types.
 */
export type PatchType = 'pitch' | 'velocity' | 'duration' | 'baseTick' | 'muted'

/**
 * Pending patch operation.
 */
interface PendingPatch {
  sourceId: number
  type: PatchType
  value: number | boolean
  timestamp: number
}

/**
 * Pending structural operation.
 */
interface PendingStructural {
  type: 'insert' | 'delete'
  data?: EditorNoteData
  sourceId?: number
  afterSourceId?: number
  timestamp: number
}

/**
 * Bridge configuration options.
 */
export interface SiliconBridgeOptions {
  /** Debounce delay for attribute patches (default: 10ms) */
  attributeDebounceMs?: number
  /** Debounce delay for structural edits (default: 10ms) */
  structuralDebounceMs?: number
  /** Callback when a patch is applied */
  onPatchApplied?: (sourceId: number, type: PatchType, value: number | boolean) => void
  /** Callback when a structural edit is applied */
  onStructuralApplied?: (type: 'insert' | 'delete', sourceId: number) => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
}

// =============================================================================
// SiliconBridge
// =============================================================================

/**
 * Silicon Bridge - Editor integration layer for RFC-043.
 *
 * This class:
 * - Provides bidirectional SOURCE_ID ↔ NodePtr mapping
 * - Implements 10ms debounce for edits
 * - Translates editor operations to linker method calls
 * - Maintains the mapping as nodes are added/removed
 */
export class SiliconBridge {
  private linker: SiliconLinker

  // Bidirectional mapping
  private sourceIdToPtr: Map<number, NodePtr> = new Map()
  private ptrToSourceId: Map<NodePtr, number> = new Map()

  // Source location tracking (optional, for editor integration)
  private sourceIdToLocation: Map<number, SourceLocation> = new Map()

  // Debounce state
  private pendingPatches: Map<string, PendingPatch> = new Map() // key: `${sourceId}:${type}`
  private pendingStructural: PendingStructural[] = []
  private attributeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private structuralDebounceTimer: ReturnType<typeof setTimeout> | null = null

  // Configuration
  private attributeDebounceMs: number
  private structuralDebounceMs: number
  private onPatchApplied?: (sourceId: number, type: PatchType, value: number | boolean) => void
  private onStructuralApplied?: (type: 'insert' | 'delete', sourceId: number) => void
  private onError?: (error: Error) => void

  // Source ID generation
  private nextSourceId: number = 1

  // Traverse callback state (for zero-alloc traverseNotes)
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

  // ReadNote callback state (for zero-alloc readNode)
  private readNoteResult: EditorNoteData | undefined = undefined
  private readNoteSourceId: number = 0

  constructor(linker: SiliconLinker, options: SiliconBridgeOptions = {}) {
    this.linker = linker
    this.attributeDebounceMs = options.attributeDebounceMs ?? 10
    this.structuralDebounceMs = options.structuralDebounceMs ?? 10
    this.onPatchApplied = options.onPatchApplied
    this.onStructuralApplied = options.onStructuralApplied
    this.onError = options.onError
  }

  // ===========================================================================
  // Source ID Generation
  // ===========================================================================

  /**
   * Generate a SOURCE_ID from a source location.
   * Uses a hash of file:line:column for uniqueness.
   */
  generateSourceId(source?: SourceLocation): number {
    if (!source) {
      return this.nextSourceId++
    }

    // Simple hash: combine file hash + line + column
    const fileHash = source.file
      ? this.hashString(source.file)
      : 0
    const locationHash = (fileHash * 31 + source.line) * 31 + source.column

    // Ensure positive and unique
    const sourceId = Math.abs(locationHash) || this.nextSourceId++

    // Store location for reverse lookup
    this.sourceIdToLocation.set(sourceId, source)

    return sourceId
  }

  /**
   * Simple string hash function.
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return hash
  }

  // ===========================================================================
  // Bidirectional Mapping
  // ===========================================================================

  /**
   * Get NodePtr for a SOURCE_ID.
   */
  getNodePtr(sourceId: number): NodePtr | undefined {
    return this.sourceIdToPtr.get(sourceId)
  }

  /**
   * Get SOURCE_ID for a NodePtr.
   */
  getSourceId(ptr: NodePtr): number | undefined {
    return this.ptrToSourceId.get(ptr)
  }

  /**
   * Get source location for a SOURCE_ID.
   */
  getSourceLocation(sourceId: number): SourceLocation | undefined {
    return this.sourceIdToLocation.get(sourceId)
  }

  /**
   * Register a mapping between SOURCE_ID and NodePtr.
   */
  private registerMapping(sourceId: number, ptr: NodePtr): void {
    this.sourceIdToPtr.set(sourceId, ptr)
    this.ptrToSourceId.set(ptr, sourceId)
  }

  /**
   * Unregister a mapping.
   */
  private unregisterMapping(sourceId: number, ptr: NodePtr): void {
    this.sourceIdToPtr.delete(sourceId)
    this.ptrToSourceId.delete(ptr)
  }

  /**
   * Get all registered SOURCE_IDs.
   */
  getAllSourceIds(): number[] {
    return Array.from(this.sourceIdToPtr.keys())
  }

  /**
   * Get mapping count.
   */
  getMappingCount(): number {
    return this.sourceIdToPtr.size
  }

  // ===========================================================================
  // Immediate Operations (No Debounce)
  // ===========================================================================

  /**
   * Insert a MIDI event immediately (bypasses debounce).
   * Used for initial clip loading and real-time event insertion.
   *
   * **Zero-Alloc Implementation**: Uses argument explosion to eliminate
   * object allocation in the kernel write path.
   *
   * **Generalized API**: Supports full MIDI instruction set (NOTE, CC, BEND, etc.)
   * via opcode parameter, eliminating the need for encapsulation-breaking hacks.
   *
   * @param opcode - MIDI opcode (OPCODE.NOTE, OPCODE.CC, OPCODE.BEND, etc.)
   * @param pitch - MIDI pitch (NOTE) or controller number (CC)
   * @param velocity - MIDI velocity (NOTE) or value (CC/BEND)
   * @param duration - Duration in ticks (0 for CC/BEND)
   * @param baseTick - Base tick (grid-aligned timing)
   * @param muted - Whether the event is muted
   * @param source - Optional source location for editor mapping
   * @param afterSourceId - Optional SOURCE_ID to insert after
   * @returns The SOURCE_ID assigned to the new node
   */
  insertImmediate(
    opcode: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number,
    muted: boolean = false,
    source?: SourceLocation,
    afterSourceId?: number
  ): number {
    const sourceId = this.generateSourceId(source)

    // ZERO-ALLOC: Compute flags once on stack, pass primitives directly
    const flags = muted ? 0x02 : 0 // FLAG.MUTED = 0x02

    let ptr: NodePtr

    if (afterSourceId !== undefined) {
      const afterPtr = this.sourceIdToPtr.get(afterSourceId)
      if (afterPtr === undefined) {
        throw new Error(`Unknown afterSourceId: ${afterSourceId}`)
      }
      ptr = this.linker.insertNode(
        afterPtr,
        opcode,
        pitch,
        velocity,
        duration,
        baseTick,
        sourceId,
        flags
      )
    } else {
      ptr = this.linker.insertHead(
        opcode,
        pitch,
        velocity,
        duration,
        baseTick,
        sourceId,
        flags
      )
    }

    this.registerMapping(sourceId, ptr)
    return sourceId
  }

  /**
   * Insert a note immediately (bypasses debounce).
   * Convenience wrapper for insertImmediate with OPCODE.NOTE.
   *
   * @deprecated Use insertImmediate directly for better clarity
   */
  insertNoteImmediate(note: EditorNoteData, afterSourceId?: number): number {
    return this.insertImmediate(
      OPCODE.NOTE,
      note.pitch,
      note.velocity,
      note.duration,
      note.baseTick,
      note.muted,
      note.source,
      afterSourceId
    )
  }

  /**
   * Delete a note immediately (bypasses debounce).
   */
  deleteNoteImmediate(sourceId: number): void {
    const ptr = this.sourceIdToPtr.get(sourceId)
    if (ptr === undefined) {
      throw new Error(`Unknown sourceId: ${sourceId}`)
    }

    this.linker.deleteNode(ptr)
    this.unregisterMapping(sourceId, ptr)
    this.sourceIdToLocation.delete(sourceId)
  }

  /**
   * Patch an attribute immediately (bypasses debounce).
   */
  patchImmediate(sourceId: number, type: PatchType, value: number | boolean): void {
    const ptr = this.sourceIdToPtr.get(sourceId)
    if (ptr === undefined) {
      throw new Error(`Unknown sourceId: ${sourceId}`)
    }

    switch (type) {
      case 'pitch':
        this.linker.patchPitch(ptr, value as number)
        break
      case 'velocity':
        this.linker.patchVelocity(ptr, value as number)
        break
      case 'duration':
        this.linker.patchDuration(ptr, value as number)
        break
      case 'baseTick':
        this.linker.patchBaseTick(ptr, value as number)
        break
      case 'muted':
        this.linker.patchMuted(ptr, value as boolean)
        break
    }

    this.onPatchApplied?.(sourceId, type, value)
  }

  // ===========================================================================
  // Debounced Operations
  // ===========================================================================

  /**
   * Queue an attribute patch with debouncing.
   * Multiple patches to the same sourceId:type are coalesced.
   */
  patchDebounced(sourceId: number, type: PatchType, value: number | boolean): void {
    const key = `${sourceId}:${type}`

    this.pendingPatches.set(key, {
      sourceId,
      type,
      value,
      timestamp: Date.now()
    })

    this.scheduleAttributeFlush()
  }

  /**
   * Queue a structural insert with debouncing.
   */
  insertNoteDebounced(note: EditorNoteData, afterSourceId?: number): void {
    const sourceId = this.generateSourceId(note.source)

    this.pendingStructural.push({
      type: 'insert',
      data: note,
      sourceId,
      afterSourceId,
      timestamp: Date.now()
    })

    this.scheduleStructuralFlush()
  }

  /**
   * Queue a structural delete with debouncing.
   */
  deleteNoteDebounced(sourceId: number): void {
    this.pendingStructural.push({
      type: 'delete',
      sourceId,
      timestamp: Date.now()
    })

    this.scheduleStructuralFlush()
  }

  /**
   * Schedule attribute patch flush.
   */
  private scheduleAttributeFlush(): void {
    if (this.attributeDebounceTimer) {
      clearTimeout(this.attributeDebounceTimer)
    }

    this.attributeDebounceTimer = setTimeout(() => {
      this.flushPatches()
    }, this.attributeDebounceMs)
  }

  /**
   * Schedule structural edit flush.
   */
  private scheduleStructuralFlush(): void {
    if (this.structuralDebounceTimer) {
      clearTimeout(this.structuralDebounceTimer)
    }

    this.structuralDebounceTimer = setTimeout(() => {
      this.flushStructural()
    }, this.structuralDebounceMs)
  }

  /**
   * Flush all pending attribute patches.
   */
  flushPatches(): void {
    this.attributeDebounceTimer = null

    for (const patch of this.pendingPatches.values()) {
      try {
        this.patchImmediate(patch.sourceId, patch.type, patch.value)
      } catch (error) {
        this.onError?.(error as Error)
      }
    }

    this.pendingPatches.clear()
  }

  /**
   * Flush all pending structural edits.
   *
   * **Blocking Synchronization Model**: This method is synchronous and blocks
   * until each structural operation is acknowledged by the AudioWorklet.
   *
   * **Zero-Alloc Implementation**: Uses standard for loop and argument explosion
   * to eliminate iterator and object allocations in the hot path.
   */
  flushStructural(): void {
    this.structuralDebounceTimer = null

    // Process in order - ZERO-ALLOC: Standard for loop (no iterator allocation)
    for (let i = 0; i < this.pendingStructural.length; i++) {
      const op = this.pendingStructural[i]
      try {
        if (op.type === 'insert' && op.data && op.sourceId !== undefined) {
          // ZERO-ALLOC: Compute flags once on stack, pass primitives directly
          const flags = op.data.muted ? 0x02 : 0

          let ptr: NodePtr

          if (op.afterSourceId !== undefined) {
            const afterPtr = this.sourceIdToPtr.get(op.afterSourceId)
            if (afterPtr !== undefined) {
              ptr = this.linker.insertNode(
                afterPtr,
                OPCODE.NOTE,
                op.data.pitch,
                op.data.velocity,
                op.data.duration,
                op.data.baseTick,
                op.sourceId,
                flags
              )
            } else {
              ptr = this.linker.insertHead(
                OPCODE.NOTE,
                op.data.pitch,
                op.data.velocity,
                op.data.duration,
                op.data.baseTick,
                op.sourceId,
                flags
              )
            }
          } else {
            ptr = this.linker.insertHead(
              OPCODE.NOTE,
              op.data.pitch,
              op.data.velocity,
              op.data.duration,
              op.data.baseTick,
              op.sourceId,
              flags
            )
          }

          this.registerMapping(op.sourceId, ptr)
          this.onStructuralApplied?.('insert', op.sourceId)

          // Synchronously wait for ACK before next structural edit
          this.linker.syncAck()
        } else if (op.type === 'delete' && op.sourceId !== undefined) {
          const ptr = this.sourceIdToPtr.get(op.sourceId)
          if (ptr !== undefined) {
            this.linker.deleteNode(ptr)
            this.unregisterMapping(op.sourceId, ptr)
            this.sourceIdToLocation.delete(op.sourceId)
            this.onStructuralApplied?.('delete', op.sourceId)

            // Synchronously wait for ACK before next structural edit
            this.linker.syncAck()
          }
        }
      } catch (error) {
        this.onError?.(error as Error)
      }
    }

    this.pendingStructural = []
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Load a clip by inserting all notes.
   * Notes should be sorted by baseTick for optimal chain structure.
   *
   * @param notes - Array of notes sorted by baseTick
   * @returns Array of SOURCE_IDs in insertion order
   */
  loadClip(notes: EditorNoteData[]): number[] {
    const sourceIds: number[] = []

    // Insert in reverse order so chain is sorted (insertHead prepends)
    for (let i = notes.length - 1; i >= 0; i--) {
      const sourceId = this.insertNoteImmediate(notes[i])
      sourceIds.unshift(sourceId) // Maintain original order
    }

    return sourceIds
  }

  /**
   * Clear all notes and mappings.
   *
   * **Zero-Alloc Loop**: Uses Array.from to convert Map keys to array once,
   * then standard for loop to avoid iterator allocation in the hot path.
   */
  clear(): void {
    // ZERO-ALLOC: Convert to array once, then use standard for loop
    const ptrs = Array.from(this.ptrToSourceId.keys())
    for (let i = 0; i < ptrs.length; i++) {
      try {
        this.linker.deleteNode(ptrs[i])
      } catch {
        // Node may already be deleted
      }
    }

    this.sourceIdToPtr.clear()
    this.ptrToSourceId.clear()
    this.sourceIdToLocation.clear()
    this.pendingPatches.clear()
    this.pendingStructural = []

    if (this.attributeDebounceTimer) {
      clearTimeout(this.attributeDebounceTimer)
      this.attributeDebounceTimer = null
    }

    if (this.structuralDebounceTimer) {
      clearTimeout(this.structuralDebounceTimer)
      this.structuralDebounceTimer = null
    }
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Hoisted readNode callback handler (zero-allocation).
   * CRITICAL: This method is pre-bound to avoid object allocation in readNode().
   */
  private handleReadNode = (
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
    // Store result in instance state (accessed after callback returns)
    this.readNoteResult = {
      pitch,
      velocity,
      duration,
      baseTick,
      muted: (flags & 0x02) !== 0,
      source: this.sourceIdToLocation.get(this.readNoteSourceId)
    }
  }

  /**
   * Read note data by SOURCE_ID.
   *
   * **Zero-Alloc Kernel Path**: Uses pre-bound callback handler to avoid
   * allocating objects during the linker read operation.
   */
  readNote(sourceId: number): EditorNoteData | undefined {
    const ptr = this.sourceIdToPtr.get(sourceId)
    if (ptr === undefined) return undefined

    try {
      // Reset result state
      this.readNoteResult = undefined
      this.readNoteSourceId = sourceId

      // ZERO-ALLOC: Use pre-bound callback handler
      const success = this.linker.readNode(ptr, this.handleReadNode)

      // Handle contention - return undefined if node read failed
      if (!success) return undefined

      return this.readNoteResult
    } catch {
      return undefined
    }
  }

  /**
   * Hoisted traverse callback handler (zero-allocation).
   * CRITICAL: This method is pre-bound to avoid object allocation in traverse().
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
    if (sourceId !== 0 && this.traverseNotesCallback) {
      // Pass primitives directly (zero allocation)
      this.traverseNotesCallback(
        sourceId,
        pitch,
        velocity,
        duration,
        baseTick,
        (flags & 0x02) !== 0 // muted
      )
    }
  }

  /**
   * Traverse all notes in chain order with zero-allocation callback pattern.
   *
   * CRITICAL: This method adheres to the Zero-Alloc policy.
   * It uses a pre-bound handler and argument explosion (passing primitives)
   * to avoid all object allocations in the hot loop.
   *
   * Supports re-entrancy: nested calls to traverseNotes will not corrupt
   * the callback state of outer traversals.
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
    try {
      this.linker.traverse(this.handleTraverseNode)
    } finally {
      this.traverseNotesCallback = prevCb
    }
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get pending patch count.
   */
  getPendingPatchCount(): number {
    return this.pendingPatches.size
  }

  /**
   * Get pending structural edit count.
   */
  getPendingStructuralCount(): number {
    return this.pendingStructural.length
  }

  /**
   * Check if there are pending operations.
   */
  hasPending(): boolean {
    return this.pendingPatches.size > 0 || this.pendingStructural.length > 0
  }

  /**
   * Get the underlying Silicon Linker.
   */
  getLinker(): SiliconLinker {
    return this.linker
  }
}

/**
 * Create a SiliconBridge with a new linker.
 */
export function createSiliconBridge(
  options?: SiliconBridgeOptions & { nodeCapacity?: number; safeZoneTicks?: number }
): SiliconBridge {
  const linker = SiliconLinker.create({
    nodeCapacity: options?.nodeCapacity ?? 4096,
    safeZoneTicks: options?.safeZoneTicks
  })
  return new SiliconBridge(linker, options)
}
