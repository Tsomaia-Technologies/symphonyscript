# RFC-018: The Effects System (Inserts & Sends)

**Status**: Draft
**Priority**: High
**Estimated Effort**: 2-3 days
**Breaking Change**: Yes (removes `sendBus()`, replaces `buses` array)

---

## 1. Problem Statement

SymphonyScript currently has no effect processing system. Professional audio production requires:

1. **Insert Effects**: Serial processing on individual tracks (compression, EQ, distortion)
2. **Send Effects**: Parallel processing via shared buses (reverb, delay)

### Current Limitation

```typescript
// No way to add effects to a track
Track.from(clip, Instrument.synth("Lead"));

// Legacy buses exist but only as routing metadata, no actual effects
session().sendBus("reverb", "Hall Reverb"); // ← BEING REMOVED
```

---

## 2. Breaking Changes

> [!CAUTION]
> This RFC introduces breaking changes to clean up the API.

### 2.1 Removed: `sendBus()`

The legacy `sendBus(id, name)` method is **deleted**:

```typescript
// ❌ OLD (removed)
session().sendBus("reverb", "Hall Reverb");

// ✅ NEW (replacement)
session().bus("reverb", "reverb", { decay: 2.5 });
```

**Rationale**: `sendBus()` only reserved a bus ID with a display name. It carried no effect configuration and was essentially metadata. The new `.bus()` method fully defines the effect.

### 2.2 Removed: Legacy `buses` Array

The `SessionNode.buses` property (type `BusConfig[]`) is replaced by `effectBuses` (type `EffectBusConfig[]`).

```typescript
// ❌ OLD SessionNode
interface SessionNode {
  buses?: BusConfig[]; // REMOVED
}

// ✅ NEW SessionNode
interface SessionNode {
  effectBuses?: EffectBusConfig[]; // Effect definitions
}
```

### 2.3 Migration Guide

| Old Code                            | New Code                                        |
| ----------------------------------- | ----------------------------------------------- |
| `session().sendBus('verb', 'Hall')` | `session().bus('verb', 'reverb', { decay: 2 })` |
| `session.buses`                     | `session.effectBuses`                           |

---

## 3. Audio Routing Concepts

### 3.1 Insert Effects (Series Processing)

Signal flows through each effect in sequence:

```
┌─────────────────────────────────────────────────────────────┐
│                         TRACK                                │
│                                                              │
│  Instrument ─► [Insert 1] ─► [Insert 2] ─► Fader ─► Output  │
│     🎹          Delay        Distortion    🎚️       🔊      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Use Cases**:

- Compression on drums
- Distortion on bass
- EQ on vocals
- Character effects (unique to track)

### 3.2 Send Effects (Parallel Processing)

Signal is split and sent to shared buses:

```
┌─────────────────────────────────────────────────────────────┐
│                        SESSION                               │
│                                                              │
│  Track 1 ──┬──► Fader ──► Master                            │
│            │                                                 │
│            └──► Send (30%) ──► [Reverb Bus] ──► Master      │
│                                                              │
│  Track 2 ──┬──► Fader ──► Master                            │
│            │                                                 │
│            └──► Send (50%) ──► [Reverb Bus] ──► Master      │
│                                                              │
│  Reverb Bus: 100% Wet                                        │
└─────────────────────────────────────────────────────────────┘
```

**Use Cases**:

- Shared reverb (multiple tracks, one instance)
- Shared delay (saves CPU)
- Parallel compression

---

## 4. API Design

### 4.1 Effect Definitions

```typescript
// src/effects/types.ts

export type EffectType =
  | "delay"
  | "reverb"
  | "distortion"
  | "filter"
  | "compressor"
  | "eq"
  | "chorus"
  | "custom";

export interface BaseEffectParams {
  mix?: number; // Dry/wet (0-1), default 1.0 for sends
  bypass?: boolean; // Bypass flag
}

export interface DelayParams extends BaseEffectParams {
  time: NoteDuration | number; // Tempo-synced ('8n') or ms (250)
  feedback?: number; // 0-1
  pingPong?: boolean; // Stereo ping-pong
}

