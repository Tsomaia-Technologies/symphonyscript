# RFC-038: Symphony Bytecode (SBC) Standard

**Status**: Draft (v2 — Unified Memory Architecture)  
**Target**: `packages/core`  
**Driver**: Zero-Allocation Runtime, Streaming Execution, Worker Transport  
**Dependencies**: None (enables RFC-037)

---

## 1. Abstract

Symphony Bytecode (SBC) is a **unified memory architecture** for musical event processing. The entire VM state — registers, control stacks, bytecode program, and event buffer — lives in a single `SharedArrayBuffer`, enabling:

- **Zero-Copy Transport**: Transfer entire VM to AudioWorklet without serialization
- **Zero-GC Execution**: All operations on pre-allocated Int32Array views
- **Infinite Streaming**: Lock-free SPSC ring buffer for events (no overflow)
- **State Snapshots**: Trivial serialization for hot-swap (RFC-039)
- **Real-Time Observability**: UI can read PC/TICK/STATE directly from buffer

---

## 2. Design Philosophy

### 2.1 True Unified Memory

**Old Design (Fragmented):**
```typescript
// Multiple allocations, GC pressure, can't share
private bytecode: Int32Array
private stackFrames: StackFrame[]    // JS objects
private loopFrames: LoopFrame[]      // JS objects
private transposition: number[]      // JS array
private events: VMEvent[]            // JS objects
```

**New Design (Unified):**
```typescript
// Everything in one buffer
private memory: Int32Array  // View into SharedArrayBuffer
// All state accessed via offsets into this single buffer
```

### 2.2 Streaming Execution Model

The VM writes events to a buffer while the audio thread reads already-emitted events:

```
Time →
VM:     [emit e0] [emit e1] [emit e2] [emit e3] ...
Audio:            [read e0] [read e1] [read e2] ...

Synchronization: Atomic EVENT_COUNT register
```

---

## 3. Memory Layout

