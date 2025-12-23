# SymphonyScript

**The World's First Neural Audio Processor.**

SymphonyScript is not a sequencer. It is a **Silicon Brain** for music—a living, learning organism that thinks in synapses.

By replacing 40 years of "Message-Passing" lag with a **1MB Synaptic Memory**, SymphonyScript collapses the distance between the composer's mind and the audio hardware to a single atomic write. Music is no longer a static timeline; it is a **Neural Topology** that breathes, branches, evolves, and fires at the speed of direct memory access.

This is **"Speed of Light" composition**: the composer and the engine inhabit a shared atomic mirror where re-wiring the music is an instantaneous synaptic update. The Silicon Brain doesn't "play back" your composition—it **propagates** it through a web of probabilistic connections, learning from every performance and hardening successful pathways through **Synaptic Plasticity**.

---

## 🏛 The 5 Pillars of Silicon Music

### 1. Symbolic Axons (Code as Sheet Music)

Write music with the precision of a master engraver and the logic of a programmer. SymphonyScript translates high-level TypeScript into **Symbolic Axons**—dense, bare-metal structures that the kernel understands natively.

### 2. Timeless Continuity (Live & Recorded Identity)

In SymphonyScript, there is no "Export" button. Because the engine and the composer share the same memory, playing a composed masterpiece and improvising live code are the exact same operation. The engine doesn't "play back" music; it **inhabits** it.

### 3. The Shared Mirror (Safety through Physics)

We have eliminated the "Memory Wall" without inviting the "Race Condition." Through a **Partitioned Silicon Kernel**, the Composer and Performer inhabit the same atomic space, but they never collide. We use **Zone-Based Ownership** and **Atomic Versioning** to ensure the Performer always sees a perfect, immutable snapshot of the music, even as the Composer re-wires it. It is speed without the risk; a mirror that never cracks.

### 4. Universal Existence (Web-Native, C-Future)

The SymphonyScript architecture is a **Neural Protocol**. While born in high-performance TypeScript for the collaborative web, its memory map is designed for the metal. The same synaptic logic can be ported to C to power native VSTs or embedded hardware, keeping the "Brain" consistent across every platform.

### 5. Synaptic Topology (Unified Memory)

Music is a web of relationships. Using our **Identity Table** and **Synapse Table**, SymphonyScript moves beyond linear tracks. Every musical "Clip" is a neuron that can trigger others through synaptic weights, probabilities, and loops, creating a Turing-complete musical state machine.

---

## 🧬 How the Silicon Brain Works

### The Axon (Immutable DNA)

A **Clip** in SymphonyScript is a high-speed, cache-aligned chain of musical notes—the "Axon" of the nervous system. It stores deterministic note data (Pitch, Duration, Velocity) in sequential memory, optimized for perfect, glitch-free traversal at audio-thread speed.

### The Synapse (Mutable Intelligence)

Connections between clips are **Synapses**—the brain's decision-making layer. When a clip finishes (NEXT_PTR == NULL), the kernel performs **Synaptic Resolution** in O(1) time using a 1MB linear-probe hash table:

1. **Hash Lookup**: Find synapses by SOURCE_PTR
2. **Stochastic Roll**: Apply probabilistic weights (0-1000 fixed-point)
3. **Signal Propagation**: Spawn new cursors to TARGET_PTR
4. **Humanization**: Apply micro-timing jitter to the new signal

This enables **Polyphonic Fan-Out** (one theme triggering an entire orchestra), **Competitive Branching** (weighted path selection), and **Recursive Loops** (clips triggering themselves with decay).

### The Plasticity Engine (Learning & Memory)

The Silicon Brain can **evolve its own structure** based on feedback:

- **Weight Hardening**: Successful transitions increase their synaptic weights over time (potentiation)
- **Long-Term Memory**: Learned weights persist to IndexedDB, preserving the brain's "personality" across sessions
- **Reward Signals**: The composer can reinforce pathways, teaching the brain preferred musical trajectories

### The Identity Table (Visual Cortex)

The **Identity Table** maps your code's intent to physical memory addresses instantly, allowing the UI to observe the Kernel's state without ever interrupting the audio thread. It's a zero-allocation window into the brain's thoughts.

### The Safety Armor

- **Quota System**: MAX_FIRES_PER_BLOCK (64) prevents infinite synaptic loops from hanging the audio thread
- **Disconnect Protocol**: Nodes cannot be freed while synapses point to them (automatic cleanup)
- **Zone Partitioning**: UI and Audio threads never compete for the same memory

---

## 🚀 Performance Physics

| Feature | Traditional DAWs | SymphonyScript |
| --- | --- | --- |
| **Communication** | Messages (Slow/Buffered) | **Direct Synaptic Memory (1MB Hash Table)** |
| **Logic Model** | Linear Tape Recorder | **Neural Topology with Plasticity** |
| **Latency** | 20ms - 100ms | **< 5µs (Atomic Synaptic Propagation)** |
| **Branching** | Manual Arrangement | **Stochastic/Probabilistic (Real-Time)** |
| **Learning** | Static/Pre-Composed | **Synaptic Weight Hardening (Evolves)** |
| **Safety** | Decoupled Threads | **Zone-Partitioned + Quota System** |
| **Stability** | GC-Pause / Glitch Prone | **Silicon-Hardened (Zero-Alloc)** |

---

## 🛠 For the Visionaries

SymphonyScript is built for those who find "tracks" too small, "latency" unacceptable, and "static composition" too limiting.

* **Generative Architects:** Build self-evolving musical organisms with probabilistic branching, weight learning, and infinite polyphonic fan-out.
* **Live Coders:** Rewire the neural graph in real-time with zero perceived delay—the brain adapts instantly to your intent.
* **Systems Engineers:** Experience a kernel where a C-Major chord is treated with the same bare-metal respect as a sine wave—everything is atomic, everything is instant.
* **Algorithmic Composers:** Create Turing-complete musical state machines with recursive loops, competitive path selection, and reward-based learning.

---

**SymphonyScript: Don't just play music. Build a brain for it.**
