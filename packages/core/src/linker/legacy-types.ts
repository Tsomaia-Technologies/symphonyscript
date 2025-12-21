// =============================================================================
// SymphonyScript - Legacy Types Migration (ISSUE-024)
// =============================================================================
// Types migrated from symphonyscript-legacy package to remove external dependency.
// These are interface-only definitions (zero runtime allocation).

import type { NoteDuration } from '../types/primitives'

/**
 * Humanization settings for micro-timing variation.
 * Migrated from symphonyscript-legacy/src/legacy/clip/types.
 */
export interface HumanizeSettings {
  /** Timing variation amount (typically 0-30 ticks) */
  timing?: number
  /** Velocity variation amount (typically 0.0-0.2 as percentage) */
  velocity?: number
}

/**
 * Quantization settings for grid alignment.
 * Migrated from symphonyscript-legacy/src/legacy/clip/types.
 */
export interface QuantizeSettings {
  /** Grid size (e.g., '4n' for quarter notes, '8n' for eighth notes) */
  grid?: NoteDuration
  /** Strength 0-100 (percentage pull to grid) */
  strength?: number
  /** Whether to also quantize duration */
  duration?: boolean
}

/**
 * Automation target for parameter modulation.
 * Migrated from symphonyscript-legacy/src/legacy/automation/types.
 *
 * Common targets: 'volume', 'pan', 'filter', 'resonance'
 */
export type AutomationTarget = string

/**
 * Velocity envelope point.
 * Migrated from symphonyscript-legacy/src/legacy/clip/types.
 */
export interface VelocityPoint {
  /** Position 0.0 to 1.0 (normalized position in clip) */
  position: number
  /** Velocity 0-127 */
  velocity: number
}