### 3.1 Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ UNIFIED VM MEMORY (SharedArrayBuffer → Int32Array view)                 │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│ Registers   │ Control     │ Bytecode    │ Event       │ Tempo           │
│ [0..31]     │ [32..255]   │ [256..BC_END]│ [EVT_START..]│ [TEMPO_START..]│
│             │             │             │             │                 │
│ 32 ints     │ 224 ints    │ Variable    │ Variable    │ Variable        │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────┘
```

### 3.2 Register Block (Offset 0-31)

All registers are at fixed offsets. Registers marked `[ATOMIC]` require `Atomics.load/store` for cross-thread visibility.

| Offset | Name | Type | Description |
|--------|------|------|-------------|
| 0 | `MAGIC` | u32 | `0x53424331` ("SBC1") — validates buffer |
| 1 | `VERSION` | u32 | Format version (2) |
| 2 | `PPQ` | u32 | Pulses per quarter note (default: 96) |
| 3 | `BPM` | u32 | Initial tempo |
| 4 | `TOTAL_LENGTH` | u32 | Total program length in ticks |
| 5 | `PC` | u32 | Program counter (offset into bytecode region) |
| 6 | `TICK` | u32 | Current clock in ticks |
| 7 | `STATE` | u32 | `[ATOMIC]` VM state: 0x00=IDLE, 0x01=RUNNING, 0x02=PAUSED, 0x03=DONE |
| 8 | `STACK_SP` | u32 | Stack frame pointer (0-based index) |
| 9 | `LOOP_SP` | u32 | Loop frame pointer (0-based index) |
| 10 | `TRANS_SP` | u32 | Transposition stack pointer |
| 11 | `TRANSPOSITION` | i32 | Current transposition offset (top of stack, cached) |
| 12 | `EVENT_WRITE` | u32 | `[ATOMIC]` Events written (monotonic, wraps via modulo) |
| 13 | `EVENT_READ` | u32 | `[ATOMIC]` Events read by consumer (monotonic) |
| 14 | `TEMPO_COUNT` | u32 | Number of tempo changes recorded |
| 15 | `BYTECODE_START` | u32 | Offset where bytecode begins |
| 16 | `BYTECODE_END` | u32 | Offset where bytecode ends |
| 17 | `EVENT_START` | u32 | Offset where event ring buffer begins |
| 18 | `EVENT_CAPACITY` | u32 | Ring buffer capacity (entries, not bytes) |
| 19 | `TEMPO_START` | u32 | Offset where tempo buffer begins |
| 20 | `TEMPO_CAPACITY` | u32 | Maximum tempo changes |
| 21-31 | `RESERVED` | - | Future use |

### 3.3 Control Stack Region (Offset 32-255)

Fixed-size frames for O(1) backward traversal.

**Stack Frame Layout (8 ints each, max 14 frames):**
```
Offset within region: [frameIndex * 8]
[0] startTick      — Tick when stack started
[1] maxDuration    — Maximum branch duration seen
[2] branchCount    — Total branches
[3] branchIndex    — Current branch (0-indexed)
[4-7] reserved
```

**Loop Frame Layout (4 ints each, max 28 frames):**
```
Base offset: 32 + 112 = 144
Offset within region: [frameIndex * 4]
[0] bodyStartPC    — PC of first instruction after LOOP_START
[1] remainingCount — Iterations remaining
[2-3] reserved
```

**Transposition Stack (1 int each, max 32 entries):**
```
Base offset: 32 + 112 + 112 = 256 - 32 = 224
Actually, let's recalculate...
```

**Revised Control Region Layout:**

| Sub-Region | Offset | Size | Frame Size | Max Frames |
|------------|--------|------|------------|------------|
| Stack Frames | 32 | 112 ints | 8 ints | 14 |
| Loop Frames | 144 | 80 ints | 4 ints | 20 |
| Transpose Stack | 224 | 32 ints | 1 int | 32 |

### 3.4 Bytecode Region (Offset 256+)

The assembled program lives here. Starts at offset 256, ends at `BYTECODE_END`.

### 3.5 Event Buffer (After Bytecode)

Fixed-size event entries for uniform access.

**Event Entry Layout (6 ints each):**
```
[0] type           — 0x01=NOTE, 0x02=CC, 0x03=BEND
[1] startTick      — When event occurs
[2] field1         — pitch (NOTE), controller (CC), value (BEND)
[3] field2         — velocity (NOTE), value (CC), 0 (BEND)
[4] field3         — duration (NOTE), 0 (CC/BEND)
[5] reserved
```

### 3.6 Tempo Buffer (After Events)

**Tempo Entry Layout (2 ints each):**
```
[0] tick           — When tempo changes
[1] bpm            — New BPM value
```

---

## 4. OpCode Registry

### 4.1 Event Operations (0x00-0x1F)

| Hex | Mnemonic | Args | Tick Advance | Description |
|-----|----------|------|--------------|-------------|
| `0x01` | NOTE | pitch, vel, dur | +dur | Emit note event |
| `0x02` | REST | dur | +dur | Advance clock only |
| `0x03` | CHORD2 | root, int1, vel, dur | +dur | 2-note chord macro |
| `0x04` | CHORD3 | root, int1, int2, vel, dur | +dur | 3-note chord macro |
| `0x05` | CHORD4 | root, i1, i2, i3, vel, dur | +dur | 4-note chord macro |

### 4.2 Control Operations (0x20-0x3F)

| Hex | Mnemonic | Args | Tick Advance | Description |
|-----|----------|------|--------------|-------------|
| `0x20` | TEMPO | bpm | No | Record tempo change |
| `0x21` | CC | ctrl, val | No | Emit CC event |
| `0x22` | BEND | val | No | Emit pitch bend event |
| `0x23` | TRANSPOSE | semitones | No | Push/pop transposition (0 = pop) |

### 4.3 Structural Operations (0x40-0x5F)

| Hex | Mnemonic | Args | Tick Advance | Description |
|-----|----------|------|--------------|-------------|
| `0x40` | STACK_START | count | No | Push stack frame |
| `0x41` | STACK_END | - | → maxDuration | Pop frame, advance to max |
| `0x42` | LOOP_START | count | No | Push loop frame (skip if count ≤ 0) |
| `0x43` | LOOP_END | - | No | Decrement, jump back or pop |
| `0x46` | BRANCH_START | - | No | Reset tick to stack start |
| `0x47` | BRANCH_END | - | No | Record branch duration |
| `0xFF` | EOF | - | No | End of program |

---

## 5. VM Execution

### 5.1 Initialization

```typescript
constructor(buffer: SharedArrayBuffer, bytecodeSize: number, eventCapacity: number) {
  this.memory = new Int32Array(buffer)
  
  // Validate
  if (this.memory[REG.MAGIC] !== SBC_MAGIC) throw new Error('Invalid SBC buffer')
  
  // Initialize pointers
  this.memory[REG.PC] = REG.BYTECODE_START_VALUE
  this.memory[REG.TICK] = 0
  this.memory[REG.STACK_SP] = 0
  this.memory[REG.LOOP_SP] = 0
  this.memory[REG.TRANS_SP] = 0
  this.memory[REG.TRANSPOSITION] = 0
  Atomics.store(this.memory, REG.EVENT_COUNT, 0)
  Atomics.store(this.memory, REG.STATE, STATE.IDLE)
}
```

### 5.2 Execution Loop

```typescript
tick(targetTick: number): void {
  Atomics.store(this.memory, REG.STATE, STATE.RUNNING)
  
  while (this.memory[REG.PC] < this.memory[REG.BYTECODE_END]) {
    // Check tick boundary BEFORE executing
    if (this.memory[REG.TICK] > targetTick) break
    
    const pc = this.memory[REG.PC]
    const opcode = this.memory[pc]
    this.memory[REG.PC]++
    
    if (opcode === OP.EOF) {
      Atomics.store(this.memory, REG.STATE, STATE.DONE)
      break
    }
    
    this.executeOpcode(opcode)
    
    // After time-advancing ops, check if we exceeded target
    if (this.memory[REG.TICK] > targetTick) break
  }
  
  if (this.memory[REG.STATE] !== STATE.DONE) {
    Atomics.store(this.memory, REG.STATE, STATE.PAUSED)
  }
}
```

### 5.3 Event Emission (Ring Buffer with Backpressure)

The event buffer is a **ring buffer** with separate write and read pointers. Both pointers are monotonically increasing; we use modulo arithmetic to compute actual buffer offsets.

```typescript
private emitNote(pitch: number, velocity: number, duration: number): boolean {
  const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
  const readCount = Atomics.load(this.memory, REG.EVENT_READ)
  const capacity = this.memory[REG.EVENT_CAPACITY]
  
  // Backpressure check: is buffer full?
  if (writeCount - readCount >= capacity) {
    // Buffer full — audio thread hasn't caught up
    // Return false to signal backpressure (caller can retry or drop)
    return false
  }
  
  const eventStart = this.memory[REG.EVENT_START]
  const writeIndex = writeCount % capacity  // RING BUFFER WRAP
  const offset = eventStart + writeIndex * EVENT_SIZE
  
  // Write event data BEFORE incrementing write pointer
  this.memory[offset + 0] = EVENT_TYPE.NOTE
  this.memory[offset + 1] = this.memory[REG.TICK]
  this.memory[offset + 2] = pitch + this.memory[REG.TRANSPOSITION]
  this.memory[offset + 3] = velocity
  this.memory[offset + 4] = duration
  this.memory[offset + 5] = 0  // reserved
  
  // Atomic increment — makes event visible to audio thread
  Atomics.store(this.memory, REG.EVENT_WRITE, writeCount + 1)
  return true
}
```

**Key Points:**
- `EVENT_WRITE` and `EVENT_READ` are both monotonically increasing
- Buffer position = `pointer % capacity`
- Buffer is full when `(write - read) >= capacity`
- Buffer is empty when `write === read`
- This is a **lock-free SPSC (Single Producer Single Consumer)** ring buffer
```

