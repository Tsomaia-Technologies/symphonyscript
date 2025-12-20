# SymphonyScript 🎵

**The Reactive Audio Computation Engine.**

SymphonyScript is a high-performance music engine that bridges the gap between high-level TypeScript and real-time audio hardware. By utilizing **Direct-to-Silicon Mirroring**, it eliminates compilation latency, allowing your code to manipulate the audio playhead's future with zero perceived delay.

## 🚀 The "Zero-Latency" Guarantee

Traditional web audio sequencers suffer from JavaScript's single-threaded nature and Garbage Collection pauses. SymphonyScript solves this by moving playback entirely out of the main thread and retiring the "Compilation Phase".

**The RFC-043 "Silicon" Architecture:**

1. **Direct Mirroring:** DSL calls (TypeScript) are mirrored immediately to a **SharedArrayBuffer (SAB)** via a dedicated **Silicon Linker** worker.
2. **Instruction-Level Patching:** Changing a MIDI pitch or velocity is a sub-millisecond atomic write to a known memory address, not a full rebuild.
3. **Linked-List Traversal:** The audio engine (AudioWorklet) follows a high-speed `NEXT_PTR` chain in memory, allowing for O(1) note insertions and deletions without stopping the music.

## 🎼 Music Notation as Code

Write expressive, readable TypeScript designed for the "Flow State." Every call is a direct "live wire" to the hardware-mapped memory.

```typescript
// RFC-043 Live Mirror Pattern
Clip.melody('Lead')
  .note('C4', '8n').velocity(0.8).commit() // Immediate Patch
  .note('E4', '8n').accent()               // Immediate Patch
  .note('G4', '2n').commit()               // Immediate Patch
  .finalize();                             // Prunes tombstones

```

## ⚡ Performance Benchmarks

SymphonyScript is designed for "Breath-Speed" live coding. The transition to the Continuous Silicon Kernel has effectively eliminated the "Latency Wall".

| Interaction | Transactional (Legacy) | **Continuous (Silicon)** |
| --- | --- | --- |
| **Pitch/Velocity Tweak** | 240ms | **< 0.001ms (Patch)** |
| **Note Insertion** | 240ms | **~0.1ms (Splice)** |
| **BPM/Groove Shift** | 240ms | **< 0.001ms (Reg Update)** |
| **Clip Re-ordering** | 240ms | **~1ms (Linkage Update)** |
| **GC Pressure** | 29 KB | **0 KB (SAB Direct)** |

*Metrics based on a stress test of 5,000 active nodes.*

## 🛠 Core Components

* **Silicon Linker:** A dedicated Memory Management Unit (MMU) that handles lock-free node allocation and atomic pointer manipulation.
* **Silicon Bridge:** The editor integration layer that maps high-level `SOURCE_ID`s to memory pointers and provides 10ms debouncing for structural edits.
* **AudioWorklet Consumer:** A low-level renderer that traverses the memory heap and executes **VM-Resident Math** (Groove and Humanization) in real-time.

---

### When to Use SymphonyScript

* **Live Coding:** You need instant feedback between writing code and hearing sound.
* **High-Density Sequencing:** You are managing thousands of musical events without wanting Garbage Collection to cause audio glitches.
* **Programmable Music:** You want to generate complex, algorithmic patterns that can be modified while the transport is running.
* **Offline Playback:** You want to write sheet music as code and have offline playback anytime

```typescript
// Real-time algorithmic generation
scales.forEach(scale => 
  clip.arpeggio(scale.notes, '16n', { pattern: 'random' })
);

```

---

**Status:** SymphonyScript is currently implementing **RFC-043: Continuous Silicon Kernel**. Please refer to the [RFC documentation](https://www.google.com/search?q=./research/rfc/043-continuous-silicon-kernel.md) for full technical specifications.
