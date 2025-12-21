# RFC-045: The Synapse Graph & Plasticity Engine

| Metadata | Value |
| --- | --- |
| **Title** | **The Synapse Graph Architecture** |
| **Status** | **APPROVED FOR IMPLEMENTATION** |
| **Target** | `packages/core/src/linker/` |
| **Identity** | **The Silicon Brain / Neural Audio Processor** |
| **Depends On** | RFC-044 (Command Ring) |

---

## 1. Executive Summary

SymphonyScript moves beyond the "Linear Timeline Paradigm" of traditional DAWs into a **Neural Topology**. This architecture treats music as a living organism where **Clips (Axons)** are connected by **Synapses (Dendrites)**.

The Kernel shifts from a passive "Playhead Follower" to an active **Signal Processor**, managing a state machine capable of **Polyphonic Fan-Out**, **Stochastic Branching**, and **Synaptic Plasticity**. This is "Speed of Light" composition: the composer and the engine inhabit a shared atomic mirror where re-wiring the music is an instantaneous synaptic update.

---

## 2. The Biological Mapping

### 2.1. The Axon (The Clip)
The Axon is a dense, high-speed chain of musical notes linked by `NEXT_PTR`. It represents the **Immutable DNA** of the music.
* **Role:** Storage of deterministic note data (Pitch, Duration, BaseTick).
* **Optimization:** Sequential memory access (Cache-Aligned).

### 2.2. The Dendrite (The Synapse)
The Synapse is the **Mutable Intelligence**. It connects the end of one Axon to the start of another.
* **Role:** Decision making (Branching), Energy Transfer (Velocity/Volume), and Humanization (Timing Jitter).
* **Properties:** Contains `WEIGHT` (Probability/Intensity) and `JITTER` (Micro-timing).

---

## 3. Memory Architecture: The Synapse Table

We allocate a dedicated **1MB Synapse Table** in the `SharedArrayBuffer` following the Command Ring. To maintain O(1) performance during the audio quantum, we use a **Linear Probe Hash Table** keyed by `SOURCE_PTR`.

### 3.1. The Synapse Struct (16 bytes)

The struct is tightly packed to fit within 4 integers (128 bits), ensuring atomic-friendly alignment.

| Offset | Field | Type | Bits | Description |
| :--- | :--- | :--- | :--- | :--- |
| **0** | `SOURCE_PTR` | `i32` | 32 | The Trigger Node (End of Clip). Key for hashing. |
| **1** | `TARGET_PTR` | `i32` | 32 | The Destination Node (Start of Next Clip). |
| **2** | `WEIGHT_DATA` | `i32` | 32 | **Packed:** `[Weight (16b) \| Jitter (16b)]` |
| **3** | `META_NEXT` | `i32` | 32 | **Packed:** `[PlasticityFlags (8b) \| NextSynapsePtr (24b)]` |

* **Weight (0-1000):** Fixed-point probability (0.0 to 1.0) or velocity multiplier.
* **Jitter (0-65535):** Micro-timing deviation applied to the target cursor (in ticks).
* **NextSynapsePtr:** Linked list index for "Fan-Out" (Collision handling / Multiple targets).

---

## 4. The Execution Model: Signal Propagation

### 4.1. Synaptic Resolution Phase
When a `LiveNoteCursor` reaches a node where `NEXT_PTR == NULL`, the Kernel executes **Synaptic Resolution**:

1.  **Lookup:** Hash `SOURCE_PTR` and probe the Synapse Table.
2.  **Quota Check:** Increment global `synapsesFired` counter. If `> MAX_SYNAPSE_FIRES_PER_BLOCK` (default: 64), abort. *This prevents infinite loops from hanging the Audio Thread.*
3.  **Resolution:**
    * Iterate through the `NEXT_SYNAPSE_PTR` chain.
    * **Stochastic Roll:** For each synapse, roll a pseudo-random number against its `WEIGHT`.
    * **Competitive Normalization:** If multiple exclusive paths exist, weights are treated as relative probabilities.
4.  **Spawn:** Allocate new Cursor(s) pointing to `TARGET_PTR`.
5.  **Humanize:** Apply the `Jitter` value from the winning Synapse to the new Cursor's internal clock offset.

### 4.2. Cursor Pool Management
The Kernel manages a fixed-size pool of active cursors to handle polyphony. If the pool saturates, the Kernel uses a **"Neural Pruning"** strategy, prioritizing the newest signals and killing the oldest/quietest cursors.

---

## 5. The Plasticity Engine: Learning & Rewards

The "Silicon Brain" can evolve its own structure based on feedback.

### 5.1. Weight-Hardening (Potentiation)
* **The Signal:** The Bridge sends a `CMD_REWARD` via the Command Ring or updates the `REWARD_COUNTER`.
* **The Action:** The Kernel applies the `LEARNING_RATE` (e.g., +0.01) to the `WEIGHT` of the most recently fired synapses.
* **Result:** Successful musical transitions become stronger (more probable) over time.

### 5.2. Persistence (Long-Term Memory)
While the active brain lives in the SAB (Volatile), its "Personality" is snapshotted to **IndexedDB**.
* **Identity Mapping:** Every Axon and Synapse has a persistent UUID.
* **Re-Hydration:** On session load, the `SiliconBridge` reads the "Hardened Weights" from IndexedDB and updates the Synapse Table, restoring the brain's learned state.

---

## 6. Safety Constraints (The "Armor")

To mitigate the High-Risk nature of manual memory management:

### 6.1. The Disconnect Protocol
A Node in Zone A/B cannot be freed if a Synapse points to it.
* **Constraint:** The Bridge maintains a `ReverseMap<NodePtr, SynapseIndex[]>`.
* **Guard:** `bridge.deleteClip(ptr)` automatically issues `CMD_SYNAPSE_DISCONNECT` for all incoming connections *before* freeing the node.

### 6.2. The Safety Handle (DSL)
The Developer API never exposes raw pointers.
```typescript
// Safe API
bridge.connect(verse, chorus, { weight: 0.8, jitter: 10 });
// Invalid inputs are caught here, preventing Kernel logic bombs.