### 5.4 Stack Execution

```typescript
case OP.STACK_START: {
  const count = this.memory[this.memory[REG.PC]++]
  const sp = this.memory[REG.STACK_SP]
  const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
  
  this.memory[frameBase + 0] = this.memory[REG.TICK]  // startTick
  this.memory[frameBase + 1] = 0                       // maxDuration
  this.memory[frameBase + 2] = count                   // branchCount
  this.memory[frameBase + 3] = 0                       // branchIndex
  
  this.memory[REG.STACK_SP] = sp + 1
  break
}

case OP.BRANCH_START: {
  const sp = this.memory[REG.STACK_SP] - 1
  const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
  // Reset tick to stack start
  this.memory[REG.TICK] = this.memory[frameBase + 0]
  break
}

case OP.BRANCH_END: {
  const sp = this.memory[REG.STACK_SP] - 1
  const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
  const branchDur = this.memory[REG.TICK] - this.memory[frameBase + 0]
  // Update max duration
  if (branchDur > this.memory[frameBase + 1]) {
    this.memory[frameBase + 1] = branchDur
  }
  // Increment branch index
  this.memory[frameBase + 3]++
  break
}

case OP.STACK_END: {
  const sp = this.memory[REG.STACK_SP] - 1
  const frameBase = REGION.STACK_FRAMES + sp * STACK_FRAME_SIZE
  // Advance tick to startTick + maxDuration
  this.memory[REG.TICK] = this.memory[frameBase + 0] + this.memory[frameBase + 1]
  this.memory[REG.STACK_SP] = sp
  break
}
```

