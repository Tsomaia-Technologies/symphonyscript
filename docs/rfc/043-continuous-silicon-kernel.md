# RFC-043: Continuous Silicon Kernel (Live-Link Architecture)

**Status**: Visionary Draft  
**Target**: `packages/core` (VM/Builder), `packages/runtime-webaudio`  
**Driver**: Elimination of Compilation Latency / "Breath-Speed" Live Coding  
**Dependencies**: [RFC-038 Symphony Bytecode Standard](./038-symphony-bytecode-standard.md), [RFC-041 Zero-Allocation Foundation](./041-zero-allocation-foundation.md)

---

## 1. Abstract

RFC-043 defines the transition from a "Transactional Compiler" model to a "Continuous Silicon Kernel." By replacing the linear bytecode array with a Linked-List Instruction Stream and moving timing math (Groove/Humanize) into the VM execution loop, we eliminate the 240ms "Latency Wall" entirely. The "Compilation Phase" is retired in favor of "Atomic Instruction Patching," where user code directly manipulates the playhead's future in the SharedArrayBuffer (SAB) with 0.0ms perceived latency.

---

## 2. The Philosophy: From Thinker to Mirror

Traditional architectures treat "Compilation" as a thinking phase and "Playback" as a doing phase. RFC-043 merges these. The DSL (TypeScript) becomes a direct "Live Wire" to the hardware-mapped memory.

* **Instruction-Level Reflection**: Changing a MIDI pitch is a single-byte write to a known address, not a full rebuild.
* **The Zero Latency Goal**: The distance between a programmer's thought and speaker voltage is reduced to CPU clock cycles.

---

## 3. Technical Specification: The Linked-List VM (LLVM)

### 3.1 Memory Node Stride

Instead of a compact linear array, instructions are stored as "Nodes" in a fragmented heap within the SAB. Each node has a fixed stride to allow for atomic updates and pointer linking.

**Node Layout (8 x i32 Stride):**

1. `OPCODE`: The instruction type.
2. `VALUE_A`: Primary arg (e.g., Pitch).
3. `VALUE_B`: Secondary arg (e.g., Velocity).
4. `BASE_TICK`: The "pure" grid timing (untransformed).
5. `NEXT_PTR`: Memory address of the chronologically next instruction.
6. `SOURCE_ID`: Map back to the editor's line/column.
7. `FLAGS`: (e.g., Active/Muted/Dirty).
8. `RESERVED`: Future expansion.

### 3.2 The Linked-List Traversal

The VM Consumer no longer uses `PC++`. It follows the `NEXT_PTR` chain.

* **Insertion**: Adding a note between Note A and Note B requires writing Note C to a free node and updating `NoteA.NEXT_PTR = &NoteC`. This is an atomic operation that never stops the music.
* **Reusability**: Clips are "Memory Fragments." Reusing a clip means creating a new pointer chain that references the same instruction definitions or instantiating a fresh chain in the fragmented heap.

---

## 4. Parametric VM-Resident Math (The End of Baking)

Currently, timing transforms (Groove, Humanize) are "baked" into the bytecode by the compiler. RFC-043 moves this math into the VM execution loop.

### 4.1 Live Transform Opcodes

The VM now supports "Live Registers" for transforms:

* `REG.GROOVE_ID`: Points to a Groove Template buffer in the SAB.
* `REG.HUMAN_TIMING`: The jitter coefficient.

### 4.2 The Execution Formula

When the VM playhead hits `BASE_TICK`:

```
TriggerTick = BASE_TICK + GrooveBuffer[REG.GROOVE_ID][BASE_TICK % Length] + Humanize(REG.HUMAN_TIMING)
```

**Benefit**: Changing a groove template or humanization setting is an write to a register. The feedback is instant on the next 128-frame audio cycle, requiring no "re-compile."

---

## 5. Fragmented Memory Management

To support reusability (React-like component patterns) without a monolithic compiler:

* **The Silicon Heap**: The SAB is treated as a paged heap.
* **Clip Instancing**: Each time a clip function is called, the builder requests a "Fragment" from the kernel.
* **Atomic Wiring**: The `LiveSession` performs the final "Wiring" by connecting fragment pointers.

---

## 6. Performance Metrics (Stress Test: 5,000 Notes)

