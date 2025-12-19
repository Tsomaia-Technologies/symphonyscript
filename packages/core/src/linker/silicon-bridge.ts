// =============================================================================
// SymphonyScript - Silicon Bridge (RFC-043 Phase 4)
// =============================================================================
// Editor integration layer that wires ClipBuilder to Silicon Linker.
// Provides SOURCE_ID ↔ NodePtr bidirectional mapping and 10ms debounce.

import { SiliconLinker } from './silicon-linker'
import { OPCODE, NULL_PTR } from './constants'
import type { NodePtr, NodeData } from './types'

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
   * Insert a note immediately (bypasses debounce).
   * Used for initial clip loading.
   *
   * @returns The SOURCE_ID assigned to the new node
   */
  insertNoteImmediate(note: EditorNoteData, afterSourceId?: number): number {
    const sourceId = this.generateSourceId(note.source)

    const nodeData: NodeData = {
      opcode: OPCODE.NOTE,
      pitch: note.pitch,
      velocity: note.velocity,
      duration: note.duration,
      baseTick: note.baseTick,
      sourceId,
      flags: note.muted ? 0x02 : 0 // FLAG.MUTED = 0x02
    }

    let ptr: NodePtr

    if (afterSourceId !== undefined) {
      const afterPtr = this.sourceIdToPtr.get(afterSourceId)
      if (afterPtr === undefined) {
        throw new Error(`Unknown afterSourceId: ${afterSourceId}`)
      }
      ptr = this.linker.insertNode(afterPtr, nodeData)
    } else {
      ptr = this.linker.insertHead(nodeData)
    }

    this.registerMapping(sourceId, ptr)
    return sourceId
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
   */
  async flushStructural(): Promise<void> {
    this.structuralDebounceTimer = null

    // Process in order
    for (const op of this.pendingStructural) {
      try {
        if (op.type === 'insert' && op.data && op.sourceId !== undefined) {
          // Re-generate sourceId if needed (it was pre-generated)
          const nodeData: NodeData = {
            opcode: OPCODE.NOTE,
            pitch: op.data.pitch,
            velocity: op.data.velocity,
            duration: op.data.duration,
            baseTick: op.data.baseTick,
            sourceId: op.sourceId,
            flags: op.data.muted ? 0x02 : 0
          }

          let ptr: NodePtr

          if (op.afterSourceId !== undefined) {
            const afterPtr = this.sourceIdToPtr.get(op.afterSourceId)
            if (afterPtr !== undefined) {
              ptr = this.linker.insertNode(afterPtr, nodeData)
            } else {
              ptr = this.linker.insertHead(nodeData)
            }
          } else {
            ptr = this.linker.insertHead(nodeData)
          }

          this.registerMapping(op.sourceId, ptr)
          this.onStructuralApplied?.('insert', op.sourceId)

          // Wait for ACK before next structural edit
          await this.linker.awaitAck()
        } else if (op.type === 'delete' && op.sourceId !== undefined) {
          const ptr = this.sourceIdToPtr.get(op.sourceId)
          if (ptr !== undefined) {
            this.linker.deleteNode(ptr)
            this.unregisterMapping(op.sourceId, ptr)
            this.sourceIdToLocation.delete(op.sourceId)
            this.onStructuralApplied?.('delete', op.sourceId)

            // Wait for ACK before next structural edit
            await this.linker.awaitAck()
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
   */
  clear(): void {
    // Delete all nodes
    for (const ptr of this.ptrToSourceId.keys()) {
      try {
        this.linker.deleteNode(ptr)
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
   * Read note data by SOURCE_ID.
   */
  readNote(sourceId: number): EditorNoteData | undefined {
    const ptr = this.sourceIdToPtr.get(sourceId)
    if (ptr === undefined) return undefined

    try {
      const node = this.linker.readNode(ptr)
      return {
        pitch: node.pitch,
        velocity: node.velocity,
        duration: node.duration,
        baseTick: node.baseTick,
        muted: (node.flags & 0x02) !== 0,
        source: this.sourceIdToLocation.get(sourceId)
      }
    } catch {
      return undefined
    }
  }

  /**
   * Iterate all notes in chain order.
   */
  *iterateNotes(): Generator<{ sourceId: number; note: EditorNoteData }> {
    for (const node of this.linker.iterateChain()) {
      const sourceId = node.sourceId
      if (sourceId !== 0) {
        yield {
          sourceId,
          note: {
            pitch: node.pitch,
            velocity: node.velocity,
            duration: node.duration,
            baseTick: node.baseTick,
            muted: (node.flags & 0x02) !== 0,
            source: this.sourceIdToLocation.get(sourceId)
          }
        }
      }
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
