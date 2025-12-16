# Linear Tempo Integration

## Curve Definition

A linear tempo ramp changes BPM at a constant rate from start to end:

$$\text{BPM}(t) = s + (e - s) \cdot \frac{t}{B}$$

Where:
- $s$ = starting BPM
- $e$ = ending BPM  
- $B$ = total beats
- $t$ = current beat position

### Visualization

```
BPM
 ↑
 e ─ ─ ─ ─ ─ ─ ─ •
                /
               /
              /
             /
            /
 s •───────/
   └──────────────→ t
   0              B
```

## Derivation

### Step 1: Set Up the Integral

Time elapsed for $B$ beats:

$$T = \int_0^B \frac{60}{\text{BPM}(t)} \, dt = \int_0^B \frac{60}{s + (e-s)\frac{t}{B}} \, dt$$

### Step 2: Substitution

Let $u = s + (e-s)\frac{t}{B}$

Then:
- $\frac{du}{dt} = \frac{e-s}{B}$
- $dt = \frac{B}{e-s} du$

When $t = 0$: $u = s$  
When $t = B$: $u = e$

### Step 3: Transform the Integral

$$T = \int_s^e \frac{60}{u} \cdot \frac{B}{e-s} \, du = \frac{60B}{e-s} \int_s^e \frac{1}{u} \, du$$

### Step 4: Evaluate

$$T = \frac{60B}{e-s} \left[ \ln(u) \right]_s^e = \frac{60B}{e-s} \left( \ln(e) - \ln(s) \right)$$

### Step 5: Final Form

$$\boxed{T = \frac{60B \cdot \ln(e/s)}{e - s}}$$

## Implementation

```typescript
'linear': (s, e, beats) => {
  if (Math.abs(e - s) < 0.001) {
    return (beats / s) * 60  // Guard for near-equal BPM
  }
  return (beats * 60 * Math.log(e / s)) / (e - s)
}
```

## Edge Case: Near-Equal BPM

When $e \approx s$, both numerator and denominator approach 0:

$$\lim_{e \to s} \frac{60B \cdot \ln(e/s)}{e - s}$$

### L'Hôpital's Rule

Let $f(e) = 60B \cdot \ln(e/s)$ and $g(e) = e - s$

$$\lim_{e \to s} \frac{f(e)}{g(e)} = \lim_{e \to s} \frac{f'(e)}{g'(e)} = \lim_{e \to s} \frac{60B/e}{1} = \frac{60B}{s}$$

This is simply the constant-tempo formula: $T = \frac{60B}{s}$ seconds.

### Guard Implementation

```typescript
if (Math.abs(e - s) < 0.001) {
  return (beats / s) * 60
}
```

The threshold 0.001 BPM is chosen because:
- Human perception threshold for tempo is ~2-3 BPM
- 0.001 BPM difference is inaudible
- Avoids floating-point precision issues

## Test Vectors

| Start BPM | End BPM | Beats | Expected Time (s) |
|-----------|---------|-------|-------------------|
| 120 | 120 | 4 | 2.000 |
| 120 | 60 | 4 | 2.773 |
| 60 | 120 | 4 | 2.773 |
| 120 | 240 | 4 | 1.386 |
| 100 | 100.0001 | 4 | 2.400 |

### Derivation of Test Vector 2

$s = 120$, $e = 60$, $B = 4$:

$$T = \frac{60 \times 4 \times \ln(60/120)}{60 - 120} = \frac{240 \times \ln(0.5)}{-60} = \frac{240 \times (-0.693)}{-60} = 2.773 \text{ s}$$

## Symmetry Property

Note that:

$$\frac{\ln(e/s)}{e-s} = \frac{\ln(s/e)}{s-e}$$

Therefore, the integral is symmetric: accelerating from 60→120 takes the same time as decelerating from 120→60 (for the same number of beats).

This makes musical sense: the "average" tempo experienced is the same.