### 5.5 Loop Execution

```typescript
case OP.LOOP_START: {
  const count = this.memory[this.memory[REG.PC]++]
  
  if (count <= 0) {
    // Skip loop body — find matching LOOP_END
    let depth = 1
    while (depth > 0) {
      const op = this.memory[this.memory[REG.PC]++]
      if (op === OP.LOOP_START) depth++
      else if (op === OP.LOOP_END) depth--
    }
    break
  }
  
  const lp = this.memory[REG.LOOP_SP]
  const frameBase = REGION.LOOP_FRAMES + lp * LOOP_FRAME_SIZE
  
  this.memory[frameBase + 0] = this.memory[REG.PC]  // bodyStartPC
  this.memory[frameBase + 1] = count                 // remainingCount
  
  this.memory[REG.LOOP_SP] = lp + 1
  break
}

case OP.LOOP_END: {
  const lp = this.memory[REG.LOOP_SP] - 1
  const frameBase = REGION.LOOP_FRAMES + lp * LOOP_FRAME_SIZE
  
  this.memory[frameBase + 1]--  // Decrement count
  
  if (this.memory[frameBase + 1] > 0) {
    // Jump back to body start (tick continues accumulating)
    this.memory[REG.PC] = this.memory[frameBase + 0]
  } else {
    // Pop frame
    this.memory[REG.LOOP_SP] = lp
  }
  break
}
```

### 5.6 Transposition (Scoped)

