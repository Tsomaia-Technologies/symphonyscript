# RFC-044: The Zero-Blocking Command Ring Architecture

| Metadata | Value |
| --- | --- |
| **Title** | **Zero-Blocking Command Ring Architecture** |
| **Status** | **RATIFIED (Revised)** |
| **Target** | `packages/core/src/linker/` |
| **Goals** | Zero Allocations, Zero Main-Thread Blocking, Strict Synchronous Execution |
| **Depends On** | RFC-043 (Silicon Kernel) |

---

## 1. Executive Summary

The current concurrency model relies on **Synchronous Locking** (`syncAck`), which forces the Main Thread to spin-wait while the AudioWorklet acknowledges structural changes. This introduces an unavoidable latency floor (3-5ms) and CPU contention.

RFC-044 proposes a radical shift to a **"Local-Write, Remote-Link"** architecture.

1. **Partitioned Heap**: The `SharedArrayBuffer` is split into "Worker-Owned" and "UI-Owned" zones to allow lock-free allocation.
2. **Ring Buffer Command Queue**: Structural edits are queued as opcodes in a circular buffer, processed by the Kernel asynchronously.
3. **Atomic Signaling**: The Main Thread wakes the Worker instantly using `Atomics.notify`, bypassing the browser's Event Loop latency.

**Result:** The `LiveClipBuilder` becomes strictly synchronous, allocates zero objects, and returns control to the editor in **microseconds** (< 5µs), regardless of Audio thread load.

---

## 2. The Physics Problem

In a shared memory system, two threads cannot touch the same pointer simultaneously without coordination (Locking).

* **The Old Way (Locking):** Thread A grabs Mutex. Thread B waits. Thread A writes. Thread A releases. Thread B continues.
* *Cost:* Thread B freezes.


* **The New Way (Queueing):** Thread A writes data to *private* memory. Thread A pushes a "Link This" command to a queue. Thread B reads queue and links it later.
* *Cost:* Zero freeze. Thread A finishes immediately.



---

## 3. Memory Layout Update

We partition the Node Heap (indices of the `Int32Array`) into two distinct zones to eliminate allocation contention.

### 3.1. The Heap Partitioning

Assuming a standard 4MB Heap (~130,000 nodes):

| Zone | Index Range | Owner | Allocator Strategy |
| --- | --- | --- | --- |
| **Zone A (Kernel)** | `0` to `65,535` | **Worker/Audio** | CAS-based Free List (Existing) |
| **Zone B (UI)** | `65,536` to `131,071` | **Main Thread** | Simple Stack / Bump Pointer (New) |

* **Zone A**: Used by the generative engine (Arpeggiators, Euclidean) running in the Worker.
* **Zone B**: Used by `LiveClipBuilder` running in the Main Thread.

### 3.2. The Command Ring Buffer

We allocate a reserved region (e.g., 64KB) in the SAB Header extension for a **Ring Buffer**.

**Structure:**

* `RB_HEAD` (Atomic Offset): Read position (Worker).
* `RB_TAIL` (Atomic Offset): Write position (Main Thread).
* `RB_DATA` (Int32 Array): The circular buffer.

**Command Stride:** Fixed 4 words (16 bytes) per command for alignment.

```
[ OPCODE, PARAM_1, PARAM_2, RESERVED ]

```

---

## 4. The "Local-Write, Remote-Link" Protocol

### 4.1. The Write Path (Main Thread / `SiliconBridge`)

When the user writes `.note(60, 100, 1)`:

1. **Local Allocation (0µs):**
* Main Thread pops an index from its **Local Free List** (Zone B).
* *Contention:* None. No atomic CAS loop required.


2. **Direct Data Write (1µs):**
* Main Thread writes Pitch, Velocity, Duration, Flags directly to `SAB[Ptr]...` (using `Atomics.store`).
* *Safety:* Safe because the node is currently "Floating." The linked list does not point to it. The AudioWorklet cannot see it.


3. **Command Enqueue (0.5µs):**
* Main Thread writes to the Ring Buffer at `RB_TAIL`: `[ OP_INSERT, Ptr, PrevPtr, 0 ]`.
* Main Thread performs `Atomics.add(RB_TAIL, 4)`.


