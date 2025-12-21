import type {TempoCurve} from '@symphonyscript/core/types/primitives'

/**
 * Easing functions for tempo curves.
 */
export const EASING_FUNCTIONS: Record<TempoCurve, (t: number) => number> = {
  'linear': (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Analytical integral of 1/BPM(t) for standard curves.
 * Returns time in seconds for given beat duration.
 *
 * These are closed-form solutions - mathematically exact.
 */
const ANALYTICAL_INTEGRALS: Record<TempoCurve, (
  startBpm: number,
  endBpm: number,
  beats: number
) => number> = {
  'linear': (s, e, beats) => {
    // Guard: near-equal BPM (within 0.001 BPM)
    if (Math.abs(e - s) < 0.001) {
      return (beats / s) * 60
    }
    return (beats * 60 * Math.log(e / s)) / (e - s)
  },

  'ease-in': (s, e, beats) => {
    // Guard: near-equal BPM
    if (Math.abs(e - s) < 0.001) {
      return (beats / s) * 60
    }

    const a = s
    const b = e - s

    // Check if analytical solution is valid
    const sqrtRatio = Math.sqrt(Math.abs(b / a))

    if (b > 0) {
      // Accelerating: s < e — always valid
      const sqrtAB = Math.sqrt(a * b)
      return (beats * 60 / sqrtAB) * Math.atan(sqrtRatio)
    } else {
      // Decelerating: s > e
      // atanh domain: |x| < 1
      if (sqrtRatio >= 0.999) {
        // Fall back to numerical integration for extreme deceleration
        return integrateNumerical(s, e, beats, 'ease-in', 1000)
      }
      const sqrtAB = Math.sqrt(-a * b)
      return (beats * 60 / sqrtAB) * Math.atanh(sqrtRatio)
    }
  },

  'ease-out': (s, e, beats) => {
    if (s === e) return (beats / s) * 60
    // BPM(t) = s + (e-s)*(2*(t/beats) - (t/beats)²)
    // = s + 2(e-s)*t/beats - (e-s)*(t/beats)^2
    // a = s, b = 2(e-s), c = -(e-s)
    // normalized domain 0..1, then multiply by beats.
    const a = s
    const b = 2 * (e - s)
    const c = -(e - s)
    // Integral of 1/(a + bx + cx^2) from 0 to 1
    const integralNorm = integrateQuadraticBpm0to1(a, b, c)
    return integralNorm * beats
  },

  'ease-in-out': (s, e, beats) => {
    if (s === e) return (beats / s) * 60
    // Piecewise: first half is ease-in, second half is ease-out
    // Split at midpoint and sum
    const mid = (s + e) / 2
    const halfBeats = beats / 2

    // First half: ease-in from s to mid
    const firstHalf = ANALYTICAL_INTEGRALS['ease-in'](s, mid, halfBeats)

    // Second half: ease-out from mid to e
    const secondHalf = ANALYTICAL_INTEGRALS['ease-out'](mid, e, halfBeats)

    return firstHalf + secondHalf
  }
}

/**
 * Integrate 60/(a + b*x + c*x²) from 0 to 1.
 * Used for ease-out curve.
 */
function integrateQuadraticBpm0to1(
  a: number,
  b: number,
  c: number
): number {
  const discriminant = b * b - 4 * a * c

  // Near-zero discriminant: repeated root
  if (Math.abs(discriminant) < 1e-10) {
    const r = -b / (2 * c)

    // Guard: root near boundaries (0 or 1)
    if (Math.abs(r) < 0.01 || Math.abs(r - 1) < 0.01) {
      return integrateQuadraticNumerical(a, b, c, 1000)
    }

    const val1 = -1 / (c * (1 - r))
    const val0 = -1 / (c * (0 - r))
    return 60 * (val1 - val0)
  }

  if (discriminant > 0) {
    // Two real roots
    const sqrtD = Math.sqrt(discriminant)
    const r1 = (-b - sqrtD) / (2 * c)
    const r2 = (-b + sqrtD) / (2 * c)

    // Guard: roots near integration bounds
    if (Math.abs(r1) < 0.01 || Math.abs(r1 - 1) < 0.01 ||
      Math.abs(r2) < 0.01 || Math.abs(r2 - 1) < 0.01) {
      return integrateQuadraticNumerical(a, b, c, 1000)
    }

    const pre = 1 / (c * (r1 - r2))
    const term1 = Math.log(Math.abs((1 - r1) / (1 - r2)))
    const term0 = Math.log(Math.abs((0 - r1) / (0 - r2)))

    return 60 * pre * (term1 - term0)
  }

  // Complex roots — always safe
  const sqrtNegD = Math.sqrt(-discriminant)
  const term1 = Math.atan((2 * c + b) / sqrtNegD)
  const term0 = Math.atan(b / sqrtNegD)

  return 60 * (2 / sqrtNegD) * (term1 - term0)
}

/**
 * Numerical fallback for degenerate quadratic cases.
 */
function integrateQuadraticNumerical(
  a: number,
  b: number,
  c: number,
  steps: number
): number {
  const h = 1 / steps
  let sum = 0

  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) * h
    const bpm = a + b * x + c * x * x
    if (bpm > 0) {
      sum += 60 / bpm
    }
  }

  return sum * h
}

