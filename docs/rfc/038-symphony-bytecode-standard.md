# RFC-038: Symphony Bytecode (SBC) Standard

**Status**: Draft  
**Target**: `packages/core`  
**Driver**: Zero-Allocation Runtime & Worker Transport  
**Dependencies**: [RFC-037 Asynchronous Runtime Architecture](./037-asynchronous-runtime-architecture.md)

---

## 1. Abstract

Symphony Bytecode (SBC) is a linear, numeric instruction set for describing musical events. It replaces the tree-based `ClipOperation[]` AST with a contiguous `Int32Array`.

**Goal:**

- **Transport:** Enable zero-copy transfer between Main Thread and Audio Thread (via `SharedArrayBuffer`).
- **Performance:** Eliminate Garbage Collection (GC) pauses during playback.
- **Density:** Reduce memory usage by ~80% compared to Object trees.

---

## 2. The Virtual Machine (VM)

The Symphony Runtime is effectively a specialized VM with the following registers:

- `PC` (Program Counter): Index of the current instruction.
- `TICK` (Clock): Current global time in ticks (default 96 PPQ).
- `STACK` (Context): For nested operations (loops, relative transpositions).

---

## 3. Data Structure

An SBC program is a single `Int32Array` (or `Uint32Array`).

### 3.1 Header (Fixed Size: 8 ints)

| Index | Field | Description |
|-------|-------|-------------|
| `0` | `MAGIC` | `0x53424331` ("SBC1") |
| `1` | `VERSION` | Format version (e.g., 1) |
| `2` | `PPQ` | Pulses Per Quarter Note (default: 96) |
| `3` | `BPM` | Initial Tempo |
| `4` | `LENGTH` | Total length in ticks |
| `5-7` | `RESERVED` | Future flags |

### 3.2 Instruction Format

All instructions start with an **OpCode** (High 8 bits) and **Payload** (Low 24 bits), or follow a variable-length argument pattern.

**Standard Layout:**

```
[OPCODE] [ARG_1] [ARG_2] ...
```

---

## 4. OpCode Registry

### Event Operations (0x00 - 0x1F)

These consume time and produce sound.

| Hex | Mnemonic | Args | Description |
|-----|----------|------|-------------|
| `0x01` | **NOTE** | `pitch`, `vel`, `dur` | Play note. `pitch`=MIDI(0-127), `vel`=(0-127), `dur`=ticks. |
| `0x02` | **REST** | `dur` | Advance clock by `dur` ticks. |
| `0x03` | **CHORD2** | `root`, `int1`, `vel`, `dur` | **Macro:** Play 2-note chord (Root + Interval). |
| `0x04` | **CHORD3** | `root`, `int1`, `int2`, `vel`, `dur` | **Macro:** Play 3-note triad. |
| `0x05` | **CHORD4** | `root`, `int1`, `int2`, `int3`, `vel`, `dur` | **Macro:** Play 4-note chord (7th). |

### Control Operations (0x20 - 0x3F)

These modify state without consuming time.

| Hex | Mnemonic | Args | Description |
|-----|----------|------|-------------|
| `0x20` | **TEMPO** | `bpm` | Set new BPM. |
| `0x21` | **CC** | `ctl`, `val` | MIDI CC message. |
| `0x22` | **BEND** | `val` | Pitch Bend (14-bit: 0-16383). |
| `0x23` | **TRANSPOSE** | `semitones` | Add to global transposition register. |

### Structural Operations (0x40 - 0x5F)

Flow control.

| Hex | Mnemonic | Args | Description |
|-----|----------|------|-------------|
| `0x40` | **STACK_START** | `count` | Push current `TICK` to stack. Branch `count` times. |
| `0x41` | **STACK_END** | - | Pop `TICK` from stack. Restore time. |
| `0x42` | **LOOP_START** | `count` | Push (`PC`, `count`) to loop stack. |
| `0x43` | **LOOP_END** | - | Decr count. If >0, jump to `LOOP_START`. Else pop. |
| `0x44` | **CALL** | `addr` | Jump to memory address (Function/Block). |
| `0x45` | **RET** | - | Return from CALL. |
| `0xFF` | **EOF** | - | End of Stream. |

---

## 5. Examples

### Example A: "C Major Scale" (Sequential)

*Context: 4n = 96 ticks*

```
[NOTE]  60, 100, 96   // C4
[NOTE]  62, 100, 96   // D4
[NOTE]  64, 100, 96   // E4
[EOF]
```

**Memory:**

```
[0x01, 60, 100, 96, 0x01, 62, 100, 96, 0x01, 64, 100, 96, 0xFF]
```

### Example B: "C Major Chord" (Parallel/Stack)

**Old Way:** 3 NoteOps. **New Way:** Stack or Macro.

#### Option 1: Stack Approach

```
[STACK_START] 3       // 3 Branches
  [NOTE] 60, 100, 96  // C4
  [NOTE] 64, 100, 96  // E4
  [NOTE] 67, 100, 96  // G4
[STACK_END]
[REST] 96             // Wait for the chord to finish (if stack doesn't auto-advance)
```

#### Option 2: Macro Approach (Optimization)

```
[CHORD3] 60, 4, 7, 100, 96  // Root(60), +4(E), +7(G)
```

**Note:** This single instruction replaces ~10 integers of stack overhead.

---

## 6. Implementation Strategy

### 6.1 The Assembler (`packages/core/src/vm/assembler.ts`)

We will write a `compileToBytecode(clip: ClipNode): Int32Array` function. It performs the same traversal as `expandClip`, but instead of pushing objects to an array, it pushes numbers to a dynamic `ByteBuilder`.

### 6.2 The Runtime (`packages/core/src/vm/runtime.ts`)

A minimal tick-based loop:

```typescript
while (this.tick < targetTick) {
  const op = memory[pc++];
  switch (op) {
    case NOTE:
      const p = memory[pc++];
      const v = memory[pc++];
      const d = memory[pc++];
      this.emit(p, v, d);
      this.tick += d;
      break;
    // ...
  }
}
```

---

## 7. Migration

We do not delete the Object AST yet.

- **Step 1:** Implement `compileToBytecode`.
- **Step 2:** Update `LiveSession` to use the VM for playback.
- **Step 3:** (Later) Refactor `ClipBuilder` to write Bytecode directly, bypassing the AST entirely.

---

## 8. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
