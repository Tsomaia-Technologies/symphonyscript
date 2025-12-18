# RFC-036: Dynamic Audio Buffer Allocation

**Status:** Proposed
**Target:** `packages/live` / `packages/core`
**Driver:** Audio Engine Stability
**Dependencies:** [RFC-035]

## 1. The Problem
RFC-035 gives us the precise timestamp where the last *musical event* (NoteOff) occurs. However, audio does not stop when the MIDI note releases.
* **Release Phases:** Synthesizers have envelope release times (ADSR).
* **Time-Based Effects:** Reverb and Delay effects continue generating sound long after the source event stops.

If we allocate an `OfflineAudioContext` based exactly on the duration from RFC-035, the audio file will clip abruptly at the end, cutting off reverb tails. This is a "musical defect."

## 2. The Solution: `BufferAllocator` with Tail Heuristics
We will implement a `BufferAllocator` service that consumes the output of RFC-035's `computeDuration` and applies configurable "Tail Padding" before calculating the final `Float32Array` size.

### Mathematical Definition
$$
T_{total} = T_{musical} + T_{tail}
$$
$$
N_{frames} = \lceil T_{total} \times R_{sample} \rceil
$$

Where:
* $T_{musical}$: Result from `computeDuration` (RFC-035).
* $T_{tail}$: A configurable padding buffer (default: 2.0s or derived from effect settings).
* $R_{sample}$: The target sample rate (usually 44100 or 48000).

## 3. Implementation Specification

**New File:** `packages/core/src/runtime/BufferAllocator.ts`

```typescript
import { computeDuration } from '../compiler/analysis/duration'; // RFC-035
import { ClipNode } from '../clip/types';
import { TempoMap } from '../compiler/pipeline/tempo-map';

export interface AllocationStrategy {
  /**
   * Extra time in seconds to append to the track for reverb/release tails.
   * Default: 2.0
   */
  tailSeconds?: number;
  
  /**
   * The audio sample rate.
   * Default: 44100
   */
  sampleRate?: number;
}

export interface BufferAllocation {
  /** The calculated duration in seconds (including tail) */
  durationSeconds: number;
  
  /** The exact number of frames to allocate for the buffer */
  totalFrames: number;
  
  /** The exact musical end time (useful for looping) */
  musicalEndSeconds: number;
}

/**
 * Calculates the necessary buffer size for an OfflineAudioRender.
 */
export function calculateBufferRequirements(
  clip: ClipNode,
  bpm: number,
  options: AllocationStrategy = {}
): BufferAllocation {
  
  const sampleRate = options.sampleRate || 44100;
  const tail = options.tailSeconds !== undefined ? options.tailSeconds : 2.0;

  // 1. Get Deterministic Musical Duration (RFC-035)
  const musicalDuration = computeDuration(clip, bpm, sampleRate);

  // 2. Apply Safety Padding
  // We strictly prevent zero-length buffers which crash WebAudio
  const finalDuration = Math.max(0.1, musicalDuration + tail);

  // 3. Calculate Frames (Ceiling to ensure we don't drop the last sub-sample)
  const frames = Math.ceil(finalDuration * sampleRate);

  return {
    durationSeconds: finalDuration,
    totalFrames: frames,
    musicalEndSeconds: musicalDuration
  };
}

Markdown

# RFC-036: Dynamic Audio Buffer Allocation

**Status:** Proposed
**Target:** `packages/live` / `packages/core`
**Driver:** Audio Engine Stability
**Dependencies:** [RFC-035]

## 1. The Problem
RFC-035 gives us the precise timestamp where the last *musical event* (NoteOff) occurs. However, audio does not stop when the MIDI note releases.
* **Release Phases:** Synthesizers have envelope release times (ADSR).
* **Time-Based Effects:** Reverb and Delay effects continue generating sound long after the source event stops.

If we allocate an `OfflineAudioContext` based exactly on the duration from RFC-035, the audio file will clip abruptly at the end, cutting off reverb tails. This is a "musical defect."

## 2. The Solution: `BufferAllocator` with Tail Heuristics
We will implement a `BufferAllocator` service that consumes the output of RFC-035's `computeDuration` and applies configurable "Tail Padding" before calculating the final `Float32Array` size.

### Mathematical Definition
$$
T_{total} = T_{musical} + T_{tail}
$$
$$
N_{frames} = \lceil T_{total} \times R_{sample} \rceil
$$

Where:
* $T_{musical}$: Result from `computeDuration` (RFC-035).
* $T_{tail}$: A configurable padding buffer (default: 2.0s or derived from effect settings).
* $R_{sample}$: The target sample rate (usually 44100 or 48000).

## 3. Implementation Specification

**New File:** `packages/core/src/runtime/BufferAllocator.ts`

```typescript
import { computeDuration } from '../compiler/analysis/duration'; // RFC-035
import { ClipNode } from '../clip/types';
import { TempoMap } from '../compiler/pipeline/tempo-map';

export interface AllocationStrategy {
  /**
   * Extra time in seconds to append to the track for reverb/release tails.
   * Default: 2.0
   */
  tailSeconds?: number;
  
  /**
   * The audio sample rate.
   * Default: 44100
   */
  sampleRate?: number;
}

export interface BufferAllocation {
  /** The calculated duration in seconds (including tail) */
  durationSeconds: number;
  
  /** The exact number of frames to allocate for the buffer */
  totalFrames: number;
  
  /** The exact musical end time (useful for looping) */
  musicalEndSeconds: number;
}

/**
 * Calculates the necessary buffer size for an OfflineAudioRender.
 */
export function calculateBufferRequirements(
  clip: ClipNode,
  bpm: number,
  options: AllocationStrategy = {}
): BufferAllocation {
  
  const sampleRate = options.sampleRate || 44100;
  const tail = options.tailSeconds !== undefined ? options.tailSeconds : 2.0;

  // 1. Get Deterministic Musical Duration (RFC-035)
  const musicalDuration = computeDuration(clip, bpm, sampleRate);

  // 2. Apply Safety Padding
  // We strictly prevent zero-length buffers which crash WebAudio
  const finalDuration = Math.max(0.1, musicalDuration + tail);

  // 3. Calculate Frames (Ceiling to ensure we don't drop the last sub-sample)
  const frames = Math.ceil(finalDuration * sampleRate);

  return {
    durationSeconds: finalDuration,
    totalFrames: frames,
    musicalEndSeconds: musicalDuration
  };
}

## 4. Integration with Runtime

When the user requests a "Download WAV" or "Offline Render":

```typescript
// Pseudocode for render pipeline
const specs = calculateBufferRequirements(myClip, 120, { tailSeconds: 3.0 });

// Secure Allocation
const context = new OfflineAudioContext(2, specs.totalFrames, 44100);

// ... Schedule events ...

// Start Rendering
context.startRendering().then((buffer) => {
    // buffer.length is guaranteed to hold the full song + reverb tail
});
```

##5. Future Optimization: Effect introspection

In the future (post-RFC-018 Effects System), computeDuration could theoretically traverse the effect chain (e.g., look at Reverb.decayTime) to automatically calculate the optimal tailSeconds, rather than relying on a static default. For now, a manual override is sufficient.
