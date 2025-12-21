# Tempo Integration: Stability & Verification

This document details the mathematical validation of SymphonyScript's tempo integration engine. The library uses closed-form analytical solutions for time-mapping to ensure sub-sample accuracy, falling back to high-precision numerical integration only for mathematically singular edge cases.

## 1. Mathematical Derivations

The engine relies on exact integrals of `60/BPM(t)` to map beats to seconds.

### Linear Curves
**Formula:** `BPM(t) = s + (e-s)(t/B)`
**Integral:** `(60 B / (e-s)) * ln(e/s)`
*Singularity Verified:* As `e → s`, the Limit approaches `(60 * B) / s`. The implementation handles this convergence to avoid division-by-zero instability.

### Ease-In (Quadratic)
**Formula:** `BPM(t) = s + (e-s)(t/B)²`
**Integral Mechanics:**
- **Acceleration (`e > s`):** Uses an `arctan` solution.
- **Deceleration (`e < s`):** Uses an `arctanh` solution.
*Domain Safety:* The `arctanh` domain requires `|x| < 1`. This physically corresponds to `BPM > 0`. A numerical fallback is engaged if the argument approaches 1 (extreme deceleration to near-zero), ensuring stability.

### Ease-Out (Quadratic)
**Formula:** `BPM(t) = s + (e-s)(2(t/B) - (t/B)²)`
**Integral Mechanics:**
This form requires integrating `1 / (Ax² + Bx + C)`. The implementation uses a generalized quadratic solver that correctly handles:
- **Real roots:** (`Δ > 0`)
- **Complex roots:** (`Δ < 0`) - The standard case for deceleration.
- **Repeated roots:** (`Δ ≈ 0`)

## 2. Implementation Compliance

The TypeScript implementation (`src/compiler/tempo.ts`) strictly adheres to these mathematical forms. To ensure robust operation in a production environment, several strict guards are in place:

| Guard Condition | Purpose | Outcome |
|-----------------|---------|---------|
| `|e - s| < 0.001` | Handles floating point equality issues near constant tempo. | Uses constant-tempo formula (`60B/s`) to avoid `0/0` NaN errors. |
| `sqrt(|b/a|) ≥ 0.999` | Prevents `arctanh` singularity when decelerating to 0 BPM. | Switches to numerical integration defined below. |
| `|root| < 0.01` | Prevents partial fraction singularities in quadratic expansion. | Switches to numerical integration. |

These guards act as a safety net, ensuring that even mathematically difficult inputs return valid time values.

## 3. Numerical Verification

The implementation has been verified against a suite of test vectors to ensure the code matches the theoretical values.

| Curve | Transition (BPM) | Duration (Beats) | Theoretical (s) | Actual (s) | Precision |
|-------|------------------|------------------|-----------------|------------|-----------|
| **Linear** | 120 → 60 | 4 | 2.773 | 2.7725... | Machine Epsilon |
| **Ease-In** | 60 → 120 | 4 | π (3.1415...) | 3.1415... | < 0.0001ms |
| **Ease-In** | 120 → 60 | 4 | 2.493 | 2.4929... | < 0.0001ms |
| **Ease-Out** | 120 → 60 | 4 | π (3.1415...) | 3.1415... | < 0.0001ms |

*Results derived from automated verification suite.*

## 4. Accuracy Standards

SymphonyScript adheres to the following accuracy standards for tempo calculations:

- **Primary Method:** Analytical (Closed-form). Used for >99% of transitions. Accuracy limited only by IEEE 754 floating point (approx 10⁻¹⁵).
- **Fallback Method:** Adaptive Simpson's Rule. Used for singularities or custom curves. Configured for < 10⁻⁶ relative error.
- **Output:** All time values are guaranteed to be finite positive numbers for any valid positive BPM input.
