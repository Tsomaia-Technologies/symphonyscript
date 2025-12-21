# Ease-Out (Quadratic Deceleration) Tempo Integration

## Curve Definition

An ease-out curve starts fast and decelerates — the tempo change is rapid at first, then gradual:

$$\text{BPM}(t) = s + (e - s) \cdot \left(2\frac{t}{B} - \left(\frac{t}{B}\right)^2\right)$$

This can be rewritten as:

$$\text{BPM}(\tau) = s + (e-s)(2\tau - \tau^2) \quad \text{where } \tau = t/B$$

### Visualization

```
BPM
 ↑
 e ─ ─ ─ ─ •─────
          ╱
        ╱
      ╱
    │
    │
 s •│
   └──────────────→ t
   0              B
```

The curve is "quick to start" — most tempo change happens early.

## Derivation

### Step 1: Expand the BPM Function

$$\text{BPM}(\tau) = s + (e-s)(2\tau - \tau^2)$$
$$= s + 2(e-s)\tau - (e-s)\tau^2$$

This is a quadratic in $\tau$:

$$\text{BPM}(\tau) = a + b\tau + c\tau^2$$

Where:
- $a = s$
- $b = 2(e-s)$
- $c = -(e-s)$

### Step 2: The General Quadratic Integral

We need to evaluate:

$$T = 60B \int_0^1 \frac{1}{a + b\tau + c\tau^2} \, d\tau$$

### Step 3: Complete the Square

Rewrite the denominator:

$$a + b\tau + c\tau^2 = c\left(\tau^2 + \frac{b}{c}\tau + \frac{a}{c}\right)$$

Complete the square:

$$= c\left[\left(\tau + \frac{b}{2c}\right)^2 + \frac{a}{c} - \frac{b^2}{4c^2}\right]$$

Define:
$$p = -\frac{b}{2c} = \frac{2(e-s)}{2(e-s)} = 1$$

$$q = \frac{a}{c} - \frac{b^2}{4c^2} = \frac{4ac - b^2}{4c^2}$$

### Step 4: Discriminant Analysis

The discriminant is:

$$\Delta = b^2 - 4ac = 4(e-s)^2 - 4s \cdot (-(e-s))$$
$$= 4(e-s)^2 + 4s(e-s) = 4(e-s)(e-s+s) = 4(e-s)e$$

**Three cases**:
- $\Delta > 0$: Two real roots (when $e > s$ or $e < 0$)
- $\Delta = 0$: One repeated root
- $\Delta < 0$: Complex roots

For musical tempos ($e > 0$, $s > 0$), and typical ease-out ($e > s$ for acceleration, $e < s$ for deceleration):

- If $e > s$: $\Delta = 4(e-s)e > 0$ → two real roots
- If $e < s$: $\Delta = 4(e-s)e < 0$ → complex roots (use arctan form)

### Step 5: Solution Forms

**When $\Delta < 0$ (deceleration, $e < s$)**:

$$T = \frac{60B}{\sqrt{-\Delta/4}} \left[ \arctan\left(\frac{2c\tau + b}{\sqrt{-\Delta}}\right) \right]_0^1$$

**When $\Delta > 0$ (acceleration, $e > s$)**:

The roots are:

$$r_1, r_2 = \frac{-b \pm \sqrt{\Delta}}{2c}$$

Use partial fractions and logarithms.

### Step 6: Simplified Implementation

Due to the complexity, the implementation uses a helper function:

```typescript
function integrateQuadraticBpm0to1(a: number, b: number, c: number): number {
  const discriminant = b * b - 4 * a * c
  
  if (Math.abs(discriminant) < 1e-10) {
    // Degenerate case: perfect square
    const root = -b / (2 * c)
    // ... handle specially
  }
  
  if (discriminant < 0) {
    // Complex roots: arctan form
    const sqrtNegD = Math.sqrt(-discriminant)
    const term1 = Math.atan((2 * c + b) / sqrtNegD)
    const term0 = Math.atan(b / sqrtNegD)
    return (60 * 2 / sqrtNegD) * (term1 - term0)
  } else {
    // Real roots: logarithm form
    const sqrtD = Math.sqrt(discriminant)
    const r1 = (-b + sqrtD) / (2 * c)
    const r2 = (-b - sqrtD) / (2 * c)
    // ... partial fractions
  }
}
```

## Implementation

```typescript
'ease-out': (s, e, beats) => {
  if (s === e) return (beats / s) * 60
  
  const a = s
  const b = 2 * (e - s)
  const c = -(e - s)
  
  const integralNorm = integrateQuadraticBpm0to1(a, b, c)
  return integralNorm * beats
}
```

## Edge Cases

### 1. Equal Tempos ($s = e$)

The curve degenerates to constant tempo:
$$\text{BPM}(\tau) = s$$
$$T = \frac{60B}{s}$$

### 2. Root at Boundary

When one root equals 0 or 1, special handling needed to avoid division by zero in the partial fraction expansion.

### 3. Very Small Tempo Differences

When $|e - s|$ is very small, numerical precision issues arise. The implementation guards against this with the initial equality check.

## Test Vectors

| Start BPM | End BPM | Beats | Expected Time (s) |
|-----------|---------|-------|-------------------|
| 60 | 120 | 4 | 2.493 |
| 120 | 60 | 4 | 3.142 |
| 100 | 100 | 4 | 2.400 |

## Comparison: Ease-In vs Ease-Out

For the same start/end tempos:

| Curve | 60→120 BPM (4 beats) | Character |
|-------|----------------------|-----------|
| Linear | 2.773s | Uniform change |
| Ease-In | 3.142s | Slow start, fast end |
| Ease-Out | 2.493s | Fast start, slow end |

**Ease-out is faster** because the tempo increases quickly at the start, so more beats pass at higher tempo.

## Musical Application

Ease-out is often used for:
- **Accelerando that "arrives"** — quickly reach target tempo, then settle
- **Ritardando at phrase ends** — slow down quickly, then linger
- **Natural-feeling transitions** — mimics how musicians actually change tempo






