// =============================================================================
// SymphonyScript - Groove Types
// =============================================================================

/** Individual step in a groove pattern */
export interface GrooveStep {
  timing?: number    // Offset as a ratio of the step duration (e.g., 0.1 = late by 10%)
  velocity?: number  // Velocity multiplier (e.g., 1.1 = accent)
  duration?: number  // Duration multiplier (e.g., 0.5 = staccato)
}

/** Groove template for micro-timing adjustments */
export interface GrooveTemplate {
  name: string
  stepsPerBeat: number
  steps: GrooveStep[]
}






