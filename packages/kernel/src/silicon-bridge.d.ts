import { SiliconSynapse } from './silicon-synapse';
import type { NodePtr, SynapsePtr, BrainSnapshotArrays } from './types';
import { SynapseAllocator } from './synapse-allocator';
/**
 * Source location information for editor integration.
 */
export interface SourceLocation {
    /** File path or identifier */
    file?: string;
    /** Line number (1-based) */
    line: number;
    /** Column number (1-based) */
    column: number;
}
/**
 * Note data from the editor/ClipBuilder.
 */
export interface EditorNoteData {
    pitch: number;
    velocity: number;
    duration: number;
    baseTick: number;
    muted?: boolean;
    source?: SourceLocation;
}
/**
 * Patch operation type codes (zero-allocation enum replacement).
 */
export declare const PATCH_TYPE: {
    readonly PITCH: 0;
    readonly VELOCITY: 1;
    readonly DURATION: 2;
    readonly BASE_TICK: 3;
    readonly MUTED: 4;
};
export type PatchType = 'pitch' | 'velocity' | 'duration' | 'baseTick' | 'muted';
export type { BrainSnapshotArrays } from './types';
/**
 * Bridge configuration options.
 */
export interface SiliconBridgeOptions {
    /** Debounce delay for attribute patches in ticks (default: 10) */
    attributeDebounceTicks?: number;
    /** Debounce delay for structural edits in ticks (default: 10) */
    structuralDebounceTicks?: number;
    /** Callback when a patch is applied */
    onPatchApplied?: (sourceId: number, type: PatchType, value: number | boolean) => void;
    /** Callback when a structural edit is applied */
    onStructuralApplied?: (type: 'insert' | 'delete', sourceId: number) => void;
    /** Callback when an error occurs (receives error code) */
    onError?: (errorCode: number) => void;
    /** Learning rate for plasticity weight hardening (default: 10 = +1% per reward) */
    learningRate?: number;
}
/**
 * Options for creating a synaptic connection.
 */
export interface SynapseOptions {
    /** Probability/Intensity (0-1000, where 1000 = 100%) */
    weight?: number;
    /** Micro-timing deviation in ticks (0-65535) */
    jitter?: number;
}
/**
 * Silicon Bridge - Editor integration layer for RFC-043.
 *
 * RFC-045-04 COMPLIANT: Absolute zero allocations in hot paths.
 * - All state uses pre-allocated TypedArrays
 * - Error handling via return codes (no throw/try/catch)
 * - Debouncing via tick counter (no setTimeout)
 * - All loops use index-based iteration (no for...of)
 */