```typescript
case OP.TRANSPOSE: {
  const semitones = this.memory[this.memory[REG.PC]++]
  
  if (semitones === 0) {
    // Pop: restore previous transposition
    const tp = this.memory[REG.TRANS_SP] - 1
    if (tp >= 0) {
      this.memory[REG.TRANS_SP] = tp
      this.memory[REG.TRANSPOSITION] = tp > 0 
        ? this.memory[REGION.TRANSPOSE_STACK + tp - 1]
        : 0
    }
  } else {
    // Push: add to current transposition
    const tp = this.memory[REG.TRANS_SP]
    const newOffset = this.memory[REG.TRANSPOSITION] + semitones
    this.memory[REGION.TRANSPOSE_STACK + tp] = newOffset
    this.memory[REG.TRANS_SP] = tp + 1
    this.memory[REG.TRANSPOSITION] = newOffset
  }
  break
}
```

---

## 6. Assembler

### 6.1 Function Signature

```typescript
export interface AssemblerOptions {
  bpm?: number           // Default: 120
  ppq?: number           // Default: 96
  eventCapacity?: number // Default: 10000
  tempoCapacity?: number // Default: 100
}

export function assembleToBytecode(
  clip: ClipNode,
  options?: AssemblerOptions
): SharedArrayBuffer
```

### 6.2 Assembly Process

1. **Calculate sizes**: Traverse ClipNode to count operations, estimate bytecode size
2. **Allocate buffer**: `new SharedArrayBuffer(totalSize * 4)`
3. **Write header**: Magic, version, PPQ, BPM, region offsets
4. **Emit bytecode**: Traverse ClipNode, emit opcodes to bytecode region
5. **Backpatch length**: Write total ticks to header after assembly

### 6.3 Tied Note Pre-Resolution

Before emitting bytecode, coalesce tied notes (like `coalesceStream`):

```typescript
// Track active ties: key = `${expressionId}:${pitch}`
const activeTies = new Map<string, { startTick: number, duration: number }>()

// On tie: 'start' → open tie
// On tie: 'continue' → extend duration
// On tie: 'end' → emit merged note, close tie
```

### 6.4 CHORD Macro Detection (Optional)

After flattening stacks, detect simultaneous notes for compression:

```typescript
// Post-processing pass
// If consecutive NOTEs have same tick, same velocity, same duration → CHORD
```

---

## 7. Audio Thread Consumer (Ring Buffer)

### 7.1 Reading Events

```typescript
// In AudioWorklet
class SBCConsumer {
  private memory: Int32Array
  
  constructor(buffer: SharedArrayBuffer) {
    this.memory = new Int32Array(buffer)
  }
  
  /**
   * Poll for new events. Returns events that have been written but not yet read.
   * Advances the read pointer after reading.
   */
  poll(): VMEvent[] {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]
    const eventStart = this.memory[REG.EVENT_START]
    
    const events: VMEvent[] = []
    let currentRead = readCount
    
    while (currentRead < writeCount) {
      const readIndex = currentRead % capacity  // RING BUFFER WRAP
      const offset = eventStart + readIndex * EVENT_SIZE
      
      events.push({
        type: this.memory[offset + 0],
        tick: this.memory[offset + 1],
        pitch: this.memory[offset + 2],
        velocity: this.memory[offset + 3],
        duration: this.memory[offset + 4]
      })
      
      currentRead++
    }
    
    // Advance read pointer — frees buffer space for writer
    if (currentRead > readCount) {
      Atomics.store(this.memory, REG.EVENT_READ, currentRead)
    }
    
    return events
  }
  
  /**
   * Check how many events are available without reading them.
   */
  available(): number {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    return writeCount - readCount
  }
  
  /**
   * Check if VM is waiting due to backpressure.
   */
  isBackpressured(): boolean {
    const writeCount = Atomics.load(this.memory, REG.EVENT_WRITE)
    const readCount = Atomics.load(this.memory, REG.EVENT_READ)
    const capacity = this.memory[REG.EVENT_CAPACITY]
    return (writeCount - readCount) >= capacity
  }
}
```

### 7.2 Ring Buffer Semantics

