import type { NodePtr, LinkerConfig, ISiliconLinker } from './types';
/**
 * Silicon Linker - Memory Management Unit for Direct-to-Silicon Mirroring.
 *
 * This class acts as the sole authority for memory allocation and pointer
 * manipulation within the SharedArrayBuffer. It implements:
 *
 * - Lock-free free list for node allocation/deallocation
 * - Immediate attribute patching (<0.001ms)
 * - Structural splicing with safe zone enforcement
 * - COMMIT_FLAG protocol for consumer synchronization
 *
 * Thread safety model:
 * - Silicon Linker runs in a dedicated Web Worker
 * - AudioWorklet consumer reads from SAB
 * - All shared state accessed via Atomics
 */
export declare class SiliconSynapse implements ISiliconLinker {
    private sab;
    private sab64;
    private buffer;
    private freeList;
    private patcher;
    private ringBuffer;
    private heapStartI32;
    private nodeCapacity;
    private commandBuffer;
    private isAudioContext;
    /**
     * Create a new Silicon Linker.
     *
     * @param buffer - Initialized SharedArrayBuffer (use createLinkerSAB)
     */
    constructor(buffer: SharedArrayBuffer);
    /**
     * Create a Silicon Linker with a new SAB.
     *
     * @param config - Optional configuration
     * @returns New SiliconSynapse instance
     */
    static create(config?: LinkerConfig): SiliconSynapse;
    /**
     * Set execution context for mutex behavior (RFC-045-04).
     *
     * **CRITICAL:** Call `setAudioContext(true)` from AudioWorklet.process() entry
     * to enable audio-safe try-lock behavior. Call `setAudioContext(false)` on exit.
     *
     * **Audio Context Behavior:**
     * - Maximum 3 CAS attempts (~300ns)
     * - Immediate return false on contention (no blocking)
     * - No kernel panic (contention is acceptable, retry next block)
     *
     * **Main Thread Behavior:**
     * - Full spin-wait with yield (up to 200 iterations with 1ms yields)
     * - Kernel panic on exhaustion (deadlock detected)
     *
     * @param isAudio - true if called from AudioWorklet context
     */
    setAudioContext(isAudio: boolean): void;
    /**
     * Get current execution context flag.
     *
     * @returns true if currently in audio context, false otherwise
     *
     * @remarks
     * This flag controls mutex behavior:
     * - `true`: Audio-safe mode (max 3 spins, no yield, no panic)
     * - `false`: Main thread mode (full spin-wait with yield)
     *
     * @see setAudioContext - Set the context flag
     * @see poll - Automatically manages context for audio thread
     */
    getAudioContext(): boolean;
    /**
     * Zero-allocation CPU yield for worker context.
     *
     * Uses Atomics.wait() with 1ms timeout to sleep without allocating memory.
     * RFC-045-04: No try/catch - we detect Worker context via typeof check.
     *
     * @remarks
     * This is a synchronous sleep that doesn't create Promise garbage.
     * The 1ms timeout allows other threads to acquire the mutex.
     * On main thread (rare), Atomics.wait returns "not-equal" - no throw.
     */
    private _yieldToCPU;
    /**
     * Increment 64-bit telemetry counter with proper carry handling (RFC-044 Decree 044-09).
     *
     * Atomically increments the 64-bit operation counter stored across
     * TELEMETRY_OPS_LOW and TELEMETRY_OPS_HIGH registers.
     *
     * **Carry Protocol**:
     * 1. Increment LOW register atomically
     * 2. If LOW register wrapped to 0, increment HIGH register
     * 3. Race condition on wrap is acceptable (undercounting by 1 is tolerable)
     *
     * **Performance**: Single-threaded increment is ~2ns, contended case is ~50ns.
     */
    private _incrementTelemetry;
    /**
     * Context-aware mutex acquisition (RFC-045-04 ISSUE-001).
     *
     * **Audio Context** (isAudioContext = true):
     * - Maximum AUDIO_SAFE_MAX_SPINS (3) CAS attempts (~300ns total)
     * - Immediate return false on contention (no blocking)
     * - No kernel panic (contention is acceptable, retry next audio block)
     *
     * **Main Thread Context** (isAudioContext = false):
     * - Full spin-wait with yield (up to MUTEX_PANIC_THRESHOLD × YIELD_AFTER_SPINS)
     * - Kernel panic on exhaustion (deadlock detected, sets ERROR_FLAG)
     *
     * @returns true if acquired, false if contention (audio) or deadlock (main)
     */
    private _acquireChainMutex;
    /**
     * Release the Chain Mutex.
     *
     * This must ALWAYS be called after acquiring the mutex, even if an error occurs.
     * Use try-finally pattern to ensure release.
     */
    private _releaseChainMutex;
    /**
     * Link an existing node into the chain after a given node (RFC-044).
     *
     * **CRITICAL:** This method assumes:
     * - Chain Mutex is already acquired by caller
     * - Node data is already written to SAB
     * - newPtr points to a valid, initialized node
     * - afterPtr points to a valid node in the chain
     *
     * This is the extracted linking logic from insertNode(), used by both
     * the old insertNode() method and the new RFC-044 executeInsert().
     *
     * @param newPtr - Pointer to node to link (already allocated and written)
     * @param afterPtr - Pointer to node to insert after
     */
    private _linkNode;
    /**
     * Link an existing node at the head of the chain (RFC-044).
     *
     * **CRITICAL:** This method assumes:
     * - Chain Mutex is already acquired by caller
     * - Node data is already written to SAB
     * - newPtr points to a valid, initialized node
     *
     * This is the extracted linking logic from insertHead(), used by both
     * the old insertHead() method and the new RFC-044 executeInsert().
     *
     * @param newPtr - Pointer to node to link (already allocated and written)
     */
    private _linkHead;
    /**
     * Allocate a node from the free list.
     *
     * @returns Node pointer, or NULL_PTR if heap exhausted
     */
    allocNode(): NodePtr;
    /**
     * Return a node to the free list.
     *
     * @param ptr - Node to free
     */
    freeNode(ptr: NodePtr): void;
    patchPitch(ptr: NodePtr, pitch: number): void;
    patchVelocity(ptr: NodePtr, velocity: number): void;
    patchDuration(ptr: NodePtr, duration: number): void;
    patchBaseTick(ptr: NodePtr, baseTick: number): void;
    patchMuted(ptr: NodePtr, muted: boolean): void;
    /**
     * Convert byte pointer to i32 index.
     */
    private nodeOffset;
    /**
     * Check if a pointer is within safe zone of playhead.
     * RFC-045-04: Returns false if violation, true if safe (no throw).
     */
    private checkSafeZone;
    /**
     * Write node data to a node offset.
     */
    private writeNodeData;
    /**
     * Insert a new node after the given node.
     *
     * The Atomic Order of Operations (RFC-043 §7.4.2):
     * 1. Check safe zone
     * 2. Allocate NoteX from Free List
     * 3. Write all attributes to NoteX
     * 4. Link Future: NoteX.NEXT_PTR = NoteB, NoteX.PREV_PTR = NoteA
     * 5. Update NoteB.PREV_PTR = NoteX (if NoteB exists)
     * 6. Atomic Splice: NoteA.NEXT_PTR = NoteX
     * 7. Signal COMMIT_FLAG
     *
     * RFC-045-04: Returns NULL_PTR on error (check ERROR_FLAG for details).
     *
     * @param afterPtr - Node to insert after
     * @param opcode - Node opcode
     * @param pitch - MIDI pitch
     * @param velocity - MIDI velocity
     * @param duration - Duration in ticks
     * @param baseTick - Base tick
     * @param sourceId - Source ID
     * @param flags - Initial flags
     * @returns Pointer to new node, or NULL_PTR on error
     */
    private _insertNode;
    /**
     * Insert a new node at the head of the chain.
     *
     * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
     *
     * RFC-045-04: Returns NULL_PTR on error (check ERROR_FLAG for details).
     *
     * @param opcode - Node opcode
     * @param pitch - MIDI pitch
     * @param velocity - MIDI velocity
     * @param duration - Duration in ticks
     * @param baseTick - Base tick
     * @param sourceId - Source ID
     * @param flags - Initial flags
     * @returns Pointer to new node, or NULL_PTR on error
     */
    private _insertHead;
    /**
     * Delete a node from the chain.
     *
     * Uses Chain Mutex (v1.5) to protect structural mutations from concurrent workers.
     * O(1) deletion using PREV_PTR (doubly-linked list).
     *
     * RFC-045-04: Returns boolean instead of throwing (check ERROR_FLAG for details).
     *
     * @param ptr - Node to delete
     * @returns true if deleted, false on error
     */
    private _deleteNode;
    /**
     * Read node data at pointer with zero-allocation callback pattern.
     *
     * This method implements the versioned-read loop (v1.5) INTERNALLY using
     * local stack variables to prevent torn reads during concurrent attribute
     * mutations. NO object allocations occur during this read.
     *
     * **Zero-Alloc, Audio-Realtime**: Returns false if contention detected (>50 spins).
     * Caller must handle false return gracefully by skipping processing for one frame.
     *
     * CRITICAL: Callback function must be pre-bound/hoisted to avoid allocations.
     * DO NOT pass inline arrow functions - they allocate objects.
     *
     * RFC-045-04: Returns false instead of throwing for NULL_PTR.
     *
     * @param ptr - Node byte pointer
     * @param cb - Callback receiving node data as primitive arguments
     * @returns true if read succeeded, false if NULL_PTR or contention detected
     */
    readNode(ptr: NodePtr, cb: (ptr: number, opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, nextPtr: number, sourceId: number, flags: number, seq: number) => void): boolean;
    /**
     * Get head of chain.
     */
    getHead(): NodePtr;
    /**
     * Traverse all nodes in chain order with zero-allocation callback pattern.
     *
     * Uses versioned read loop (v1.5) to prevent torn reads during traversal.
     * All node data is passed directly to callback as stack variables - no objects created.
     *
     * **CRITICAL PERFORMANCE NOTE:** Consumers MUST hoist/pre-bind their callback function.
     * Passing inline arrow functions will allocate objects and defeat the Zero-Alloc purpose.
     *
     * **Contention Handling:** If a node read experiences contention, this method will retry
     * until a consistent read is obtained. Data integrity is prioritized over performance.
     * Safety bailout after 1,000 retries sets ERROR_FLAG and skips the node.
     *
     * RFC-045-04: Returns boolean - false if severe contention occurred.
     *
     * @param cb - Callback function receiving node data as primitive arguments
     * @returns true if all nodes traversed, false if contention bailout occurred
     */
    traverse(cb: (ptr: number, opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, flags: number, sourceId: number, seq: number) => void): boolean;
    /**
     * Set active groove template.
     */
    setGroove(ptr: NodePtr, length: number): void;
    /**
     * Disable groove.
     */
    clearGroove(): void;
    /**
     * Set humanization parameters.
     */
    setHumanize(timingPpt: number, velocityPpt: number): void;
    /**
     * Set global transposition.
     */
    setTranspose(semitones: number): void;
    /**
     * Set global velocity multiplier.
     */
    setVelocityMult(ppt: number): void;
    /**
     * Set PRNG seed for humanization.
     */
    setPrngSeed(seed: number): void;
    /**
     * Set BPM (can be updated live).
     *
     * BPM affects timing calculations for the audio thread.
     * Changes take effect immediately via atomic store.
     *
     * @param bpm - Beats per minute (positive integer)
     */
    setBpm(bpm: number): void;
    /**
     * Get current BPM (beats per minute).
     *
     * @returns Current BPM value (default: 120)
     *
     * @remarks
     * Thread-safe read via `Atomics.load`.
     */
    getBpm(): number;
    /**
     * Update the playhead position (for UI visualization).
     *
     * @param tick - Current playback tick
     */
    setPlayheadTick(tick: number): void;
    /**
     * Get PPQ (Pulses Per Quarter note / ticks per beat).
     *
     * PPQ determines the resolution of timing in the system.
     * Higher values allow finer timing precision.
     *
     * @returns PPQ value (default: 480)
     *
     * @remarks
     * PPQ is set at SAB creation and is immutable.
     * Non-atomic read is safe since PPQ never changes.
     */
    getPpq(): number;
    /**
     * Get current error flag value from the SAB.
     *
     * Error codes are defined in `constants.ts` under the `ERROR` constant.
     * Common values:
     * - `ERROR.OK` (0): No error
     * - `ERROR.HEAP_EXHAUSTED` (1): Free list depleted
     * - `ERROR.SAFE_ZONE` (2): Edit within safe zone rejected
     * - `ERROR.INVALID_PTR` (3): Invalid pointer operation
     * - `ERROR.KERNEL_PANIC` (4): Deadlock or severe contention
     * - `ERROR.LOAD_FACTOR_WARNING` (5): Identity Table >75% full
     * - `ERROR.FREE_LIST_CORRUPT` (6): Free list corruption detected
     * - `ERROR.UNKNOWN_OPCODE` (7): Unknown command opcode
     *
     * @returns The current error code (0 = no error)
     *
     * @remarks
     * Error flags are set atomically by operations that encounter errors.
     * Check this value after operations that can fail to determine the cause.
     * Call `clearError()` after handling to reset the flag.
     */
    getError(): number;
    /**
     * Clear the error flag (reset to ERROR.OK).
     *
     * Call this after handling an error condition to reset the flag.
     * Failure to clear can mask subsequent errors.
     *
     * @remarks
     * Uses `Atomics.store` for thread-safe clearing.
     */
    clearError(): void;
    /**
     * Get the number of nodes currently linked in the chain.
     *
     * This count represents active nodes in the linked list, not total
     * allocations. Nodes are counted when linked (INSERT) and uncounted
     * when unlinked (DELETE).
     *
     * @returns Number of nodes in the chain (0 to nodeCapacity)
     *
     * @remarks
     * Thread-safe read via `Atomics.load`.
     */
    getNodeCount(): number;
    /**
     * Get the number of nodes available in the Zone A free list.
     *
     * This represents nodes that can be allocated via `allocNode()`.
     * When this reaches 0, `allocNode()` returns NULL_PTR.
     *
     * @returns Number of free nodes available
     *
     * @remarks
     * Thread-safe read via `Atomics.load`.
     * Note: Zone B (local allocator) has a separate free pool.
     */
    getFreeCount(): number;
    /**
     * Get the total node capacity configured for this linker.
     *
     * This is the maximum number of nodes that can exist simultaneously.
     * Configured at SAB creation time via `LinkerConfig.nodeCapacity`.
     *
     * @returns Maximum node capacity (default: 4096)
     */
    getNodeCapacity(): number;
    /**
     * Get the underlying SharedArrayBuffer for direct access.
     *
     * @returns The SharedArrayBuffer backing this linker
     *
     * @remarks
     * Use this for:
     * - Passing the SAB to an AudioWorklet
     * - Creating additional views (Float32Array, BigInt64Array)
     * - Debug inspection of raw memory
     *
     * **Warning:** Direct manipulation can corrupt linker state.
     * Prefer using linker methods for all operations.
     */
    getSAB(): SharedArrayBuffer;
    /**
     * Reset the entire Linker state (RFC-044 Resilience).
     *
     * **DANGER:** This nukes all memory state:
     * - Clears all nodes and resets chain to empty
     * - Reinitializes Zone A free list (Zone B left untouched)
     * - Clears Identity and Symbol tables
     * - Resets Ring Buffer headers
     * - Clears error flags
     * - Wakes blocked Worker threads via Atomics.notify
     *
     * **Thread Safety:**
     * NOT thread-safe. Only call when no other threads are accessing the SAB.
     * Typically used during app initialization or after detecting a stale SAB.
     *
     * **Use Cases:**
     * - Page reload detected (SAB persists but app state is fresh)
     * - Zone B exhaustion recovery
     * - Error recovery after KERNEL_PANIC
     *
     * After calling reset(), the SiliconBridge must also call
     * `localAllocator.reset()` to reset Zone B bump pointer.
     */
    reset(): void;
    /**
     * Get current playhead tick position (set by AudioWorklet).
     *
     * The playhead represents the current position in the audio timeline.
     * It is updated atomically by the AudioWorklet during playback.
     *
     * @returns Current playhead position in ticks
     *
     * @remarks
     * Thread-safe read via `Atomics.load`.
     * Used for safe zone calculations to prevent edits near playhead.
     */
    getPlayheadTick(): number;
    /**
     * Get safe zone size in ticks.
     *
     * The safe zone is a protected region around the playhead where
     * structural edits (INSERT/DELETE) are rejected to prevent audio
     * glitches. Edits within `playhead + safeZoneTicks` are blocked.
     *
     * @returns Safe zone size in ticks (default: 960 = 2 beats at 480 PPQ)
     *
     * @remarks
     * Safe zone is set at SAB creation and is immutable.
     * Non-atomic read is safe since value never changes.
     */
    getSafeZoneTicks(): number;
    /**
     * Compute hash slot for a sourceId using Knuth's multiplicative hash.
     *
     * **Bitwise Optimization**: Uses `& (capacity - 1)` instead of `% capacity`
     * since DEFAULT_CAPACITY is 4096 (power of 2). This eliminates expensive
     * modulo division on the hot path.
     *
     * @param sourceId - The source ID to hash
     * @returns Slot index in the Identity Table
     */
    private idTableHash;
    /**
     * Get the i32 offset for a slot in the Identity Table.
     * Each slot is 2 × i32: [TID, NodePtr]
     */
    private idTableSlotOffset;
    /**
   * Insert a sourceId → NodePtr mapping into the Identity Table.
   * Uses quadratic probing for collision resolution (RFC-047-50).
   *
   * **Atomic Strictness**: All slot reads/writes use Atomics for thread safety.
   * **Load Factor Enforcement**: Sets ERROR_FLAG if load factor exceeds 75%.
   *
   * @param sourceId - Source ID (must be > 0)
   * @param ptr - Node pointer
   * @returns true if inserted, false if table full
   */
    idTableInsert(sourceId: number, ptr: NodePtr): boolean;
    /**
     * Lookup a NodePtr by sourceId in the Identity Table.
     * Uses quadratic probing for collision resolution (RFC-047-50).
     *
     * **Atomic Strictness**: All slot reads use Atomics for thread safety.
     *
     * @param sourceId - Source ID to lookup
     * @returns NodePtr if found, NULL_PTR if not found
     */
    idTableLookup(sourceId: number): NodePtr;
    /**
     * Remove a sourceId from the Identity Table.
     * Marks the slot as a tombstone (TID = -1).
     * Uses quadratic probing for collision resolution (RFC-047-50).
     *
     * **Atomic Strictness**: All slot reads/writes use Atomics for thread safety.
     *
     * NOTE: Tombstones accumulate over time and degrade lookup performance.
     * Call idTableRepack() during bridge.clear() to eliminate tombstones.
     *
     * @param sourceId - Source ID to remove
     * @returns true if removed, false if not found
     */
    idTableRemove(sourceId: number): boolean;
    /**
     * Clear the entire Identity Table (memset-style).
     * Sets all slots to EMPTY_TID (0).
     *
     * **Atomic Strictness**: All writes use Atomics for thread safety.
     * This also eliminates all tombstones (effective re-pack).
     */
    idTableClear(): void;
    /**
     * Get the i32 offset for a slot in the Symbol Table.
     * Each slot is 2 × i32: [fileHash, lineCol]
     */
    private symTableSlotOffset;
    /**
     * Store a packed SourceLocation in the Symbol Table for a sourceId.
     * Uses the same linear probing as Identity Table to find the slot.
     *
     * **Race-Free Write Order**: This method can be called BEFORE idTableInsert
     * to prevent transient states where Identity Table has an entry but Symbol
     * Table doesn't. It finds the slot independently using the same hash/probe logic.
     *
     * @param sourceId - Source ID
     * @param fileHash - Hash of the file path
     * @param line - Line number (0-65535)
     * @param column - Column number (0-65535)
     * @returns true if stored, false if table full
     */
    symTableStore(sourceId: number, fileHash: number, line: number, column: number): boolean;
    /**
     * Lookup a packed SourceLocation by sourceId with zero-allocation callback.
     * Uses the same linear probing as Identity Table.
     *
     * @param sourceId - Source ID to lookup
     * @param cb - Callback receiving (fileHash, line, column) if found
     * @returns true if found and callback invoked, false if not found
     */
    symTableLookup(sourceId: number, cb: (fileHash: number, line: number, column: number) => void): boolean;
    /**
     * Remove a SourceLocation from the Symbol Table.
     * Clears the entry at the slot corresponding to sourceId.
     *
     * @param sourceId - Source ID whose location should be removed
     * @returns true if removed, false if not found
     */
    symTableRemove(sourceId: number): boolean;
    /**
     * Clear the entire Symbol Table (memset-style).
     * Sets all entries to EMPTY_ENTRY (0).
     */
    symTableClear(): void;
    /**
     * Clear the entire Synapse Table (memset-style).
     * Sets all SOURCE_PTR fields to NULL_PTR, effectively tombstoning all synapses.
     *
     * **Performance:** O(n) where n = SYNAPSE_TABLE.MAX_CAPACITY (65536).
     * Approximately 260KB of memory touched. ~1ms on modern hardware.
     *
     * **Thread Safety:** Must be called with Chain Mutex held.
     */
    private synapseTableClear;
    /**
     * Process pending commands from the Ring Buffer (RFC-044).
     *
     * This is the "Read Path" of the RFC-044 protocol. The Worker dequeues
     * commands written by the Main Thread and executes them asynchronously.
     *
     * **Hybrid Trigger:**
     * - Passive: Called by AudioWorklet at start of process() (polling)
     * - Active: Worker wakes via Atomics.wait() on YIELD_SLOT
     *
     * **Performance:**
     * - Processes max 256 commands per call to prevent audio starvation
     * - Each command: ~1-2µs (linking only, allocation already done)
     *
     * @returns Number of commands processed
     */
    processCommands(): number;
    /**
     * Execute INSERT command: Link a floating node into the chain (RFC-044).
     *
     * **Protocol:**
     * - ptr: Byte offset to node (already allocated in Zone B and written)
     * - prevPtr: Byte offset to insert after (NULL_PTR = head insert)
     *
     * **Steps:**
     * 1. Acquire Chain Mutex
     * 2. Validate pointers
     * 3. Link node using _linkNode or _linkHead
     * 4. Update Identity Table
     * 5. Release mutex
     *
     * RFC-045-04: Returns boolean instead of throwing.
     *
     * @param ptr - Pointer to node to link (Zone B)
     * @param prevPtr - Pointer to insert after (or NULL_PTR for head)
     * @returns true on success, false on error (ERROR_FLAG set)
     */
    private executeInsert;
    /**
     * Execute DELETE command: Remove a node from the chain (RFC-044).
     *
     * **Note:** This uses the existing _deleteNode() method which already
     * handles mutex acquisition and Identity Table cleanup.
     *
     * RFC-045-04: Returns boolean (no try/catch).
     *
     * @param ptr - Pointer to node to delete
     * @returns true on success, false on error
     */
    private executeDelete;
    /**
     * Execute CLEAR command: Remove all nodes from the chain (RFC-044).
     *
     * RFC-045-04: Returns boolean instead of using try/finally.
     *
     * **Implementation:** Uses while-head deletion loop (zero-alloc).
     *
     * @returns true on success, false on mutex error
     */
    private executeClear;
    /**
     * Poll for pending commands (passive trigger for AudioWorklet).
     *
     * This is the primary entry point for consuming Ring Buffer commands
     * from the audio thread. It automatically enables audio-safe mutex
     * behavior (RFC-045-04 ISSUE-001) to prevent blocking.
     *
     * **Audio Thread Safety:**
     * - Sets `isAudioContext = true` before processing
     * - Mutex uses maximum 3 CAS spins (~300ns), no yield
     * - Immediate return on contention (no blocking)
     * - Restores `isAudioContext = false` after processing
     *
     * **Performance:**
     * - Processes max 256 commands per call to prevent audio starvation
     * - Each command: ~1-2us (linking only, allocation done by Main Thread)
     * - Zero allocations
     *
     * @returns Number of commands processed (0-256)
     *
     * @example
     * ```typescript
     * // In AudioWorklet.process()
     * process(inputs, outputs, parameters) {
     *   const processed = this.linker.poll()
     *   // Now process audio using the updated chain
     *   return true
     * }
     * ```
     *
     * @see processCommands - Lower-level API without audio context handling
     * @see setAudioContext - Manual context control for advanced use cases
     */
    poll(): number;
    /**
     * Insert a node at head (test helper - routes through command ring).
     *
     * @internal This method is for test compatibility only. Production code
     * should use the Bridge's insertAsync() method.
     */
    insertHead(opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, sourceId: number, flags: number): NodePtr;
    /**
     * Insert a node after another (test helper - routes through command ring).
     *
     * @internal This method is for test compatibility only.
     */
    insertNode(afterPtr: NodePtr, opcode: number, pitch: number, velocity: number, duration: number, baseTick: number, sourceId: number, flags: number): NodePtr;
    /**
     * Delete a node (test helper - routes through command ring).
     *
     * @internal This method is for test compatibility only.
     */
    deleteNode(ptr: NodePtr): boolean;
}
//# sourceMappingURL=silicon-synapse.d.ts.map