export interface ReverbParams extends BaseEffectParams {
  decay?: number; // Seconds (0.5-10)
  size?: number; // Room size (0-1)
  preDelay?: number; // Ms before reverb onset
  damping?: number; // High-frequency damping (0-1)
}

export interface DistortionParams extends BaseEffectParams {
  drive?: number; // 0-1 (amount of distortion)
  tone?: number; // 0-1 (low-high balance)
  type?: "soft" | "hard" | "fuzz" | "tube";
}

export interface FilterParams extends BaseEffectParams {
  type: "lowpass" | "highpass" | "bandpass" | "notch";
  frequency: number; // Hz
  resonance?: number; // Q factor (0.1-20)
}

export interface CompressorParams extends BaseEffectParams {
  threshold?: number; // dB (-60 to 0)
  ratio?: number; // 1:1 to 20:1
  attack?: number; // ms
  release?: number; // ms
  makeupGain?: number; // dB
}

export type EffectParams =
  | ({ type: "delay" } & DelayParams)
  | ({ type: "reverb" } & ReverbParams)
  | ({ type: "distortion" } & DistortionParams)
  | ({ type: "filter" } & FilterParams)
  | ({ type: "compressor" } & CompressorParams)
  | { type: "custom"; name: string; params: Record<string, unknown> };
```

### 4.2 Track Insert API

```typescript
// Track-level insert effects (series)
Track.from(clip, synth)
  .insert('delay', { time: '8n', feedback: 0.4 })
  .insert('distortion', { drive: 0.3 })
  .send('reverb', 0.3)

// Fluent chaining
const lead = Track.from(clip, synth)
  .insert('compressor', { threshold: -20, ratio: 4 })
  .insert('eq', { ... })
  .insert('delay', { time: '4n.', feedback: 0.5 })
```

### 4.3 Session Bus API

```typescript
// Define effect buses in session with .bus()
const s = session({ tempo: 120 })
  .bus("verb", "reverb", { decay: 2.5, size: 0.8 })
  .bus("dly", "delay", { time: "8n", feedback: 0.4 })
  .add(
    Track.from(drums, kit).send("verb", 0.1) // 10% to reverb
  )
  .add(
    Track.from(lead, synth)
      .send("verb", 0.4) // 40% to reverb
      .send("dly", 0.2) // 20% to delay
  );
```

### 4.4 Method Signatures

```typescript
// src/session/Track.ts

class Track {
  /**
   * Add an insert effect to the track's signal chain.
   * Effects are processed in order (series).
   */
  insert<T extends EffectType>(type: T, params: EffectParamsFor<T>): Track;

  /**
   * Send signal to an effect bus.
   * Amount is 0-1 (percentage of signal sent).
   */
  send(busId: string, amount: number): Track;
}

// src/session/Session.ts

class Session {
  /**
   * Define an effect bus for parallel processing.
   * All tracks can send to this bus.
   *
   * @param id - Unique bus identifier (used in .send())
   * @param type - Effect type ('reverb', 'delay', etc.)
   * @param params - Effect-specific parameters
   */
  bus<T extends EffectType>(
    id: string,
    type: T,
    params: EffectParamsFor<T>
  ): Session;
}
```

---

## 5. Type System

### 5.1 TrackNode Update

```typescript
// src/session/types.ts

export interface InsertEffect {
  type: EffectType;
  params: EffectParams;
}

export interface SendConfig {
  bus: string; // Bus ID
  amount: number; // 0-1
}

export interface TrackNode {
  // ... existing fields
  inserts?: InsertEffect[];
  sends?: SendConfig[];
}
```

### 5.2 SessionNode Update

```typescript
// src/session/types.ts

export interface EffectBusConfig {
  id: string;
  name?: string;
  type: EffectType;
  params: EffectParams;
}