```
Writer (VM):                    Reader (Audio):
  EVENT_WRITE = 5                 EVENT_READ = 2
  
  Buffer: [_, _, E2, E3, E4, _, _, _]
                ↑           ↑
             read=2      write=5
  
  Available: write - read = 3 events
  Free slots: capacity - (write - read)
```

**Invariants:**
- `EVENT_READ <= EVENT_WRITE` (always)
- `EVENT_WRITE - EVENT_READ <= EVENT_CAPACITY` (never overwrite unread)
- Both pointers are monotonic (never decrease, wrap via modulo)

---

## 8. Constants

```typescript
// Magic and Version (hex for bytecode identifiers)
export const SBC_MAGIC = 0x53424331  // "SBC1" as ASCII
export const SBC_VERSION = 0x02

// Default values (decimal for musical parameters)
export const DEFAULT_PPQ = 96
export const DEFAULT_BPM = 120

// Register offsets
export const REG = {
  MAGIC: 0,
  VERSION: 1,
  PPQ: 2,
  BPM: 3,
  TOTAL_LENGTH: 4,
  PC: 5,
  TICK: 6,
  STATE: 7,
  STACK_SP: 8,
  LOOP_SP: 9,
  TRANS_SP: 10,
  TRANSPOSITION: 11,
  EVENT_WRITE: 12,    // [ATOMIC] Writer pointer (monotonic)
  EVENT_READ: 13,     // [ATOMIC] Reader pointer (monotonic)
  TEMPO_COUNT: 14,
  BYTECODE_START: 15,
  BYTECODE_END: 16,
  EVENT_START: 17,
  EVENT_CAPACITY: 18,
  TEMPO_START: 19,
  TEMPO_CAPACITY: 20
} as const

// Region offsets
export const REGION = {
  REGISTERS: 0,
  STACK_FRAMES: 32,
  LOOP_FRAMES: 144,
  TRANSPOSE_STACK: 224,
  BYTECODE: 256
} as const

// Frame sizes
export const STACK_FRAME_SIZE = 8
export const LOOP_FRAME_SIZE = 4
export const EVENT_SIZE = 6
export const TEMPO_ENTRY_SIZE = 2

// VM States (hex for machine states)
export const STATE = {
  IDLE: 0x00,
  RUNNING: 0x01,
  PAUSED: 0x02,
  DONE: 0x03
} as const

// Event types (hex for type discriminators)
export const EVENT_TYPE = {
  NOTE: 0x01,
  CC: 0x02,
  BEND: 0x03
} as const
```

---

## 9. Limitations (Documented)

The following are NOT handled in v1:

- **Humanize**: Notes emitted at exact tick positions
- **Quantize**: No grid snapping
- **Articulation**: Duration multipliers not applied
- **Groove/Swing**: No template application
- **Dynamics**: Velocity curves not processed

These limitations mean VM output will NOT match `compileClip()` for clips using modifiers. Integration tests should use simple clips.

---

## 10. Success Criteria

- [ ] `assembleToBytecode(clip)` returns `SharedArrayBuffer`
- [ ] Memory layout matches specification exactly
- [ ] All registers at correct offsets
- [ ] Stack frames are fixed-size (8 ints)
- [ ] Loop frames are fixed-size (4 ints)
- [ ] Events are fixed-size (6 ints)
- [ ] Event buffer is a **ring buffer** (modulo arithmetic)
- [ ] `Atomics.store` used for EVENT_WRITE, EVENT_READ, and STATE
- [ ] `Atomics.load` used when reading pointers cross-thread
- [ ] Backpressure handled (emitNote returns false when buffer full)
- [ ] Consumer advances EVENT_READ after reading
- [ ] Stack execution uses MAX duration
- [ ] Loop execution does NOT reset tick
- [ ] TRANSPOSE(0) pops, TRANSPOSE(n) pushes
- [ ] VM produces equivalent events for simple clips
- [ ] Infinite streaming works (ring buffer wraps correctly)
- [ ] All tests pass

---

## 11. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
