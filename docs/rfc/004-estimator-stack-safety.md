# RFC-004: Estimator Stack Safety

## 1. Context

SymphonyScript's recursive expansion logic (`expandClip`) is prone to:
1.  **Stack Overflow**: deeply nested structures (e.g. 1000+ recursions)
2.  **Memory Exhaustion**: excessive loop cloning
3.  **Infinite Loops**: circular references or accidentally huge repeat counts

## 2. Goals

1.  **Guarantee Safety**: Compiler should never crash with stack overflow.
2.  **Predictability**: Users should know *before* compilation if their clip is too complex.
3.  **Observability**: Provide clear error messages when limits are hit, pointing to the source clip.

## 3. Implementation Details

### 3.1 Iterative Expansion

Replace recursive `expand()` with a stack-based iterative loop.

**Mechanism**:
- Maintain an explicit `stack` of frames.
- Each frame tracks: `operations`, `pc` (program counter), `depth`.
- Loop unrolling pushes new frames instead of making recursive calls.

### 3.2 Hard Limits

Enforce strict bounds during expansion:

| Limit | Default | Error Code |
|-------|---------|------------|
| Max Depth | 1000 | `ExpansionError(limitType='depth')` |
| Max Loops | 10000 | `ExpansionError(limitType='loops')` |
| Max Ops | 100000 | `ExpansionError(limitType='operations')` |

### 3.3 Heuristic Estimation

Introduce `estimateExpansion(clip)` utility.
- Walks the tree *without* expanding fully.
- Multiplies operation counts by loop factors.
- Returns `estimatedMemoryMB` and `estimatedOperations`.
- Adds warnings for "risky" patterns (e.g. loops > 100 iterations).

## 4. API Changes

```typescript
// src/compiler/pipeline/expand.ts

export interface ExpansionLimits {
  maxDepth?: number
  maxLoopExpansions?: number
  maxOperations?: number
}

export function expandClip(clip: ClipNode, limits?: ExpansionLimits): ExpandedSequence
```

```typescript
// src/compiler/pipeline/estimate.ts

export interface ExpansionEstimate {
  estimatedOperations: number
  estimatedMemoryMB: number
  warnings: string[]
}

export function estimateExpansion(clip: ClipNode): ExpansionEstimate
```

## 5. Verification Plan

- [x] Verify deep recursion (10,000 nested items) throws `ExpansionError` instead of crashing.
- [x] Verify massive loops (1M iterations) hits operation limit.
- [x] Verify `estimateExpansion` is accurate within 1 order of magnitude.