export interface SessionNode {
  // ... existing fields
  // buses?: BusConfig[]  ← REMOVED
  effectBuses?: EffectBusConfig[]; // NEW
}
```

### 5.3 Manifest Output

```typescript
// src/compiler/types.ts

export interface CompiledOutput {
  manifest: InstrumentManifest;
  timeline: CompiledEvent[];
  meta: SessionMeta;
  routing: AudioRoutingGraph; // NEW
}

export interface AudioRoutingGraph {
  tracks: TrackRouting[];
  buses: BusDefinition[];
}

export interface TrackRouting {
  instrumentId: InstrumentId;
  inserts: CompiledEffect[];
  sends: { busId: string; amount: number }[];
}

export interface BusDefinition {
  id: string;
  effect: CompiledEffect;
}

export interface CompiledEffect {
  type: EffectType;
  params: Record<string, unknown>; // Resolved values (e.g., '8n' → ms)
}
```

---

## 6. Validation Logic

> [!IMPORTANT]
> With `sendBus()` removed, validation is critical. The only way to define a bus is `.bus()`.

### 6.1 Send to Non-Existent Bus

```typescript
Track.from(clip, synth).send("nonexistent", 0.5);
```

**Behavior**: Compile-time warning in `warnings` array:

```typescript
{
  level: 'warning',
  code: 'SEND_TO_UNKNOWN_BUS',
  message: "Track 'Lead' sends to unknown bus 'nonexistent'. Send will be ignored."
}
```

### 6.2 Bus Send Amount Out of Range

```typescript
Track.from(clip, synth).send("reverb", 1.5); // > 1
```

**Behavior**: Clamp to 0-1, emit warning.

### 6.3 Duplicate Bus ID

```typescript
session()
  .bus("verb", "reverb", { decay: 2 })
  .bus("verb", "delay", { time: "8n" }); // Same ID!
```

**Behavior**: Throw error at build time.

### 6.4 Empty Insert Chain

When a track has no insert effects, the signal flows directly from instrument to fader:

```
Instrument → Fader → Output   (no inserts)
Instrument → [Insert 1] → [Insert 2] → Fader → Output   (with inserts)
```

**Runtime handling**:

```typescript
const routing = output.routing.tracks[0];
if (routing.inserts.length === 0) {
  // No processing nodes needed — connect instrument directly to fader/output
  instrument.connect(fader);
} else {
  // Chain insert effects in order
  let chain = instrument;
  for (const insert of routing.inserts) {
    const effect = createEffect(insert);
    chain.connect(effect);
    chain = effect;
  }
  chain.connect(fader);
}
```

### 6.5 Bypass Insert

```typescript
Track.from(clip, synth).insert("delay", { time: "8n", bypass: true });
```

**Behavior**: Effect appears in routing graph but runtime skips it.

---

## 7. Tempo-Synced Delay

Delay time can use `NoteDuration`:

```typescript
Track.from(clip, synth).insert("delay", { time: "8n", feedback: 0.4 });
```

**Resolution at compile time**:

```typescript
// src/compiler/effects-resolver.ts

export function resolveDelayTime(
  time: NoteDuration | number,
  bpm: number
): number {
  if (typeof time === "number") return time;

  // Convert NoteDuration to ms
  const beatsPerMs = 60000 / bpm;
  const beats = durationToBeats(time); // '4n' → 1, '8n' → 0.5
  return beats * beatsPerMs;
}
```

**Example at 120 BPM**:

- `'4n'` → 500ms
- `'8n'` → 250ms
- `'8n.'` → 375ms (dotted)
- `'4t'` → 333ms (triplet)

---

## 8. Implementation Tasks

| #   | Task                       | Files                                    |
| --- | -------------------------- | ---------------------------------------- |
| 1   | **REMOVE sendBus()**       | `src/session/Session.ts`                 |
| 2   | **REMOVE BusConfig usage** | `src/session/types.ts`, imports          |
| 3   | Define effect types        | `src/effects/types.ts` (NEW)             |
| 4   | Update TrackNode type      | `src/session/types.ts`                   |
| 5   | Update SessionNode type    | `src/session/types.ts`                   |
| 6   | Add Track.insert()         | `src/session/Track.ts`                   |
| 7   | Add Track.send()           | `src/session/Track.ts`                   |
| 8   | Add Session.bus()          | `src/session/Session.ts`                 |
| 9   | Create routing resolver    | `src/compiler/routing-resolver.ts` (NEW) |
| 10  | Update compiler output     | `src/compiler/index.ts`                  |
| 11  | Add validation             | `src/validation/session.ts`              |
| 12  | Update existing tests      | Remove sendBus usage                     |
| 13  | Add new tests              | `src/__tests__/effects.test.ts` (NEW)    |

---

## 9. Usage Examples

### 9.1 Minimal (One Track, One Send)

```typescript
const s = session()
  .bus("verb", "reverb", { decay: 2 })
  .add(Track.from(melody, piano).send("verb", 0.3));

