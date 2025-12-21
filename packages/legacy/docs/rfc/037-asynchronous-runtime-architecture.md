# RFC-037: Asynchronous Runtime Architecture (The "Ghost" Protocol)

**Status**: Proposed  
**Target**: `packages/core` (Protocol Definition), `packages/runtime-*` (Implementation)  
**Driver**: Performance & Backend Agnosticism  
**Dependencies**: [RFC-026.9 Incremental Compilation](026.9-incremental-compilation.md)

---

## 1. The Philosophy

SymphonyScript Core is a **Compiler**, not a **Player**.

Its job is to transform Code into Data (`CompiledEvent[]`).

It should not care *when* or *how* that data is played.

Currently, our `runtime-webaudio` scheduler runs on the same thread as the compiler. This couples the "Thinking" (Compilation) with the "Doing" (Playback). If the Thinker thinks too hard, the Doer trips.

---

## 2. The Solution: The Ghost Protocol

We introduce a strict boundary between the **Compiler Context** (Main Thread / Worker / Child Process) and the **Audio Context** (Audio Thread / External Engine).

Communication occurs strictly via a **Single Producer, Single Consumer (SPSC) Ring Buffer**.

### 2.1 The Architecture

```mermaid
[ User Code ] 

      |

      v

[ Compiler Thread ] <--- ( "Ghost" Replicas )

      |

      | (1. Compile to Binary/Struct)

      |

[ Shared Ring Buffer ]  <=== (Lock-Free Transport) ===> [ Audio Thread / Engine ]

      |                                                         |

      | (2. Write Events)                                       | (3. Read & Schedule)

      v                                                         v

[ Memory Block ]                                         [ Synthesizer / OSC Sender ]
```

---

## 3. Implementation: Web Audio (The Reference Implementation)

In the browser, this manifests as the "Off-Main-Thread" architecture.

### 3.1 Components

- **The Host (Main Thread)**: Handles UI, Editor, and sends source code strings to the Worker.
- **The Compiler (Web Worker)**: Runs `SymphonyScript.compile()`. It holds the state (incremental cache).
- **The Transport (SharedArrayBuffer)**: A circular buffer allocated in shared memory.
- **The Renderer (AudioWorklet)**: Reads from the buffer every quantum (128 frames) and triggers the synth.

### 3.2 The Ring Buffer Protocol

We cannot pass JS Objects (`{ note: 'C4' }`) to the Audio Thread because Garbage Collection is forbidden there. We must serialize to binary.

#### Buffer Layout (Struct)

```c
struct Event {
  uint32_t timestamp;  // Frame number relative to loop start
  uint8_t  type;       // 0=NoteOn, 1=NoteOff, 2=Control
  uint8_t  pitch;      // MIDI Pitch
  uint8_t  velocity;   // MIDI Velocity
  uint32_t duration;   // Duration in frames (for internal scheduling)
  uint32_t voiceId;    // MPE Voice ID
}
```

### 3.3 TypeScript Interface (Core)

```typescript
// packages/core/src/runtime/ring-buffer.ts
export class RingBufferWriter {
  private buffer: Int32Array;
  private writePointer: number = 0;
  private size: number;

  constructor(sharedBuffer: SharedArrayBuffer) {
    this.buffer = new Int32Array(sharedBuffer);
    this.size = (this.buffer.length - 2) / EVENT_STRUCT_SIZE; 
    // Header: [0]=ReadPtr, [1]=WritePtr
  }

  // Called by the Compiler (Worker)
  write(event: CompiledEvent): boolean {
    const readPointer = Atomics.load(this.buffer, 0);
    const nextWrite = (this.writePointer + 1) % this.size;
    
    if (nextWrite === readPointer) {
      return false; // Buffer Full - Backpressure!
    }

    // Serialize Event to Shared Memory
    const offset = 2 + (this.writePointer * EVENT_STRUCT_SIZE);
    this.buffer[offset + 0] = event.startFrames;
    this.buffer[offset + 1] = event.type;
    this.buffer[offset + 2] = event.pitch;
    // ... etc

    // Commit
    Atomics.store(this.buffer, 1, nextWrite); 
    this.writePointer = nextWrite;
    return true;
  }
}
```

---

## 4. Agnostic Generalization

This model proves that core is agnostic because Core never touches the Audio API. It only writes to a generic Buffer Writer.

### Scenario A: SuperCollider Backend

- **Compiler**: Node.js Child Process.
- **Transport**: UDP Socket (OSC).
- **Adapter**: The `RingBufferWriter` is replaced by an `OscStreamWriter`.
- **Result**: SymphonyScript compiles to OSC bundles: `/s_new default 1001 1 0 freq 440`.

### Scenario B: Csound / C++ Backend

- **Compiler**: Embedded JS Engine (QuickJS).
- **Transport**: FFI (Foreign Function Interface) Pointer.
- **Adapter**: Core writes directly to a `struct*` pointer provided by the C++ host.

---

## 5. Migration Strategy

- **Phase 1 (Core)**: Define the `BinaryEventSerializer` in `packages/core`. This ensures all runtimes speak the same binary language.
- **Phase 2 (Web)**: Create `packages/runtime-web-worker`. Move the Compiler there. Implement `SharedArrayBuffer` support.
- **Phase 3 (Live)**: Update `LiveSession` to accept a `RuntimeAdapter` interface instead of assuming direct function calls.

---

## 6. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
