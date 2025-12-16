/**
 * Base type for all builder parameters.
 * Ensures consistent parameter structure across all builders.
 */
export interface BaseBuilderParams {
  transposition?: number
}

// Re-export for easier consumption
export interface MelodyBuilderParams extends BaseBuilderParams {
  // extend as needed
}

export interface DrumBuilderParams extends BaseBuilderParams {
  defaultVelocity?: number
}

/**
 * Type-safe parameter updater.
 * Allows updating a subset of parameters while preserving types.
 */
export type ParamUpdater<P> = {
  [K in keyof P]?: P[K]
}

/**
 * Merge params without type assertions.
 *
 * @param current - Current parameter state
 * @param updates - Partial updates to apply
 * @returns New parameter object with updates applied
 */
export function mergeParams<P extends object>(
  current: P,
  updates: ParamUpdater<P>
): P {
  return {...current, ...updates}
}
