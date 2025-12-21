# Tempo Integration: Mathematical Proofs

This directory contains formal mathematical derivations for SymphonyScript's tempo integration system.

## The Problem

In music, tempo (BPM) can change over time. To convert from **beats** to **seconds**, we must integrate:

$$T = \int_0^B \frac{60}{\text{BPM}(t)} \, dt$$

Where:
- $T$ = elapsed time in seconds
- $B$ = number of beats
- $\text{BPM}(t)$ = tempo at beat position $t$
- Factor of 60 converts beats-per-minute to beats-per-second

## Why Analytical Solutions?

Numerical integration (e.g., Simpson's rule) works but:
- Introduces approximation error
- Requires many iterations for accuracy
- Slower for real-time applications

SymphonyScript uses **closed-form analytical solutions** where possible, falling back to numerical methods only for edge cases.

## Document Index

| File | Curve Type | Complexity |
|------|------------|------------|
| [01-LINEAR.md](01-LINEAR.md) | Linear tempo ramp | Simple |
| [02-EASE-IN.md](02-EASE-IN.md) | Quadratic acceleration | Moderate |
| [03-EASE-OUT.md](03-EASE-OUT.md) | Quadratic deceleration | Moderate |
| [04-EASE-IN-OUT.md](04-EASE-IN-OUT.md) | Piecewise combination | Composite |
| [05-EDGE-CASES.md](05-EDGE-CASES.md) | Singularities & guards | Critical |
| [06-NUMERICAL-FALLBACK.md](06-NUMERICAL-FALLBACK.md) | Simpson's rule | Fallback |

## Notation Conventions

| Symbol | Meaning |
|--------|---------|
| $s$ | Starting BPM |
| $e$ | Ending BPM |
| $B$ | Beat duration (number of beats) |
| $t$ | Beat position (0 to B) |
| $\tau$ | Normalized position $t/B$ (0 to 1) |
| $T$ | Elapsed time in seconds |

## Implementation Reference

These proofs correspond to the implementation in:

```
src/compiler/tempo.ts
├── ANALYTICAL_INTEGRALS['linear']
├── ANALYTICAL_INTEGRALS['ease-in']
├── ANALYTICAL_INTEGRALS['ease-out']
├── ANALYTICAL_INTEGRALS['ease-in-out']
└── integrateNumerical()
```

## Verification

Each proof includes test vectors that can be verified against the implementation:

```typescript
import { integrateTempo } from './src/compiler/tempo'

// From 01-LINEAR.md
expect(integrateTempo(120, 60, 4, 'linear')).toBeCloseTo(2.773, 3)
```






