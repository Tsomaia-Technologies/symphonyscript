# Ease-In-Out (Piecewise) Tempo Integration

## Curve Definition

An ease-in-out curve combines ease-in and ease-out — it starts slow, accelerates through the middle, then decelerates to the end:

$$\text{BPM}(t) = \begin{cases} 
s + (m-s) \cdot 2\left(\frac{t}{B}\right)^2 & \text{if } t < B/2 \\[1em]
m + (e-m) \cdot \left(2\frac{t-B/2}{B/2} - \left(\frac{t-B/2}{B/2}\right)^2\right) & \text{if } t \geq B/2
\end{cases}$$

Where $m = \frac{s + e}{2}$ is the midpoint tempo.

### Visualization

```
BPM
 ↑
 e ─ ─ ─ ─ ─ ─ •───
              ╱
            ╱
 m ─ ─ ─ •
        ╱
      ╱
 s •──╱
   └──────────────→ t
   0     B/2      B
```

The curve is S-shaped — smooth transitions at both ends.

## Derivation

### Step 1: Split the Integral

Since the curve is piecewise, split the integration:

$$T = T_1 + T_2$$

Where:
- $T_1$ = time for first half (beats 0 to $B/2$)
- $T_2$ = time for second half (beats $B/2$ to $B$)

### Step 2: First Half (Ease-In)

The first half is an ease-in from $s$ to $m$:

$$\text{BPM}_1(\tau) = s + (m-s)(2\tau)^2 \quad \text{for } \tau \in [0, 0.5]$$

Using the ease-in formula with $B' = B/2$:

$$T_1 = \text{EaseIn}(s, m, B/2)$$

### Step 3: Second Half (Ease-Out)

The second half is an ease-out from $m$ to $e$:

$$\text{BPM}_2(\tau) = m + (e-m)(2(\tau-0.5) - (2(\tau-0.5))^2) \quad \text{for } \tau \in [0.5, 1]$$

Using the ease-out formula with $B' = B/2$:

$$T_2 = \text{EaseOut}(m, e, B/2)$$

### Step 4: Final Formula

$$\boxed{T = \text{EaseIn}(s, m, B/2) + \text{EaseOut}(m, e, B/2)}$$

Where $m = (s + e) / 2$.

## Implementation

```typescript
'ease-in-out': (s, e, beats) => {
  if (s === e) return (beats / s) * 60
  
  const mid = (s + e) / 2
  const halfBeats = beats / 2

  // First half: ease-in from s to mid
  const firstHalf = ANALYTICAL_INTEGRALS['ease-in'](s, mid, halfBeats)

  // Second half: ease-out from mid to e
  const secondHalf = ANALYTICAL_INTEGRALS['ease-out'](mid, e, halfBeats)

  return firstHalf + secondHalf
}
```

## Why This Works

### Continuity at Midpoint

At $t = B/2$:

**From ease-in side** (approaching from left):
$$\text{BPM}_1(B/2) = s + (m-s) \cdot 1 = m$$

**From ease-out side** (approaching from right):
$$\text{BPM}_2(B/2) = m + (e-m) \cdot 0 = m$$

✓ The tempo is continuous at the midpoint.

### Smooth Derivative

The derivative (rate of tempo change) is also continuous at the midpoint, giving a smooth S-curve without sudden jerks.

## Edge Cases

### 1. Equal Tempos ($s = e$)

When $s = e$, the midpoint $m = s = e$, and both halves return:

$$T_1 = T_2 = \frac{60 \cdot B/2}{s} = \frac{30B}{s}$$

$$T = \frac{60B}{s}$$ ✓

### 2. Inherited Edge Cases

Since ease-in-out delegates to ease-in and ease-out:
- The ease-in arctanh singularity applies if $m \ll s$
- The ease-out boundary root issues apply if $m$ or $e$ create problematic roots

In practice, since $m = (s+e)/2$, these are rare:
- For arctanh singularity: would need $(s+e)/2 \approx 0$, meaning $e \approx -s$ (impossible for positive tempos)

## Test Vectors

| Start BPM | End BPM | Beats | Mid BPM | Expected Time (s) |
|-----------|---------|-------|---------|-------------------|
| 60 | 120 | 4 | 90 | 2.839 |
| 120 | 60 | 4 | 90 | 2.839 |
| 100 | 100 | 4 | 100 | 2.400 |

### Symmetry Property

Note that ease-in-out is **symmetric**: 

$$T(s \to e) = T(e \to s)$$

This is because:
- Going $s \to m \to e$ takes time $T_1 + T_2$
- Going $e \to m \to s$ takes time $T_2' + T_1'$
- Where $T_1' = \text{EaseIn}(e, m, B/2)$ and $T_2' = \text{EaseOut}(m, s, B/2)$

The integrals work out equal due to the averaging property.

## Musical Application

Ease-in-out is the most "natural" feeling tempo change:

| Application | Why Ease-In-Out |
|-------------|-----------------|
| **Ritardando at cadence** | Smooth deceleration feels musical |
| **Accelerando into chorus** | Builds energy without jarring |
| **Tempo rubato** | Mimics human timing flexibility |
| **Film scoring** | Follows visual motion curves |

## Comparison: All Curves

For 60→120 BPM over 4 beats:

| Curve | Time (s) | Character |
|-------|----------|-----------|
| Linear | 2.773 | Mechanical, uniform |
| Ease-In | 3.142 | Hesitant start, rushing end |
| Ease-Out | 2.493 | Eager start, settling end |
| **Ease-In-Out** | **2.839** | **Natural, balanced** |

Ease-in-out is between the extremes — neither too eager nor too hesitant.






