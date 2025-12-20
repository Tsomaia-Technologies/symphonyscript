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

  // ReadNote callback state (for zero-alloc readNote)
  private readNoteCallback:
    | ((pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void)
    | null = null

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
   *
   * CRITICAL: SourceIds must fit in positive Int32 range (1 to 2^31-1)
   * to avoid sign issues when stored/read from SAB.
   *
   * NOTE: Location is NOT stored here. Call registerMapping() with location
   * data after inserting into Identity Table to store in Symbol Table.
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

    // Ensure positive Int32 range: 1 to 0x7FFFFFFF
    // Use >>> 0 to convert to unsigned, then & to mask to 31 bits
    // If result is 0, use nextSourceId instead (0 is reserved for EMPTY_TID)
    const maskedHash = (Math.abs(locationHash) >>> 0) & 0x7FFFFFFF
    const sourceId = maskedHash || this.nextSourceId++ // Ensures sourceId >= 1

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
   * Reads SOURCE_ID directly from the node in SAB.
   * Returns undefined if node is not active (freed).
   */
  getSourceId(ptr: NodePtr): number | undefined {
    if (ptr === NULL_PTR) return undefined
    // Read SOURCE_ID from node using callback pattern
    // Also check ACTIVE flag (bit 0 of flags) to verify node is valid
    let sourceId: number | undefined
    let isActive = false
    this.linker.readNode(ptr, (_p, _opcode, _pitch, _velocity, _duration, _baseTick, _nextPtr, sid, flags) => {
      isActive = (flags & 0x01) !== 0 // FLAG.ACTIVE = 0x01
      if (isActive) {
        sourceId = sid
      }
    })
    return sourceId
  }

  /**
   * Get source location for a SOURCE_ID.
   * Reads from Symbol Table in SAB (zero-allocation via callback).
   *
   * NOTE: File path is not recoverable from Symbol Table (only fileHash is stored).
   * Returns { line, column } without the file field.
   */
  getSourceLocation(sourceId: number): SourceLocation | undefined {
    let result: SourceLocation | undefined
    const found = this.linker.symTableLookup(sourceId, (_fileHash, line, column) => {
      result = { line, column }
    })
    return found ? result : undefined
  }

  /**
   * Register a mapping between SOURCE_ID and NodePtr.
   * Inserts into Identity Table in SAB.
   * Optionally stores source location in Symbol Table.
   *
   * @param sourceId - Source ID
   * @param ptr - Node pointer
   * @param source - Optional source location to store in Symbol Table
   */
  private registerMapping(sourceId: number, ptr: NodePtr, source?: SourceLocation): void {
    this.linker.idTableInsert(sourceId, ptr)

    // Store location in Symbol Table if provided
    if (source) {
      const fileHash = source.file ? this.hashString(source.file) : 0
      this.linker.symTableStore(sourceId, fileHash, source.line, source.column)
    }
  }

  /**
   * Unregister a mapping.
   * Removes from Identity Table and Symbol Table in SAB.
   */
  private unregisterMapping(sourceId: number, _ptr: NodePtr): void {
    this.linker.idTableRemove(sourceId)
    this.linker.symTableRemove(sourceId)
  }

  /**
   * Traverse all registered SOURCE_IDs with zero-allocation callback pattern.
   *
   * **Zero-Alloc Alternative to getAllSourceIds()**: Instead of collecting IDs
   * into an array, this method invokes a callback for each sourceId, avoiding
   * intermediate array allocations.
   *
   * @param cb - Callback invoked with each sourceId
   */
  traverseSourceIds(cb: (sourceId: number) => void): void {
    this.linker.traverse((_ptr, _opcode, _pitch, _velocity, _duration, _baseTick, _flags, sourceId) => {
      if (sourceId > 0) {
        cb(sourceId)
      }
    })
  }

  /**
   * Get mapping count.
   * Returns the node count from the linker.
   */
  getMappingCount(): number {
    return this.linker.getNodeCount()
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
   * @param explicitSourceId - Optional explicit SOURCE_ID to use instead of generating
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
    afterSourceId?: number,
    explicitSourceId?: number
  ): number {
    const sourceId = explicitSourceId ?? this.generateSourceId(source)

    // ZERO-ALLOC: Compute flags once on stack, pass primitives directly
    const flags = muted ? 0x02 : 0 // FLAG.MUTED = 0x02

    let ptr: NodePtr

    if (afterSourceId !== undefined) {
      const afterPtr = this.getNodePtr(afterSourceId)
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

    this.registerMapping(sourceId, ptr, source)
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
    const ptr = this.getNodePtr(sourceId)
    if (ptr === undefined) {
      throw new Error(`Unknown sourceId: ${sourceId}`)
    }

    this.linker.deleteNode(ptr)
    this.unregisterMapping(sourceId, ptr)
  }

  /**
   * Patch an attribute immediately (bypasses debounce).
   */
  patchImmediate(sourceId: number, type: PatchType, value: number | boolean): void {
    const ptr = this.getNodePtr(sourceId)
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
            const afterPtr = this.getNodePtr(op.afterSourceId)
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

          this.registerMapping(op.sourceId, ptr, op.data.source)
          this.onStructuralApplied?.('insert', op.sourceId)

          // Synchronously wait for ACK before next structural edit
          this.linker.syncAck()
        } else if (op.type === 'delete' && op.sourceId !== undefined) {
          const ptr = this.getNodePtr(op.sourceId!)
          if (ptr !== undefined) {
            this.linker.deleteNode(ptr)
            this.unregisterMapping(op.sourceId, ptr)
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
   * **Zero-Alloc While-Head Deletion**: Iteratively deletes the head node until
   * the chain is empty. No intermediate arrays or object allocations.
   *
   * **Memset-Style Table Clear**: Uses idTableClear() and symTableClear() to
   * zero the table regions in SAB.
   */
  clear(): void {
    // ZERO-ALLOC: While-head deletion loop (no intermediate array)
    let headPtr = this.linker.getHead()
    while (headPtr !== NULL_PTR) {
      try {
        this.linker.deleteNode(headPtr)
      } catch {
        // Node may already be deleted, break to avoid infinite loop
        break
      }
      headPtr = this.linker.getHead()
    }

    // Clear Identity Table (memset-style)
    this.linker.idTableClear()

    // Clear Symbol Table (memset-style)
    this.linker.symTableClear()

    // Clear pending operations
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
   * Invokes the user-supplied callback stored in readNoteCallback with primitives.
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
    // ZERO-ALLOC: Invoke user callback with primitives directly
    if (this.readNoteCallback) {
      this.readNoteCallback(pitch, velocity, duration, baseTick, (flags & 0x02) !== 0)
    }
  }

  /**
   * Read note data by SOURCE_ID with zero-allocation callback pattern.
   *
   * **Zero-Alloc Kernel Path**: Uses callback with argument explosion to
   * eliminate all object allocations in the read path.
   *
   * CRITICAL: Callback function must be pre-bound/hoisted to avoid allocations.
   * DO NOT pass inline arrow functions - they allocate objects.
   *
   * @param sourceId - Source ID to read
   * @param cb - Callback receiving note data as primitive arguments
   * @returns true if read succeeded, false if not found or contention detected
   */
  readNote(
    sourceId: number,
    cb: (pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void
  ): boolean {
    const ptr = this.getNodePtr(sourceId)
    if (ptr === undefined) return false

    // Save previous callback to support re-entrancy (same pattern as traverseNotes)
    const prevCb = this.readNoteCallback
    this.readNoteCallback = cb

    try {
      // ZERO-ALLOC: Use pre-bound callback handler
      const success = this.linker.readNode(ptr, this.handleReadNoteNode)
      return success
    } catch {
      return false
    } finally {
      // Restore previous callback (or null if no outer read)
      this.readNoteCallback = prevCb
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