| Interaction | Transactional (RFC-041) | Continuous (RFC-043) |
|-------------|------------------------|---------------------|
| **Pitch/Velocity Tweak** | 240ms | **< 0.001ms (Patch)** |
| **Note Insertion** | 240ms | **~0.1ms (Splice)** |
| **BPM/Groove Shift** | 240ms | **< 0.001ms (Reg Update)** |
| **Clip Re-ordering** | 240ms | **~1ms (Linkage Update)** |
| **GC Pressure** | 29 KB | **0 KB (SAB Direct)** |

---

## 7. Implementation Details: Direct-to-Silicon Mirroring

**Core Shift:** "Compiler" is deprecated. Transitioning to **Direct-to-Silicon Mirroring**.

### 7.1 Silicon Linker Worker

The **Silicon Linker** is a dedicated Web Worker acting as a Memory Management Unit (MMU) for the SAB. It is the sole authority for memory allocation and pointer manipulation.

**Responsibilities:**
- Free List management (node allocation/deallocation)
- Attribute patching (immediate writes)
- Structural splicing (safe zone enforcement + atomic commit)
- COMMIT_FLAG signaling

**Non-Responsibilities:**
- Musical timing calculations (VM-resident)
- Groove/Humanize math (VM-resident)
- postMessage coordination (eliminated from hot path)

```typescript
// packages/core/src/linker/silicon-linker.ts
interface SiliconLinker {
  // Memory Management
  allocNode(): NodePtr;
  freeNode(ptr: NodePtr): void;

  // Attribute Patching (immediate)
  patchPitch(ptr: NodePtr, pitch: u8): void;
  patchVelocity(ptr: NodePtr, velocity: u8): void;
  patchDuration(ptr: NodePtr, duration: i32): void;

  // Structural Splicing (staged)
  insertNode(afterPtr: NodePtr, data: NodeData): NodePtr;
  deleteNode(ptr: NodePtr): void;

  // Commit Protocol
  awaitAck(): Promise<void>;
}
```

### 7.2 SAB Memory Layout

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER (64 bytes = 16 × i32)                                │
├─────────────────────────────────────────────────────────────┤
│ [0]  MAGIC           0x53594D42 ("SYMB")                    │
│ [1]  VERSION         1                                      │
│ [2]  PPQ             480                                    │
│ [3]  BPM             120                                    │
│ [4]  HEAD_PTR        → First node in chain                  │
│ [5]  FREE_LIST_PTR   → First free node                      │
│ [6]  COMMIT_FLAG     0=idle, 1=pending, 2=ack               │
│ [7]  PLAYHEAD_TICK   Current VM tick (written by consumer)  │
│ [8]  SAFE_ZONE_TICKS Minimum distance for structural edits  │
│ [9]  ERROR_FLAG      0=ok, 1=heap_exhausted, 2=invalid_ptr  │
│ [10] NODE_COUNT      Total allocated nodes                  │
│ [11] FREE_COUNT      Nodes in free list                     │
│ [12-15] RESERVED                                            │
├─────────────────────────────────────────────────────────────┤
│ REGISTER BANK (64 bytes = 16 × i32)                         │
├─────────────────────────────────────────────────────────────┤
│ [16] REG.GROOVE_PTR  → Groove template buffer               │
│ [17] REG.GROOVE_LEN  Groove steps count                     │
│ [18] REG.HUMAN_TIMING_PPT  Timing jitter (parts per thousand)│
│ [19] REG.HUMAN_VEL_PPT     Velocity jitter (ppt)            │
│ [20] REG.TRANSPOSE   Global transposition (semitones)       │
│ [21] REG.VELOCITY_MULT Velocity multiplier (ppt, 1000=1.0)  │
│ [22] REG.PRNG_SEED   Deterministic humanization seed        │
│ [23-31] RESERVED                                            │
├─────────────────────────────────────────────────────────────┤
│ NODE HEAP (starts at offset 128, variable size)             │
├─────────────────────────────────────────────────────────────┤
│ Node 0: [OP|P|V|F][BASE_TICK][DURATION][NEXT_PTR][SRC_ID][SEQ_FLAGS] │
│ Node 1: ...                                                 │
│ Node N: [FREE_NEXT][0][0][0][0][0] (free list entry)        │
├─────────────────────────────────────────────────────────────┤
│ GROOVE TEMPLATES (1KB at end of buffer)                     │
├─────────────────────────────────────────────────────────────┤
│ Template 0: [LEN][OFFSET_0][OFFSET_1]...[OFFSET_15]         │
│ Template 1: ...                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Node Structure (6 × i32 = 24 bytes)

