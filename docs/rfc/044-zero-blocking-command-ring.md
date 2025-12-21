# RFC-044: The Zero-Blocking Command Ring Architecture

| Metadata | Value |
| --- | --- |
| **Title** | **Zero-Blocking Command Ring Architecture** |
| **Status** | **RATIFIED** |
| **Target** | `packages/core/src/linker/` |
| **Goals** | Zero Allocations, Zero Main-Thread Blocking, Strict Synchronous Execution |
| **Depends On** | RFC-043 (Silicon Kernel) |

---

## 1. Executive Summary

The current concurrency model relies on **Synchronous Locking** (`syncAck`), which forces the Main Thread to spin-wait while the AudioWorklet acknowledges structural changes. This introduces an unavoidable latency floor (3-5ms) and CPU contention.

RFC-044 proposes a radical shift to a **"Local-Write, Remote-Link"** architecture.

1. **Partitioned Heap**: The `SharedArrayBuffer` is split into "Worker-Owned" and "UI-Owned" zones to allow lock-free allocation.
2. **Ring Buffer Command Queue**: Structural edits are queued as opcodes in a circular buffer, processed by the Kernel asynchronously.
3. **Direct Memory Access**: Data (Pitch, Velocity) is written directly to the heap by the UI thread without locking, as unlinked nodes are invisible to the Audio consumer.

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

| Zone | Index Range | Owner | allocator Strategy |
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

### 4.1. The Write Path (Main Thread / `LiveClipBuilder`)

When the user writes `.note(60, 100, 1)`:

1. **Local Allocation (0µs):**
* Main Thread pops an index from its **Local Free List** (Zone B).
* *Contention:* None. No atomic CAS loop required.
* Let's say we get Index `80005`.


2. **Direct Data Write (1µs):**
* Main Thread writes Pitch, Velocity, Duration, Flags directly to `SAB[80005]...`.
* *Safety:* Safe because Node `80005` is currently "Floating." The linked list does not point to it. The AudioWorklet cannot see it.


3. **Command Enqueue (0.5µs):**
* Main Thread writes to the Ring Buffer at `RB_TAIL`:
  `[ OP_INSERT, 80005 (Ptr), 70020 (PrevPtr), 0 ]`
* Main Thread performs `Atomics.add(RB_TAIL, 4)`.


4. **Completion:**
* Function returns. Total time: **~2µs**. UI is perfectly fluid.



### 4.2. The Read Path (Worker / `SiliconLinker`)

At the start of every process cycle (or triggered by `postMessage`):

1. **Check Ring:** Worker reads `RB_HEAD` and `RB_TAIL`.
2. **Process Loop:**
* Reads `[OP_INSERT, 80005, 70020]`.
* Acquires `CHAIN_MUTEX` (Local contention only).
* **The Splice:** Performs the pointer swap to link `70020 -> 80005`.
* Updates `Identity Table`.


3. **Commit:** Updates `RB_HEAD`.

---

## 5. Architectural Implications

### 5.1. Consistency Model

This introduces **Eventual Consistency** to the data structure topology.

* **Memory Consistency:** Immediate. If you have the pointer `80005`, you can read the data instantly.
* **Topology Consistency:** Deferred (Lag: < 16ms). If you traverse from `HEAD`, you won't see `80005` until the Worker processes the Ring Buffer.

**Verdict:** Acceptable for a Live Coding environment. The User Script is the "Source of Truth." The Audio Engine catches up within one frame.

### 5.2. Safety Mechanisms

1. **Buffer Overflow:** If `RB_TAIL` meets `RB_HEAD`, the Ring Buffer is full.
* *Strategy:* Throw `CommandQueueOverflowError`. (With 64KB, we can store 4,000 pending ops. If a user types 4,000 notes in 16ms, they are a robot).


2. **Zone Exhaustion:** If Zone B is full.
* *Strategy:* Trigger Defragmentation/Rebalancing (Offline operation).



---

## 6. Implementation Plan

### Phase 1: Memory & Allocators

1. Define `ZONE_SPLIT_INDEX` in `constants.ts`.
2. Implement `LocalFreeList` (Zone B) for Main Thread.
3. Implement `RingBuffer` logic (Atomic Head/Tail management).

### Phase 2: The Command Protocol

1. Define Opcodes: `INSERT`, `DELETE`, `PATCH` (Optional, usually direct), `CLEAR`.
2. Implement `LiveClipBuilder` to use `LocalFreeList` + `RingBuffer`.
3. Implement `SiliconLinker.processCommands()` method.

### Phase 3: Cleanup

1. Remove `syncAck` and `awaitAck`.
2. Remove `LinkerBatch` (replaced by Ring Buffer).

---

## 7. Architect's Note

This architecture mimics the command queues used in **Graphics Drivers (CPU -> GPU)**. The CPU prepares the data and pushes a draw call; the GPU consumes it asynchronously.

By treating the `AudioWorklet` as a "GPU for Sound" and the Main Thread as the "CPU," we align with the physical reality of the browser's threading model.

**Ratification Status:** READY FOR APPROVAL.
**Courage Level:** MAXIMUM.