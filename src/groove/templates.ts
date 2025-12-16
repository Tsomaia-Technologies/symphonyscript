// =============================================================================
// SymphonyScript - Groove Templates
// =============================================================================

import type {GrooveStep, GrooveTemplate} from './types'

/**
 * Creates an MPC-style swing groove.
 * @param amount 0.5 (straight/50%) to 0.75 (dotted/75%)
 * @param stepsPerBeat Grid resolution (default 4 = 16th notes)
 */
export function createSwing(amount: number, stepsPerBeat: number = 4): GrooveTemplate {
  // MPC swing affects every EVEN step (0-indexed odd steps: 1, 3, 5...)
  // amount is the ratio of the FIRST step duration to the total pair duration.
  // 50% = 1:1, 66% = 2:1 (triplet), 75% = 3:1 (dotted)
  // Delay in offsets = (amount - 0.5) * 2.

  const delay = (amount - 0.5) * 2

  const steps: GrooveStep[] = []

  for (let i = 0; i < stepsPerBeat; i++) {
    if (i % 2 !== 0) {
      // Odd step (2nd, 4th, etc) - delayed
      steps.push({timing: delay})
    } else {
      // Even step (1st, 3rd) - on grid
      steps.push({})
    }
  }

  return {
    name: `MPC Swing ${Math.round(amount * 100)}%`,
    stepsPerBeat,
    steps
  }
}

/**
 * Standard Groove Templates
 * Apply these using `.groove(Grooves.SWING)` etc.
 */
export const Grooves = {
  /** Straight timing (no groove) */
  STRAIGHT: {name: 'Straight', stepsPerBeat: 4, steps: []} as GrooveTemplate,

  /** Classic MPC 55% Swing (16th notes) */
  MPC_16_55: createSwing(0.55, 4),

  /** Classic MPC 57% Swing (16th notes) */
  MPC_16_57: createSwing(0.57, 4),

  /** Classic MPC 60% Swing (16th notes) */
  MPC_16_60: createSwing(0.60, 4),

  /** Classic MPC 66% Triplet Swing (16th notes) */
  MPC_16_66: createSwing(0.66, 4), // Triplet

  /** Hard Swing (dotted 16th feel) */
  MPC_16_75: createSwing(0.75, 4),

  /** Basic Swing (approx 66% swing ratio) - gives a triplet feel */
  SWING: {
    name: 'Swing',
    stepsPerBeat: 2, // 8th note swing
    steps: [
      {timing: 0},
      {timing: 0.16} // ~66% swing point (delayed 8th)
    ]
  } as GrooveTemplate,

  /** Delayed backbeat feel - creates a relaxed vibe */
  LAID_BACK: {
    name: 'Laid Back',
    stepsPerBeat: 1, // 1 step per beat
    steps: [
      {timing: 0, velocity: 1.0},    // Beat 1: On grid
      {timing: 0.02, velocity: 0.9}, // Beat 2: Late
      {timing: 0.05, velocity: 1.1}, // Beat 3: Very Late
      {timing: 0.02, velocity: 0.9}  // Beat 4: Late
    ]
  } as GrooveTemplate,

  /** Rushing feel - creates urgency */
  RUSHING: {
    name: 'Rushing',
    stepsPerBeat: 1,
    steps: [
      {timing: 0, velocity: 1.0},     // Beat 1
      {timing: -0.01, velocity: 1.0}, // Beat 2: Early
      {timing: -0.02, velocity: 1.0}, // Beat 3: Very Early
      {timing: -0.01, velocity: 1.0}  // Beat 4: Early
    ]
  } as GrooveTemplate,
}