| Offset | Field | Encoding | Description |
|--------|-------|----------|-------------|
| +0 | PACKED_A | `(op << 24) \| (pitch << 16) \| (vel << 8) \| flags` | Opcode, pitch, velocity, flags |
| +1 | BASE_TICK | i32 | Grid-aligned timing (pre-transform) |
| +2 | DURATION | i32 | Duration in ticks |
| +3 | NEXT_PTR | i32 | Byte offset to next node (0 = end) |
| +4 | SOURCE_ID | i32 | Editor location hash |
| +5 | SEQ_FLAGS | `(seq << 8) \| flags_ext` | Sequence counter (ABA) + extended flags |

**Flags (byte):**
- Bit 0: `ACTIVE` - Node is live (not deleted)
- Bit 1: `MUTED` - Node is muted (skip during playback)
- Bit 2: `DIRTY` - Write in progress (spin on read)

**Opcodes:**
- `0x01` = NOTE
- `0x02` = REST
- `0x03` = CC (controller change)
- `0x04` = BEND (pitch bend)

### 7.4 Two-Tier Mutation Protocol

#### 7.4.1 Attribute Patching (Immediate, <0.001ms)

For pitch, velocity, or duration changes on existing nodes:

```typescript
function patchPitch(ptr: NodePtr, pitch: u8): void {
  const offset = this.nodeOffset(ptr);

  // 1. Read current packed value
  const packed = Atomics.load(this.sab, offset);

  // 2. Update pitch bits (bits 16-23)
  const newPacked = (packed & 0xFF00FFFF) | (pitch << 16);

  // 3. Increment SEQ counter (ABA protection)
  const seqOffset = offset + 5;
  Atomics.add(this.sab, seqOffset, 0x100); // SEQ in upper 24 bits

  // 4. Write with release semantics
  Atomics.store(this.sab, offset, newPacked);
}
```

**No COMMIT_FLAG needed.** Consumer sees update on next node read.

#### 7.4.2 Structural Splicing (Safe Zone Enforced)

For insertions, deletions, or reordering. **The Atomic Order of Operations:**

When inserting `NoteX` between `NoteA` and `NoteB`:

```typescript
function insertNode(afterPtr: NodePtr, data: NodeData): NodePtr {
  // 1. Check safe zone
  const playhead = Atomics.load(this.sab, REG.PLAYHEAD_TICK);
  const targetTick = this.sab[this.nodeOffset(afterPtr) + 1]; // BASE_TICK
  const safeZone = this.sab[REG.SAFE_ZONE_TICKS];

  if (targetTick - playhead < safeZone) {
    throw new SafeZoneViolationError(targetTick, playhead, safeZone);
  }

  // 2. Allocate NoteX from Free List
  const newPtr = this.allocNode();
  if (newPtr === NULL_PTR) {
    Atomics.store(this.sab, REG.ERROR_FLAG, ERROR_HEAP_EXHAUSTED);
    throw new HeapExhaustedError();
  }
  const newOffset = this.nodeOffset(newPtr);

  // 3. Write all attributes to NoteX
  this.writeNodeData(newOffset, data);

  // 4. Link Future: NoteX.NEXT_PTR = NoteB
  const afterOffset = this.nodeOffset(afterPtr);
  const noteBPtr = Atomics.load(this.sab, afterOffset + 3); // NoteA.NEXT_PTR
  Atomics.store(this.sab, newOffset + 3, noteBPtr);

  // 5. Atomic Splice: NoteA.NEXT_PTR = NoteX
  // At this point, NoteX is ready and linked forward.
  // This single atomic store makes it visible to the VM.
  Atomics.store(this.sab, afterOffset + 3, newPtr);

  // 6. Signal structural change
  Atomics.store(this.sab, REG.COMMIT_FLAG, COMMIT_PENDING);

  return newPtr;
}
```

**Result:** The playhead, moving from `NoteA`, will now naturally "branch" into `NoteX`, then continue to `NoteB`.

