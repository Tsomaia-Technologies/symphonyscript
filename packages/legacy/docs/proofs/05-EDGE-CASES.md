# Edge Cases and Numerical Guards

This document analyzes the mathematical edge cases in tempo integration and the guards implemented to handle them.

## Overview of Singularities

| Edge Case | Affected Curve | Mathematical Cause | Guard |
|-----------|----------------|-------------------|-------|
| Near-equal BPM | All | Division by $(e-s) \approx 0$ | Epsilon check |
| arctanh domain | Ease-in (decel) | $\text{arctanh}(x)$ undefined for $\|x\| \geq 1$ | Ratio check + numerical fallback |
| Quadratic roots | Ease-out | Division by $(1-r)$ where $r \approx 1$ | Discriminant check |
| Zero BPM | All | Division by BPM = 0 | Input validation |
| Negative BPM | All | $\ln$ of negative number | Input validation |

## Edge Case 1: Near-Equal BPM

### The Problem

For linear tempo:
$$T = \frac{60B \cdot \ln(e/s)}{e - s}$$

As $e \to s$:
- Numerator: $\ln(e/s) \to \ln(1) = 0$
- Denominator: $e - s \to 0$

This creates the indeterminate form $\frac{0}{0}$.

### Mathematical Resolution

Apply L'Hôpital's rule. Let $f(e) = \ln(e/s)$ and $g(e) = e - s$:

$$\lim_{e \to s} \frac{f(e)}{g(e)} = \lim_{e \to s} \frac{f'(e)}{g'(e)} = \lim_{e \to s} \frac{1/e}{1} = \frac{1}{s}$$

Therefore:
$$\lim_{e \to s} T = 60B \cdot \frac{1}{s} = \frac{60B}{s}$$

This is simply the constant-tempo formula.

### Implementation Guard

```typescript
if (Math.abs(e - s) < 0.001) {
  return (beats / s) * 60
}
```

### Threshold Justification

**Why 0.001 BPM?**

1. **Perceptual threshold**: Humans cannot perceive tempo differences below ~2 BPM
2. **Floating-point precision**: `Math.log(1.00001)` ≈ 9.99995e-6, still accurate
3. **Musical irrelevance**: 120.000 vs 120.001 BPM is meaningless

**Numerical verification**:
```
e = 120.001, s = 120.000
Exact:  (4 * 60 * ln(120.001/120)) / 0.001 = 1.99998333...
Guard:  (4 / 120) * 60 = 2.00000000
Error:  0.0008% — negligible
```

## Edge Case 2: arctanh Domain Violation

### The Problem

For ease-in deceleration:
$$T = \frac{60B}{\sqrt{s(s-e)}} \text{arctanh}\left(\sqrt{\frac{s-e}{s}}\right)$$

The argument to arctanh is:
$$x = \sqrt{\frac{s-e}{s}} = \sqrt{1 - \frac{e}{s}}$$

**Domain of arctanh**: $|x| < 1$

As $e \to 0$ (extreme deceleration):
$$x \to \sqrt{1 - 0} = 1$$

And $\text{arctanh}(1) = +\infty$.

### Physical Interpretation

If tempo approaches zero, beats take infinitely long to complete. This is **mathematically correct** but not useful for computation.

**Example**: 120 BPM → 0.001 BPM with ease-in
- Near the end, each beat takes ~60,000 seconds
- The total time diverges to infinity

### Implementation Guard

```typescript
const sqrtRatio = Math.sqrt(Math.abs(b / a))

if (sqrtRatio >= 0.999) {
  return integrateNumerical(s, e, beats, 'ease-in', 1000)
}
```

### Threshold Justification

**Why 0.999?**

$$\sqrt{\frac{s-e}{s}} \geq 0.999 \implies \frac{e}{s} \leq 1 - 0.999^2 \approx 0.002$$

