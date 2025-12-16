// =============================================================================
// SymphonyScript - Articulation Utilities
// =============================================================================

/**
 * Apply articulation to note duration.
 * Returns a multiplier for the actual sound duration.
 */
export function getArticulationMultiplier(articulation?: string): number {
  switch (articulation) {
    case 'staccato':
      return 0.5   // Half duration
    case 'legato':
      return 1.05    // Slight overlap
    case 'accent':
      return 1.0     // Normal duration (velocity handled separately)
    case 'tenuto':
      return 1.0     // Full duration
    case 'marcato':
      return 0.75   // Strong accent, slightly shorter
    default:
      return 1.0
  }
}