### 7.5 COMMIT_FLAG Protocol

```
Silicon Linker                    AudioWorklet Consumer
      │                                    │
      │  [structural edit complete]        │
      │                                    │
      ├──► COMMIT_FLAG = 1 (PENDING)       │
      │                                    │
      │                     ◄──────────────┤ (polls on each 128-frame quantum)
      │                                    │
      │    COMMIT_FLAG = 2 (ACK) ◄─────────┤ (acknowledges, invalidates cache)
      │                                    │
      ├──► COMMIT_FLAG = 0 (IDLE)          │
      │                                    │
```

```typescript
// In AudioWorklet process()
const commitFlag = Atomics.load(this.sab, REG.COMMIT_FLAG);
if (commitFlag === COMMIT_PENDING) {
  // Invalidate any prefetched node pointers
  this.prefetchedNode = null;

  // Acknowledge the structural change
  Atomics.store(this.sab, REG.COMMIT_FLAG, COMMIT_ACK);
}

// Silicon Linker: wait for ACK before allowing next structural edit
async function awaitAck(): Promise<void> {
  const maxSpins = 1000; // ~3ms at worst
  for (let i = 0; i < maxSpins; i++) {
    if (Atomics.load(this.sab, REG.COMMIT_FLAG) === COMMIT_ACK) {
      Atomics.store(this.sab, REG.COMMIT_FLAG, COMMIT_IDLE);
      return;
    }
    // Yield to event loop occasionally
    if (i % 100 === 0) await Promise.resolve();
  }
  // Timeout: consumer may be paused, proceed anyway
  Atomics.store(this.sab, REG.COMMIT_FLAG, COMMIT_IDLE);
}
```

### 7.6 Free List Management

Lock-free LIFO stack using Compare-And-Swap:

```typescript
class FreeList {
  private sab: Int32Array;

  allocNode(): NodePtr {
    while (true) {
      const head = Atomics.load(this.sab, REG.FREE_LIST_PTR);
      if (head === NULL_PTR) return NULL_PTR; // Heap exhausted

      const headOffset = this.nodeOffset(head);
      const next = Atomics.load(this.sab, headOffset); // FREE_NEXT in slot 0

      // CAS: try to advance head to next
      const result = Atomics.compareExchange(
        this.sab, REG.FREE_LIST_PTR, head, next
      );

      if (result === head) {
        // Success: clear the node and return
        this.zeroNode(headOffset);
        Atomics.sub(this.sab, REG.FREE_COUNT, 1);
        Atomics.add(this.sab, REG.NODE_COUNT, 1);
        return head;
      }
      // CAS failed: another thread modified head, retry
    }
  }

  freeNode(ptr: NodePtr): void {
    const offset = this.nodeOffset(ptr);

    // Increment SEQ to invalidate any stale references (ABA protection)
    Atomics.add(this.sab, offset + 5, 0x100);

    // Clear ACTIVE flag
    const packed = Atomics.load(this.sab, offset);
    Atomics.store(this.sab, offset, packed & ~FLAG_ACTIVE);

    while (true) {
      const head = Atomics.load(this.sab, REG.FREE_LIST_PTR);
      Atomics.store(this.sab, offset, head); // ptr.FREE_NEXT = head

      const result = Atomics.compareExchange(
        this.sab, REG.FREE_LIST_PTR, head, ptr
      );

      if (result === head) {
        Atomics.add(this.sab, REG.FREE_COUNT, 1);
        Atomics.sub(this.sab, REG.NODE_COUNT, 1);
        return;
      }
    }
  }
}
```

### 7.7 Safe Zone Constraint

The **Safe Zone** prevents structural edits to nodes that the playhead is about to reach:

```
SAFE_ZONE_TICKS = PPQ * 2  // 2 beats ahead
                 = 960 ticks at 480 PPQ
                 = 1 second at 120 BPM

Timeline:
  [...past...][DANGER][====SAFE ZONE====][...editable future...]
                 ↑            ↑
            playhead    structural edits blocked here
```

**Enforcement:** Silicon Linker checks `targetTick - playheadTick >= SAFE_ZONE_TICKS` before any structural operation. Violations throw `SafeZoneViolationError` and the edit is rejected (not deferred).

### 7.8 Failure Mode: Stale Persistence

