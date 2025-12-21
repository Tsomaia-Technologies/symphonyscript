# RFC-045: The Synapse Graph Architecture

| Metadata | Value |
| --- | --- |
| **Title** | **The Synapse Graph Architecture** |
| **Status** | **DRAFT** |
| **Target** | `packages/core/src/linker/` |
| **Goals** | Enable Non-Linear, Generative, and Re-Usable topologies. |
| **Depends On** | RFC-044 (Command Ring) |

---

## 1. Executive Summary

Current DAWs and sequencers are stuck in the **Linear Timeline Paradigm** (Track 1 follows Track 2). This limits reusability and generative potential.

RFC-045 introduces the **Synapse Graph**: a "Neural" topology where any Clip can trigger any other Clip (or multiple Clips) upon completion.

* **Clips** remain optimized Linked Lists of notes (The "Axon").
* **Synapses** are external connections that fire when a Clip completes (The "Dendrite").

This allows for **Polyphonic Fan-Out** (One Clip triggers three others) and **Fan-In** (Three Clips trigger one Chorus), effectively turning SymphonyScript into a Turing-complete musical state machine.

---

## 2. The Physics of the "Hybrid"

### 2.1. The Micro-Structure (The Clip)

Inside a Clip, nothing changes. It is a dense, cache-friendly `Int32Array` region of nodes linked by `NEXT_PTR`.

* **Performance:** Unbeatable for sequential playback.
* **Alloc:** Zone B (Main Thread) or Zone A (Generative).

### 2.2. The Macro-Structure (The Synapse)

We introduce a **Synapse Table** in the `SharedArrayBuffer`. This is a specialized look-up region that maps a **Trigger Node** (usually the last note of a clip) to one or more **Target Nodes** (the start of other clips).

**The Synapse Struct (16 bytes):**

```typescript
[ SOURCE_PTR, TARGET_PTR, WEIGHT, NEXT_SYNAPSE_PTR ]

```

* `SOURCE_PTR`: The node that sends the signal (usually End-of-Clip).
* `TARGET_PTR`: The node that receives the signal (Start-of-Clip).
* `WEIGHT`: Probability (0-100) or Velocity Multiplier.
* `NEXT_SYNAPSE_PTR`: Pointer to the next Synapse (Linked List in the Table) to allow **Fan-Out**.

---

## 3. Memory Layout Update

We append the **Synapse Region** to the SAB Memory Map.

| Region | Size | Description |
| --- | --- | --- |
| ... | ... | ... |
| **Ring Buffer** | 64KB | RFC-044 Command Queue |
| **Synapse Table** | 1MB | Pool of reusable Synapse connections |

### 3.1. The Synapse Lookup

The `SiliconLinker` does not scan the table. Instead, we use a **Synapse Hash Map** (similar to the Identity Table) or directly embed a `SYNAPSE_HEAD_PTR` in the Node struct (if we have space in `RESERVED` fields).

*Decision:* To save Node space, we will use a **Linear Probe Hash Table** in the Synapse Region, keyed by `SOURCE_PTR`.

---

## 4. Execution Model: The Signal Propagation

The Kernel (`SiliconLinker`) shifts from a "Playhead Follower" to a "Signal Processor."

**The Cycle:**

1. **Advance Cursors:** The Kernel advances all active cursors (Playheads) along their Linked Lists (`NEXT_PTR`).
2. **End-of-Chain Detection:** If a cursor hits `NULL_PTR` (End of Clip) OR a specific "Trigger Flag":
3. **Synapse Fire:**
* The Kernel looks up `Cursor.CurrentNode` in the **Synapse Table**.
* **If Match Found:**
* It reads the `TARGET_PTR`.
* It spawns a **New Cursor** at `TARGET_PTR`.
* *Fan-Out:* It checks `NEXT_SYNAPSE_PTR` and repeats until `NULL`.




4. **Cursor GC:** The old cursor dies (unless it looped).

---

## 5. The "Patching" API (Bridge)

The Composer connects clips like a modular synth.

```typescript
// Define Clips (Blueprints)
const drums = Clip.rhythm('x-x-');
const bass = Clip.melody('C2 E2');
const chords = Clip.harmony('Cm7');

// Wire the Neural Graph
// "When drums finish, trigger Bass AND Chords"
bridge.connect(drums, [bass, chords]);

// "When Bass finishes, 50% chance to repeat, 50% to go to Bridge"
bridge.connect(bass, [
  { target: bass, probability: 0.5 },
  { target: chords, probability: 0.5 }
]);

```

**Under the Hood:**

1. The Bridge finds the **Last Node** of the `drums` chain.
2. It sends `CMD_SYNAPSE_CONNECT` to the Ring Buffer.
3. The Linker writes the connections into the Synapse Table.

---

## 6. Implementation Plan

### Phase 1: Memory (RFC-044 Ext)

1. Define `SYNAPSE_TABLE_OFFSET` in `constants.ts`.
2. Define `SYNAPSE` struct layout.

### Phase 2: The Synapse Allocator

1. Implement a simple Free List for Synapse slots (similar to Nodes).

### Phase 3: The Linker Logic

1. Update `SiliconLinker.advance()` to perform Synapse Lookups on node completion.
2. Implement `cursorPool` (Fixed-size array of active playheads) to handle polyphony.

---

### Immediate Action

We are still finishing **RFC-044 Phase 2**.
To enable RFC-045, we must first ensure the **Linker can read commands** (RFC-044 Directive 044-05). Without the Command Ring, we cannot wire the Synapses dynamically.

**Shall we execute Directive 044-05 (The Read Path) so we can build this Neural Engine?**
