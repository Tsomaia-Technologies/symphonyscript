# Ease-In (Quadratic Acceleration) Tempo Integration

## Curve Definition

An ease-in curve starts slow and accelerates — the tempo change is gradual at first, then rapid:

$$\text{BPM}(t) = s + (e - s) \cdot \left(\frac{t}{B}\right)^2$$

### Visualization

```
BPM
 ↑
 e ─ ─ ─ ─ ─ ─ ─ •
                 │
                 │
               ╱
             ╱
          ╱
 s •─────╱
   └──────────────→ t
   0              B
```

The curve is "slow to start" — most tempo change happens near the end.

## Derivation

### Step 1: Normalize to Unit Interval

Let $\tau = t/B$ where $\tau \in [0, 1]$, then $dt = B \, d\tau$

$$\text{BPM}(\tau) = s + (e-s)\tau^2$$

$$T = \int_0^1 \frac{60B}{s + (e-s)\tau^2} \, d\tau$$

### Step 2: Identify the Integral Form

Let $a = s$ and $b = e - s$. Then:

$$T = 60B \int_0^1 \frac{1}{a + b\tau^2} \, d\tau$$

This is a standard integral with two cases:

### Case A: Acceleration ($b > 0$, i.e., $e > s$)

When $b > 0$:

$$\int \frac{1}{a + b\tau^2} d\tau = \frac{1}{\sqrt{ab}} \arctan\left(\tau\sqrt{\frac{b}{a}}\right) + C$$

Evaluating from 0 to 1:

$$T = \frac{60B}{\sqrt{ab}} \arctan\left(\sqrt{\frac{b}{a}}\right)$$

Substituting back $a = s$, $b = e - s$:

$$\boxed{T = \frac{60B}{\sqrt{s(e-s)}} \arctan\left(\sqrt{\frac{e-s}{s}}\right)} \quad \text{(acceleration)}$$

### Case B: Deceleration ($b < 0$, i.e., $e < s$)

When $b < 0$, let $b = -|b|$:

$$\int \frac{1}{a - |b|\tau^2} d\tau = \frac{1}{\sqrt{a|b|}} \text{arctanh}\left(\tau\sqrt{\frac{|b|}{a}}\right) + C$$

This gives:

$$\boxed{T = \frac{60B}{\sqrt{s(s-e)}} \text{arctanh}\left(\sqrt{\frac{s-e}{s}}\right)} \quad \text{(deceleration)}$$

## Domain Restrictions

### The arctanh Singularity

The function $\text{arctanh}(x)$ is only defined for $|x| < 1$:

$$\text{arctanh}(x) = \frac{1}{2}\ln\left(\frac{1+x}{1-x}\right)$$

As $x \to 1$, $\text{arctanh}(x) \to +\infty$.

### When Does This Happen?

The argument is $\sqrt{\frac{s-e}{s}} = \sqrt{1 - \frac{e}{s}}$

This approaches 1 when $e \to 0$ (tempo approaches zero).

**Physical interpretation**: If you decelerate too much (e.g., 120 BPM → 1 BPM with ease-in), the tempo gets so slow near the end that it takes infinite time to complete the beats.

### Guard Implementation

```typescript
const sqrtRatio = Math.sqrt(Math.abs(b / a))

if (sqrtRatio >= 0.999) {
  // Fall back to numerical integration
  return integrateNumerical(s, e, beats, 'ease-in', 1000)
}
```

The threshold 0.999 means we fall back when:
$$\sqrt{\frac{s-e}{s}} \geq 0.999 \implies \frac{e}{s} \leq 0.002$$

This triggers when ending tempo is less than 0.2% of starting tempo (extreme deceleration).

## Implementation

```typescript
'ease-in': (s, e, beats) => {
  if (Math.abs(e - s) < 0.001) {
    return (beats / s) * 60
  }

  const a = s
  const b = e - s
  const sqrtRatio = Math.sqrt(Math.abs(b / a))

  if (b > 0) {
    // Accelerating
    const sqrtAB = Math.sqrt(a * b)
    return (beats * 60 / sqrtAB) * Math.atan(sqrtRatio)
  } else {
    // Decelerating
    if (sqrtRatio >= 0.999) {
      return integrateNumerical(s, e, beats, 'ease-in', 1000)
    }
    const sqrtAB = Math.sqrt(-a * b)
    return (beats * 60 / sqrtAB) * Math.atanh(sqrtRatio)
  }
}
```

## Test Vectors

| Start BPM | End BPM | Beats | Case | Expected Time (s) |
|-----------|---------|-------|------|-------------------|
| 60 | 120 | 4 | Acceleration | 3.142 |
| 120 | 60 | 4 | Deceleration | 2.493 |
| 120 | 1 | 4 | Extreme decel | numerical fallback |
| 100 | 100 | 4 | No change | 2.400 |

### Derivation of Test Vector 1

$s = 60$, $e = 120$, $B = 4$ (acceleration):

$$a = 60, \quad b = 60$$

$$\sqrt{ab} = \sqrt{3600} = 60$$

$$\sqrt{b/a} = 1$$

$$T = \frac{60 \times 4}{60} \arctan(1) = 4 \times \frac{\pi}{4} = \pi \approx 3.142 \text{ s}$$

## Asymmetry with Linear

Unlike linear tempo, ease-in is **not symmetric**:

- Accelerating 60→120 with ease-in: Starts slow, ends fast
- Decelerating 120→60 with ease-in: Starts at full speed, slows gradually

The "ease-in" name refers to the **rate of change**, not the direction.