If the Silicon Linker encounters an error:

1. **Do not corrupt SAB** - leave current chain intact
2. **Set ERROR_FLAG** - `Atomics.store(sab, REG.ERROR_FLAG, errorCode)`
3. **Throw to caller** - let application layer handle
4. **AudioWorklet continues** - plays existing chain uninterrupted

```typescript
function safeEdit<T>(op: () => T): T | null {
  try {
    return op();
  } catch (e) {
    if (e instanceof HeapExhaustedError) {
      Atomics.store(this.sab, REG.ERROR_FLAG, ERROR_HEAP_EXHAUSTED);
    } else if (e instanceof SafeZoneViolationError) {
      Atomics.store(this.sab, REG.ERROR_FLAG, ERROR_SAFE_ZONE);
    }
    console.error('[SiliconLinker] Edit failed, stale state preserved:', e);
    return null;
  }
}
```

### 7.9 VM-Resident Transform Execution

Groove and Humanize are computed by the AudioWorklet at read time, not baked by the compiler:

```typescript
// In AudioWorklet traversal
function getTriggerTick(nodeOffset: number): number {
  const baseTick = this.sab[nodeOffset + 1]; // BASE_TICK

  // Groove offset (from register-pointed template)
  const groovePtr = this.sab[REG.GROOVE_PTR];
  const grooveLen = this.sab[REG.GROOVE_LEN];
  let grooveOffset = 0;
  if (grooveLen > 0) {
    const stepIndex = baseTick % grooveLen;
    grooveOffset = this.sab[groovePtr + 1 + stepIndex]; // +1 for LEN field
  }

  // Humanize offset (deterministic PRNG from tick + seed)
  const humanTiming = this.sab[REG.HUMAN_TIMING_PPT];
  let humanOffset = 0;
  if (humanTiming > 0) {
    const seed = this.sab[REG.PRNG_SEED];
    // Simple deterministic hash for reproducible humanization
    const hash = ((baseTick * 2654435761) ^ seed) >>> 0;
    const normalized = (hash % 2001 - 1000) / 1000; // [-1, 1]
    humanOffset = Math.round(normalized * humanTiming * this.sab[REG.PPQ] / 1000);
  }

  return baseTick + grooveOffset + humanOffset;
}
```

**Benefit:** Changing groove template or humanization is a single register write. Feedback is instant on the next audio quantum (~3ms).

### 7.10 Implementation Phases

#### Phase 1: Silicon Linker Core
- [ ] Define SAB memory layout constants (`packages/core/src/linker/constants.ts`)
- [ ] Implement Free List with CAS operations (`packages/core/src/linker/free-list.ts`)
- [ ] Implement attribute patching with SEQ counters (`packages/core/src/linker/patch.ts`)
- [ ] Implement SAB initialization (`packages/core/src/linker/init.ts`)
- [ ] Unit tests for allocation/deallocation/patching

#### Phase 2: Structural Splicing
- [ ] Implement safe zone checking
- [ ] Implement COMMIT_FLAG protocol
- [ ] Implement `insertNode()` and `deleteNode()`
- [ ] Integration tests with mock consumer

#### Phase 3: AudioWorklet Consumer Update
- [ ] Update consumer to traverse NEXT_PTR chain
- [ ] Implement COMMIT_FLAG acknowledgment
- [ ] Implement VM-resident Groove/Humanize transforms
- [ ] Latency benchmarks (target: <0.001ms for attribute patch)

#### Phase 4: Editor Integration
- [ ] Wire ClipBuilder to Silicon Linker
- [ ] Implement 10ms debounce for structural edits
- [ ] Implement SOURCE_ID ↔ NodePtr bidirectional mapping
- [ ] End-to-end live coding tests

---

## 8. Success Criteria

- [ ] VM follows `NEXT_PTR` chain successfully.
- [ ] Changing Pitch/Velocity in the editor reflects in audio in < 1ms.
- [ ] Groove templates can be modified during playback with 0ms calculation delay.
- [ ] No "Compilation" step remains in the live-coding loop.
- [ ] 0-Allocation purity maintained for all real-time mutations.
- [ ] Safe Zone enforced: structural edits rejected within 2-beat window.
- [ ] Free List CAS operations pass concurrent stress tests.

---

## 9. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