/**
 * Integrate tempo to get elapsed seconds.
 * Uses analytical solution when available, numerical fallback otherwise.
 *
 * @param startBpm - Starting tempo
 * @param endBpm - Ending tempo
 * @param beats - Duration in beats
 * @param curve - Tempo curve type
 * @param precision - For numerical fallback: 'standard' (100 steps), 'high' (10000), 'sample' (auto from sampleRate)
 * @param sampleRate - Sample rate for 'sample' precision (default 48000)
 * @returns Elapsed time in seconds
 */
export function integrateTempo(
  startBpm: number,
  endBpm: number,
  beats: number,
  curve: TempoCurve,
  precision: 'standard' | 'high' | 'sample' = 'standard',
  sampleRate: number = 48000
): number {
  // Input validation
  if (startBpm <= 0 || endBpm <= 0) {
    throw new Error(`BPM must be positive, got start=${startBpm}, end=${endBpm}`)
  }
  if (beats < 0) {
    throw new Error(`Beats must be non-negative, got ${beats}`)
  }
  if (beats === 0) {
    return 0
  }

  // Use analytical solution for standard curves
  const analytical = ANALYTICAL_INTEGRALS[curve]
  if (analytical) {
    const result = analytical(startBpm, endBpm, beats)
    return validateResult(result, `analytical ${curve}`)
  }

  // Numerical fallback for custom curves
  const steps = precision === 'sample'
    ? Math.ceil(beats * 60 * sampleRate / Math.min(startBpm, endBpm))
    : precision === 'high' ? 10000 : 100

  const result = integrateNumerical(startBpm, endBpm, beats, curve, steps)
  return validateResult(result, `numerical ${curve}`)
}

/**
 * Numerical integration using Simpson's rule (more accurate than midpoint).
 */
function integrateNumerical(
  startBpm: number,
  endBpm: number,
  beats: number,
  curve: TempoCurve,
  steps: number
): number {
  const easing = EASING_FUNCTIONS[curve] ?? EASING_FUNCTIONS['linear']
  const h = beats / steps

  // Simpson's rule: (h/3) * [f(0) + 4*f(1) + 2*f(2) + 4*f(3) + ... + f(n)]
  // f(x) = 60 / BPM(x)

  let sum = bpmToSpb(startBpm) + bpmToSpb(endBpm)

  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const bpm = getBpmAt(t, startBpm, endBpm, easing)
    const coeff = i % 2 === 0 ? 2 : 4
    sum += coeff * bpmToSpb(bpm)
  }

  return (h * sum) / 3
}

function bpmToSpb(bpm: number): number {
  return 60 / bpm // seconds per beat
}

function getBpmAt(t: number, start: number, end: number, easing: (t: number) => number): number {
  return start + (end - start) * easing(t)
}

/**
 * Get BPM at normalized position.
 */
export function getBpmAtPosition(
  startBpm: number,
  endBpm: number,
  t: number,
  curve: TempoCurve
): number {
  const easing = EASING_FUNCTIONS[curve] ?? EASING_FUNCTIONS['linear']
  return startBpm + (endBpm - startBpm) * easing(Math.max(0, Math.min(1, t)))
}

/**
 * Quantize time to nearest sample boundary.
 *
 * @param seconds - Time in seconds
 * @param sampleRate - Sample rate (default 48000)
 * @returns Time quantized to sample boundary
 */
export function quantizeToSample(seconds: number, sampleRate: number = 48000): number {
  const samples = Math.round(seconds * sampleRate)
  return samples / sampleRate
}

/**
 * Validate tempo integration result.
 * Throws if result is NaN or Infinity.
 */
function validateResult(result: number, context: string): number {
  if (!Number.isFinite(result)) {
    throw new Error(
      `Tempo integration produced invalid result (${result}) in ${context}. ` +
      `This is a bug — please report with your tempo parameters.`
    )
  }
  if (result < 0) {
    throw new Error(
      `Tempo integration produced negative time (${result}) in ${context}. ` +
      `Check for negative BPM or beat values.`
    )
  }
  return result
}
