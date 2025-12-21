# RFC-035: Deterministic Duration Analysis (The "Dry Run" Protocol)

**Status:** Proposed
**Target:** `packages/core`
**Driver:** Optimization & Stability

## 1. The Problem
Currently, to determine the duration of a `ClipNode` in seconds (absolute time), we must run the entire pipeline:
`Expand` -> `Timing` -> `Coalesce` -> `Emit`.

This is computationally expensive and memory-intensive.
* **Risk:** If we need to allocate an `OfflineAudioContext` buffer for rendering, we essentially have to "compile twice" (once to find the length, once to fill the buffer), or guess and risk overwrites/underruns.
* **The "Illegal" Fix:** Trying to calculate seconds during `Expand` (Rejected because it ignores Tempo/Automation).

## 2. The Solution: `computeDuration()`
We will introduce a lightweight "Side-Channel" pipeline that calculates the temporal bounds of a clip *without* generating audio events or resolving complex ties.

This utility will sit alongside the main compiler.

### Architectural Logic
We can determine the precise end time of a track by effectively performing a "Sparse Expansion." We only care about the *last* event in time.

**The Pipeline Shortcut:**
1.  **Structure Scan:** Run `expandClip`, but only track the `offset + duration` of operations. Ignore pitch, velocity, and expression.
2.  **Timing Resolution:** Run `computeTiming` on this skeleton.
3.  **Tempo Projection:** Apply `buildTempoMap` to the timing result.
4.  **Result:** We get `max(seconds)` accurately, accounting for Tempo Ramps, *before* we allocate a single byte of Audio Buffer.

## 3. Implementation Specification

**New File:** `packages/core/src/compiler/analysis/duration.ts`

```typescript
import { ClipNode } from '../../clip/types';
import { expandClip } from '../pipeline/expand';
import { computeTiming } from '../pipeline/timing';
import { buildTempoMap } from '../pipeline/tempo-map';

/**
 * Calculates the exact duration of a clip in seconds without
 * performing full event coalescence or emission.
 * * COST: Low (skips heavy tie-resolution logic)
 * * ACCURACY: Sample-Accurate (respects Tempo Ramps)
 */
export function computeDuration(
  clip: ClipNode, 
  bpm: number, 
  sampleRate: number = 44100
): number {
  
  // 1. Structural Expansion (Fast)
  // We don't need to validate limits here if we assume the clip is valid,
  // or we can use the same limits as the main pipeline.
  const expanded = expandClip(clip, { 
    maxDepth: 100, 
    maxOperations: 100000 
  });

  // 2. Beat Timing
  // We get absolute beats.
  const timed = computeTiming(expanded, clip.timeSignature || '4/4');

  // 3. Find the "Last Beat"
  // We don't need to iterate everything. We just need the max end time.
  // Since 'timed' is usually sorted by start time, we scan the end.
  let maxBeat = 0;
  for (const op of timed) {
    if (op.start + op.duration > maxBeat) {
      maxBeat = op.start + op.duration;
    }
  }

  // 4. Tempo Projection
  // We build the map solely to project that one "maxBeat" point.
  // Note: If there are tempo changes inside the clip, buildTempoMap handles them.
  const tempoMap = buildTempoMap(timed, bpm, { sampleRate });
  
  // 5. Convert Beat -> Seconds
  return tempoMap.beatsToSeconds(maxBeat);
}