export declare class SiliconBridge {
    private linker;
    private localAllocator;
    private ringBuffer;
    private sab;
    private synapseAllocator;
    private synapseTableOffsetI32;
    private reverseIndexI32;
    /** Learning rate for plasticity (default: 10 = +1% per reward) */
    private learningRate;
    private static readonly FIRED_RING_CAPACITY;
    private static readonly FIRED_RING_MASK;
    private readonly firedRing;
    private firedRingHead;
    private static readonly PATCH_RING_CAPACITY;
    private static readonly PATCH_RING_MASK;
    private readonly patchSourceIds;
    private readonly patchTypes;
    private readonly patchValues;
    private patchHead;
    private patchTail;
    private static readonly STRUCT_RING_CAPACITY;
    private static readonly STRUCT_RING_MASK;
    private readonly structTypes;
    private readonly structSourceIds;
    private readonly structAfterIds;
    private readonly structPitches;
    private readonly structVelocities;
    private readonly structDurations;
    private readonly structBaseTicks;
    private readonly structFlags;
    private structHead;
    private structTail;
    private currentTick;
    private patchDebounceTick;
    private structDebounceTick;
    private attributeDebounceTicks;
    private structuralDebounceTicks;
    private onPatchApplied;
    private onStructuralApplied;
    private onError;
    private nextSourceId;
    private handleReadNoteNode;
    private handleTraverseNode;
    private handleGetSourceIdNode;
    private handleGetSourceLocationLookup;
    private handleTraverseSourceIdsNode;
    private handleSnapshotEntry;
    private traverseNotesCallback;
    private readNoteCallback;
    private _getSourceIdResult;
    private _getSourceIdIsActive;
    private getSourceLocationCallback;
    private traverseSourceIdsCallback;
    private snapshotOnSynapse;
    private snapshotOnComplete;
    constructor(linker: SiliconSynapse, options?: SiliconBridgeOptions);
    /**
     * Generate a SOURCE_ID from a source location.
     * Uses a hash of file:line:column for uniqueness.
     *
     * CRITICAL: SourceIds must fit in positive Int32 range (1 to 2^31-1).
     * RFC-045-04: Implements wraparound at MAX to prevent overflow.
     */
    /**
     * Get the underlying SharedArrayBuffer.
     */
    getSAB(): SharedArrayBuffer;
    /**
     * Set playback offset for hardware latency compensation.
     *
     * Writes value directly to SAB using Atomics.store for thread-safety.
     * Value is stored in milliseconds and converted to ticks by Audio Worklet.
     *
     * @param offsetMs - Hardware latency in milliseconds
     */
    setPlaybackOffset(offsetMs: number): void;
    /**
     * Get current playback offset.
     *
     * @returns Playback offset in milliseconds
     */
    getPlaybackOffset(): number;
    generateSourceId(source?: SourceLocation): number;
    /**
     * Advance nextSourceId with wraparound (RFC-045-04).
     *
     * Returns the current ID and advances the counter. When MAX is exceeded,
     * wraps around to MIN. This handles theoretical 2B+ note scenarios.
     *
     * Note: Wraparound means potential ID collision with very old notes.
     * In practice, old notes should be deleted before 2B new ones are created.
     */
    private _advanceSourceId;
    /**
     * Simple string hash function.
     */
    private hashString;
    /**
     * Get NodePtr for a SOURCE_ID.
     * Uses Identity Table in SAB for O(1) lookup.
     */
    getNodePtr(sourceId: number): NodePtr | undefined;
    /**
     * Get SOURCE_ID for a NodePtr.
     * Returns undefined if node is not active or not found.
     *
     * **Zero-Alloc Implementation**: Uses hoisted handler.
     */
    getSourceId(ptr: NodePtr): number | undefined;
    /**
     * Get source location for a SOURCE_ID with zero-allocation callback pattern.
     *
     * @param sourceId - Source ID to lookup
     * @param cb - Callback receiving (line, column) primitives
     * @returns true if found and callback invoked, false if not found
     */
    getSourceLocation(sourceId: number, cb: (line: number, column: number) => void): boolean;
    /**
     * Register a mapping between SOURCE_ID and NodePtr.
     */
    private registerMapping;
    /**
     * Unregister a mapping.
     */
    private unregisterMapping;
    /**
     * Traverse all registered SOURCE_IDs with zero-allocation callback pattern.
     *
     * @param cb - Callback invoked with each sourceId
     */
    traverseSourceIds(cb: (sourceId: number) => void): void;
    /**
     * Get mapping count.
     */
    getMappingCount(): number;
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
    _insertImmediateInternal(opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, muted?: boolean, source?: SourceLocation, afterSourceId?: number, explicitSourceId?: number): number;
    /**
     * Insert a node asynchronously using RFC-044 Command Ring (zero-blocking).
     *
     * @returns The NODE pointer (byte offset) in Zone B, or negative error code
     */
    insertAsync(opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean, sourceId: number, afterSourceId?: number, expressionId?: number): number;
    /**
     * Insert a note immediately (bypasses debounce). TEST-ONLY.
     *
     * ISSUE-024: Renamed from insertNoteImmediate to _insertNoteImmediate
     * to remove from public API. Use insertAsync() for production code.
     *
     * @internal Test-only synchronous insert for deterministic assertions.
     */
    _insertNoteImmediate(note: EditorNoteData, afterSourceId?: number): number;
    /**
     * Delete a note immediately (synchronous via command ring).
     *
     * RFC-045-FINAL: Routes through command ring + processCommands for immediate effect.
     * RFC-045 Disconnect Protocol: Automatically disconnects all incoming
     * and outgoing synapses before deleting the node.
     *
     * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
     */
    deleteNoteImmediate(sourceId: number): number;
    /**
     * Patch an attribute directly (no command ring, immediate effect).
     *
     * Attribute patches are atomic and do not require structural synchronization.
     * This method is safe to call from the Main Thread without going through
     * the Command Ring.
     *
     * @param sourceId - Source ID of the note to patch
     * @param type - Attribute type to patch (pitch, velocity, duration, baseTick, muted)
     * @param value - New value for the attribute
     * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
     */
    patchDirect(sourceId: number, type: PatchType, value: number | boolean): number;
    /**
     * Advance the internal tick counter and flush any due debounced operations.
     * Call this from an external frame loop (e.g., requestAnimationFrame wrapper).
     */
    tick(): void;
    /**
     * Queue an attribute patch with debouncing.
     * RFC-045-06: Implements coalescing - updates existing pending patch if found.
     */
    patchDebounced(sourceId: number, type: PatchType, value: number | boolean): void;
    /**
     * Queue a structural insert with debouncing.
     *
     * @returns The pre-assigned sourceId for tracking
     */
    insertNoteDebounced(pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean, afterSourceId?: number): number;
    /**
     * Queue a structural delete with debouncing.
     */
    deleteNoteDebounced(sourceId: number): void;
    /**
     * Flush all pending attribute patches.
     */
    flushPatches(): void;
    /**
     * Flush all pending structural edits.
     */
    flushStructural(): void;
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
    loadNotesFromArrays(pitches: Int32Array, velocities: Int32Array, durations: Int32Array, baseTicks: Int32Array, flags: Int8Array, count: number, outSourceIds: Int32Array): number;
    /**
     * Load notes from EditorNoteData array.
     *
     * RFC-045-FINAL: Uses command ring + processCommands for synchronous loading.
     *
     * @param notes - Array of EditorNoteData objects
     * @param outSourceIds - Pre-allocated output array (REQUIRED for zero-allocation)
     * @returns Number of notes loaded (when outSourceIds provided), or array (kernel mode)
     *
     * ISSUE-024: outSourceIds is now REQUIRED (kernel allocating path deleted).
     *
     * @param notes - Array of notes to load
     * @param outSourceIds - Pre-allocated Int32Array to receive source IDs
     * @returns Number of notes loaded
     */
    loadClip(notes: EditorNoteData[], outSourceIds: Int32Array): number;
    /**
     * Zero-allocation loadClip implementation.
     * @internal
     */
    private _loadClipZeroAlloc;
    /**
     * Clear all notes and mappings.
     *
     * RFC-045-FINAL: Routes through command ring + processCommands for synchronous clear.
     */
    clear(): void;
    /**
     * Prototype method for readNode callback (bound in constructor).
     * @internal
     */
    private _handleReadNoteNode;
    /**
     * Read note data by SOURCE_ID with zero-allocation callback pattern.
     *
     * @param sourceId - Source ID to read
     * @param cb - Callback receiving note data as primitive arguments
     * @returns true if read succeeded, false if not found
     */
    readNote(sourceId: number, cb: (pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void): boolean;
    /**
     * Prototype method for traverse callback (bound in constructor).
     * @internal
     */
    private _handleTraverseNode;
    /**
     * Prototype method for getSourceId callback (bound in constructor).
     * @internal
     */
    private _handleGetSourceIdNode;
    /**
     * Prototype method for getSourceLocation callback (bound in constructor).
     * @internal
     */
    private _handleGetSourceLocationLookup;
    /**
     * Prototype method for traverseSourceIds callback (bound in constructor).
     * @internal
     */
    private _handleTraverseSourceIdsNode;
    /**
     * Traverse all notes in chain order with zero-allocation callback pattern.
     *
     * @param cb - Callback receiving note data as primitive arguments
     */
    traverseNotes(cb: (sourceId: number, pitch: number, velocity: number, duration: number, baseTick: number, muted: boolean) => void): void;
    /**
     * Get pending patch count.
     */
    getPendingPatchCount(): number;
    /**
     * Get pending structural edit count.
     */
    getPendingStructuralCount(): number;
    /**
     * Check if there are pending operations.
     */
    hasPending(): boolean;
    /**
     * Hard reset the entire system (RFC-044 Resilience).
     */
    hardReset(): void;
    /**
     * Get Zone B statistics (RFC-044 Telemetry).
     */
    getZoneBStats(): {
        usage: number;
        freeNodes: number;
    };
    /**
     * Get the underlying Silicon Linker (MMU).
     *
     * @returns The SiliconSynapse instance managing the SAB
     *
     * @remarks
     * Use this to access low-level linker operations. For most use cases,
     * prefer the Bridge's high-level API which handles Identity Table
     * registration and error handling.
     */
    getLinker(): SiliconSynapse;
    /**
     * Create a synaptic connection between two clips (RFC-045 §6.2).
     *
     * @param sourceId - SOURCE_ID of the trigger node (end of clip)
     * @param targetId - SOURCE_ID of the destination node (start of next clip)
     * @param options - Optional weight (0-1000) and jitter (0-65535)
     * @returns The SynapsePtr on success, or negative error code
     */
    connect(sourceId: number, targetId: number, options?: SynapseOptions): SynapsePtr;
    /**
     * Remove a synaptic connection (RFC-045 §6.1).
     *
     * Sets TARGET_PTR to NULL_PTR (tombstone), making the synapse inactive.
     *
     * @param sourceId - SOURCE_ID of the trigger node
     * @param targetId - SOURCE_ID of the destination node
     * @returns BRIDGE_ERR.OK on success, BRIDGE_ERR.NOT_FOUND if not found
     */
    disconnect(sourceId: number, targetId?: number): number;
    /**
     * Compact the synapse table by rehashing all live entries.
     * COLD PATH - O(n) where n = table capacity.
     *
     * **Thread Safety:** Must NOT be called while audio thread is active.
     * Caller must ensure exclusive access (e.g., during pause or clear).
     *
     * Use this for explicit compaction control. Automatic compaction
     * is triggered by maybeCompact() after delete operations when
     * tombstone ratio exceeds threshold.
     *
     * @returns Number of entries compacted
     */
    compactSynapses(): number;
    /**
     * Disconnect all synapses FROM a source pointer. COLD PATH.
     * O(n) table scan. Zero allocations.
     */
    private disconnectAllFromSource;
    /**
     * Disconnect all synapses TO a target pointer using Reverse Index (ISSUE-016).
     *
     * **Performance:** O(k) where k = number of synapses pointing to this target.
     * Uses the Reverse Index hash table instead of O(65536) full table scan.
     *
     * @internal COLD PATH - Zero allocations.
     * @param targetPtr - The target node pointer to disconnect from
     * @returns Number of synapses tombstoned
     */
    private disconnectAllToTarget;
    /**
     * Record a fired synapse for plasticity reward distribution.
     */
    recordFiredSynapse(synapsePtr: SynapsePtr): void;
    /**
     * Apply reward to recently fired synapses (RFC-045 §5.1 Weight-Hardening).
     */
    reward(multiplier?: number): void;
    /**
     * Apply penalty to recently fired synapses (inverse of reward).
     */
    penalize(multiplier?: number): void;
    /**
     * Set the learning rate for plasticity (RFC-045 §5.1).
     */
    setLearningRate(rate: number): void;
    /**
     * Get the current learning rate.
     */
    getLearningRate(): number;
    /**
     * Get synapse table statistics (RFC-045 Telemetry).
     */
    getSynapseStats(): {
        loadFactor: number;
        usedSlots: number;
        capacity: number;
    };
    /**
     * Prototype method for snapshot entry callback (bound in constructor).
     * @internal
     */
    private _handleSnapshotEntry;
    /**
     * Stream brain state to callbacks. COLD PATH.
     *
     * CALLER MUST provide pre-bound functions, NOT inline arrows.
     *
     * @param onSynapse - Pre-bound callback for each synapse
     * @param onComplete - Pre-bound callback when done
     */
    snapshotStream(onSynapse: (sourceId: number, targetId: number, weight: number, jitter: number) => void, onComplete: (count: number) => void): void;
    /**
     * Snapshot brain state to pre-allocated TypedArrays. COLD PATH.
     * RFC-045-04: Zero-allocation alternative to BrainSnapshot.
     *
     * Fills the provided BrainSnapshotArrays with synapse data.
     * All arrays must be pre-allocated by caller.
     *
     * @param out - Pre-allocated BrainSnapshotArrays structure
     * @returns Number of synapses captured (also stored in out.count)
     */
    snapshotToArrays(out: BrainSnapshotArrays): number;
    /**
     * Restore synapses from parallel TypedArrays. COLD PATH.
     *
     * @returns Number of synapses restored
     */
    restoreFromArrays(sourceIds: Int32Array, targetIds: Int32Array, weights: Int32Array, jitters: Int32Array, count: number): number;
    /**
     * Get the underlying Synapse Allocator (RFC-045 Neural Graph).
     *
     * @returns The SynapseAllocator instance managing synaptic connections
     *
     * @remarks
     * Use this to access low-level synapse operations including:
     * - Direct connect/disconnect without SOURCE_ID resolution
     * - Compaction control via `compactTable()` and `maybeCompact()`
     * - Load factor and tombstone ratio monitoring
     *
     * For most use cases, prefer the Bridge's high-level API (`connect()`,
     * `disconnect()`, `compactSynapses()`) which handles Identity Table
     * lookups and error handling.
     *
     * @example
     * ```typescript
     * const allocator = bridge.getSynapseAllocator()
     * const loadFactor = allocator.getLoadFactor()
     * if (loadFactor > 0.7) {
     *   allocator.maybeCompact()
     * }
     * ```
     */
    getSynapseAllocator(): SynapseAllocator;
    /**
     * Set the system tempo (BPM).
     */
    setBpm(bpm: number): void;
    /**
     * Get the system tempo (BPM).
     */
    getBpm(): number;
    /**
     * Get the current playhead position in ticks.
     */
    getPlayheadTick(): number;
}
/**
 * Create a SiliconBridge with a new linker.
 */
export declare function createSiliconBridge(options?: SiliconBridgeOptions & {
    nodeCapacity?: number;
    safeZoneTicks?: number;
}): SiliconBridge;
//# sourceMappingURL=silicon-bridge.d.ts.map