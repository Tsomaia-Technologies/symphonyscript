/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Fast, deterministic, good distribution.
 */
export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 // Ensure unsigned 32-bit
  }

  /**
   * Get next random float in [0, 1).
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /**
   * Get random float in [min, max).
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /**
   * Get random integer in [min, max].
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /**
   * Shuffle array in place using Fisher-Yates.
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [array[i], array[j]] = [array[j], array[i]]
    }
    return array
  }

  /**
   * Fork this generator (create independent child with derived seed).
   */
  fork(): SeededRandom {
    return new SeededRandom(this.state ^ 0x5deece66d)
  }
}

/**
 * Create a seeded random generator.
 * If no seed provided, uses a hash of current time (still deterministic within session).
 */
export function createRandom(seed?: number): SeededRandom {
  return new SeededRandom(seed ?? Date.now())
}

/**
 * Hash a string to a number (for seed generation).
 */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash >>> 0 // Ensure unsigned
}