4. **The Atomic Signal (0.1µs):**
* Main Thread calls `Atomics.notify(SAB, HDR.YIELD_SLOT, 1)`.
* *Physics:* This instantly wakes the Worker if it is parked on the Yield Slot, bypassing the Task Queue.



### 4.2. The Read Path (Worker / `SiliconLinker`)

1. **The Hybrid Trigger:**
* **Active (Immediate):** Worker wakes up via `Atomics.wait` on `HDR.YIELD_SLOT`.
* **Passive (Fallback):** Worker checks `RB_HEAD !== RB_TAIL` at the start of every audio quantum.


2. **The Process Loop:**
* Worker pulls the command from `RB_HEAD`.
* Worker acquires `CHAIN_MUTEX` (Local contention only).
* **The Splice:** Links the "floating" Zone B node into the master chain.
* **Identity Sync:** Updates the memory-resident Identity Table.


3. **Advance:** Worker updates `RB_HEAD` via `Atomics.store`.

---

## 5. Architectural Implications

### 5.1. Consistency Model

This introduces **Eventual Consistency** to the data structure topology.

* **Memory Consistency:** Immediate. If you have the pointer, you can read the data.
* **Topology Consistency:** Deferred (Lag: < 2.9ms). If you traverse from `HEAD`, you won't see the new node until the Worker processes the Ring.

### 5.2. Safety Mechanisms

1. **Buffer Overflow:** If `RB_TAIL` meets `RB_HEAD`, the Ring Buffer is full.
* *Strategy:* Throw `CommandQueueOverflowError`.


2. **Zone Exhaustion:** If Zone B is full.
* *Strategy:* Trigger Defragmentation/Rebalancing (Offline operation).



---

## 6. Implementation Plan

### Phase 1: Memory & Allocators

1. Define `ZONE_SPLIT_INDEX` and Ring Buffer offsets in `constants.ts`.
2. Implement `LocalFreeList` (Zone B) for Main Thread.
3. Implement `RingBuffer` logic (Atomic Head/Tail management).

### Phase 2: The Command Protocol

1. Define Opcodes: `INSERT`, `DELETE`, `PATCH`, `CLEAR`.
2. Implement `LiveClipBuilder` to use `LocalFreeList` + `RingBuffer` + `Atomics.notify`.
3. Implement `SiliconLinker.processCommands()` method (The Hybrid Trigger).

### Phase 3: Cleanup

1. Remove `syncAck` and `awaitAck`.
2. Remove legacy `pendingStructural` arrays from Bridge.

---

## 7. Architect's Note

This architecture treats the `AudioWorklet` as a "GPU for Sound." The Main Thread prepares data buffers and pushes a draw call (`Atomics.notify`); the Worker consumes it asynchronously. This aligns perfectly with the physical reality of the browser's threading model.

**Ratification Status:** FINAL.
**Courage Level:** MAXIMUM.

---

### Next Step: Phase 1 Execution

Here is the **Directive** to start the implementation.

**Title:** Directive 044-01: Memory Partitioning & Ring Buffer Offsets

**Task:**
Update `packages/core/src/linker/constants.ts` to support the RFC-044 memory layout.

**Requirements:**

1. **Define Zones:** Add `ZONE_SPLIT_INDEX`.
* Logic: `Math.floor(nodeCapacity / 2)`.


2. **Define Ring Buffer Header:** Add new offsets to `HDR` (using `RESERVED` slots or appending):
* `RB_HEAD`: Read Index.
* `RB_TAIL`: Write Index.
* `RB_CAPACITY`: Buffer Size (in commands).
* `COMMAND_RING_PTR`: Byte offset to start of buffer.


3. **Update Memory Calculation:** Update `calculateSABSize`.
* Add `RING_BUFFER_SIZE` (64KB default = 4096 commands × 16 bytes).
* Ensure proper 8-byte alignment for the region.


4. **Define Command Constants:**
* `COMMAND.STRIDE_BYTES = 16`
* `COMMAND.STRIDE_I32 = 4`



**Goal:** Establish the physical territory for the Command Ring.