compile(s);
// routing.buses = [{ id: 'verb', effect: { type: 'reverb', ... } }]
// routing.tracks[0].sends = [{ busId: 'verb', amount: 0.3 }]
```

### 9.2 Complex (Inserts + Sends)

```typescript
const s = session({ tempo: 140 })
  .bus("room", "reverb", { decay: 1.5, size: 0.5 })
  .bus("slapback", "delay", { time: "16n", feedback: 0.2 })
  .add(
    Track.from(drums, kit)
      .insert("compressor", { threshold: -15, ratio: 6 })
      .send("room", 0.1)
  )
  .add(
    Track.from(bass, bassInst)
      .insert("distortion", { drive: 0.2, type: "tube" })
      .insert("filter", { type: "lowpass", frequency: 2000 })
  )
  .add(
    Track.from(lead, synth)
      .insert("delay", { time: "8n.", feedback: 0.5 }) // Insert delay
      .send("room", 0.4) // Also send to reverb
      .send("slapback", 0.3)
  );
```

### 9.3 Compiled Routing Output

```json
{
  "routing": {
    "tracks": [
      {
        "instrumentId": "drums_kit",
        "inserts": [
          { "type": "compressor", "params": { "threshold": -15, "ratio": 6 } }
        ],
        "sends": [{ "busId": "room", "amount": 0.1 }]
      },
      {
        "instrumentId": "bass_bassInst",
        "inserts": [
          { "type": "distortion", "params": { "drive": 0.2, "type": "tube" } },
          {
            "type": "filter",
            "params": { "type": "lowpass", "frequency": 2000 }
          }
        ],
        "sends": []
      },
      {
        "instrumentId": "lead_synth",
        "inserts": [
          { "type": "delay", "params": { "time": 321, "feedback": 0.5 } }
        ],
        "sends": [
          { "busId": "room", "amount": 0.4 },
          { "busId": "slapback", "amount": 0.3 }
        ]
      }
    ],
    "buses": [
      {
        "id": "room",
        "effect": { "type": "reverb", "params": { "decay": 1.5, "size": 0.5 } }
      },
      {
        "id": "slapback",
        "effect": {
          "type": "delay",
          "params": { "time": 107, "feedback": 0.2 }
        }
      }
    ]
  }
}
```

---

## 10. Testing Strategy

```typescript
describe("Effects System", () => {
  describe("Track Inserts", () => {
    it("adds insert to track routing");
    it("preserves insert order");
    it("resolves delay time to ms");
  });

  describe("Session Buses", () => {
    it("defines effect bus with .bus()");
    it("connects track to bus via .send()");
    it("warns on send to unknown bus");
    it("clamps send amount to 0-1");
    it("throws on duplicate bus ID");
  });

  describe("Compiled Routing", () => {
    it("outputs routing graph in compile result");
    it("resolves tempo-synced delay times");
    it("includes all tracks and buses");
  });

  describe("Breaking Changes", () => {
    it("sendBus() method does not exist");
    it("legacy buses property is not used");
  });
});
```

---

## 11. Approval

- [ ] Approved by maintainer