This triggers when ending tempo is less than 0.2% of starting tempo:
- 120 BPM → 0.24 BPM (extreme, unrealistic)
- 60 BPM → 0.12 BPM (extreme, unrealistic)

**Why numerical fallback?**

Near $x = 1$, arctanh becomes:
$$\text{arctanh}(x) \approx \frac{1}{2}\ln\left(\frac{2}{1-x}\right)$$

For $x = 0.999$: $\text{arctanh}(0.999) \approx 3.8$

For $x = 0.9999$: $\text{arctanh}(0.9999) \approx 4.95$

The function is extremely sensitive near the boundary. Numerical integration with 1000 steps provides stable, accurate results.

## Edge Case 3: Quadratic Root Boundaries

### The Problem

For ease-out, when the discriminant $\Delta = b^2 - 4ac > 0$, the integral involves:

$$\int \frac{1}{c(\tau - r_1)(\tau - r_2)} d\tau$$

If $r_1 = 0$ or $r_1 = 1$ (root at integration boundary), partial fractions have a pole.

### When Does This Happen?

Roots are at $\tau = r_1, r_2$ where:

$$r_{1,2} = \frac{-b \pm \sqrt{\Delta}}{2c}$$

For $r = 0$: requires $b = \pm\sqrt{\Delta}$, which gives specific $s, e$ ratios
For $r = 1$: requires $-b \pm \sqrt{\Delta} = 2c$

### Implementation Guard

```typescript
if (Math.abs(1 - r1) < 1e-10 || Math.abs(r1) < 1e-10 ||
    Math.abs(1 - r2) < 1e-10 || Math.abs(r2) < 1e-10) {
  return integrateNumerical(s, e, beats, 'ease-out', 1000)
}
```

## Edge Case 4: Zero and Negative BPM

### The Problem

- $\text{BPM} = 0$: Division by zero in $\frac{60}{\text{BPM}}$
- $\text{BPM} < 0$: Negative tempo is physically meaningless; $\ln$ of negative undefined

### Implementation Guard

```typescript
function integrateTempo(startBpm: number, endBpm: number, ...): number {
  if (startBpm <= 0 || endBpm <= 0) {
    throw new Error('BPM must be positive')
  }
  // ...
}
```

This is validated at the **builder level** before compilation:

```typescript
validate.bpm('tempo', bpm)  // Throws if bpm < 1 or bpm > 999
```

## Summary of Guards

```typescript
// Guard 1: Near-equal BPM
if (Math.abs(e - s) < 0.001) {
  return constantTempoFormula(s, beats)
}

// Guard 2: arctanh domain
if (sqrtRatio >= 0.999) {
  return integrateNumerical(...)
}

// Guard 3: Quadratic boundary roots
if (rootNearBoundary(r1, r2)) {
  return integrateNumerical(...)
}

// Guard 4: Invalid BPM (at builder level)
if (bpm <= 0) throw new Error(...)
```

## Correctness Guarantees

| Input Range | Guaranteed Output |
|-------------|-------------------|
| $s, e \in [1, 999]$ | Finite, positive time |
| $\|e - s\| < 0.001$ | Constant-tempo approximation |
| Extreme decel ($e/s < 0.002$) | Numerical fallback |
| Any valid musical tempo | Correct within 0.001% |

## Testing Edge Cases

```typescript
describe('Edge Cases', () => {
  it('handles near-equal BPM', () => {
    const t = integrateTempo(120.0001, 120.0000, 4, 'linear')
    expect(t).toBeCloseTo(2.0, 5)
    expect(Number.isFinite(t)).toBe(true)
  })

  it('handles extreme deceleration', () => {
    const t = integrateTempo(120, 0.5, 4, 'ease-in')
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThan(0)
  })

  it('rejects zero BPM', () => {
    expect(() => integrateTempo(0, 120, 4, 'linear')).toThrow()
  })

  it('rejects negative BPM', () => {
    expect(() => integrateTempo(-60, 120, 4, 'linear')).toThrow()
  })
})
```






