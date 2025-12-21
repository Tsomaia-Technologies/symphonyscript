/**
 * RFC-026.9: Incremental Compilation Hashing
 *
 * Provides deterministic hashing of clip operations for change detection.
 * Key requirements:
 * - Sorted keys for determinism across JS engine implementations
 * - Skip _source metadata (debug info that shouldn't affect hashing)
 * - Include humanize.seed for reproducibility
 */

import type { ClipOperation, ClipNode } from '../../clip/types'

// =============================================================================
// Stable Serialization
// =============================================================================

/**
 * Keys to skip during serialization (debug metadata).
 */
const SKIP_KEYS = new Set(['_source'])

/**
 * Serialize an object to a deterministic string.
 * - Sorts object keys alphabetically
 * - Skips debug metadata (_source)
 * - Handles nested objects and arrays recursively
 *
 * @param value - Any value to serialize
 * @returns Deterministic string representation
 */
export function stableSerialize(value: unknown): string {
  return serializeValue(value)
}

function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  const type = typeof value

  if (type === 'boolean' || type === 'number' || type === 'string') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const items = value.map(serializeValue)
    return `[${items.join(',')}]`
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>

    // Get all keys, filter out skipped ones, sort alphabetically
    const keys = Object.keys(obj)
      .filter(k => !SKIP_KEYS.has(k))
      .sort()

    const pairs = keys.map(k => {
      const v = obj[k]
      // Skip undefined values
      if (v === undefined) {
        return null
      }
      return `${JSON.stringify(k)}:${serializeValue(v)}`
    }).filter(Boolean)

    return `{${pairs.join(',')}}`
  }

  // Functions, symbols, etc. - just stringify
  return String(value)
}

// =============================================================================
// Operation Hashing
// =============================================================================

/**
 * Hash a single operation.
 *
 * @param op - ClipOperation to hash
 * @returns Hash string
 */
export function hashOperation(op: ClipOperation): string {
  const serialized = stableSerialize(op)
  return computeHash(serialized)
}

/**
 * Hash an array of operations.
 * Used for section-level change detection.
 *
 * @param ops - Array of ClipOperations
 * @returns Hash string
 */
export function hashOperations(ops: ClipOperation[]): string {
  // Serialize each operation and join with separator
  const parts = ops.map(op => stableSerialize(op))
  const combined = parts.join('|')
  return computeHash(combined)
}

/**
 * Hash a ClipNode for cache key generation.
 *
 * @param clip - ClipNode to hash
 * @returns Hash string
 */
export function hashClip(clip: ClipNode): string {
  // Include clip metadata and all operations
  const metadata = stableSerialize({
    name: clip.name,
    tempo: clip.tempo,
    timeSignature: clip.timeSignature,
    swing: clip.swing,
    groove: clip.groove
  })

  const operations = hashOperations(clip.operations)

  return computeHash(`${metadata}|${operations}`)
}

// =============================================================================
// Hash Algorithm
// =============================================================================

/**
 * Compute a hash from a string.
 * Uses a simple but effective hash algorithm (djb2 variant).
 *
 * @param input - String to hash
 * @returns Hex hash string with prefix
 */
function computeHash(input: string): string {
  let hash = 5381

  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    // hash * 33 + char
    hash = ((hash << 5) + hash) + char
    // Convert to 32-bit integer
    hash = hash & hash
  }

  // Convert to positive hex string
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `sec_${hex}`
}

// =============================================================================
// Change Detection Utilities
// =============================================================================

/**
 * Check if two operation arrays have the same content hash.
 *
 * @param a - First operations array
 * @param b - Second operations array
 * @returns True if hashes match
 */
export function operationsEqual(a: ClipOperation[], b: ClipOperation[]): boolean {
  return hashOperations(a) === hashOperations(b)
}

/**
 * Determine if a change is "cascade-inducing".
 * Cascade changes affect timing/beat positions of subsequent operations.
 *
 * Changes that cascade:
 * - Duration changes (beat positions shift)
 * - Tempo changes (time calculations change)
 * - Time signature changes (measure calculations change)
 * - Add/remove operations (everything shifts)
 *
 * Changes that don't cascade:
 * - Pitch changes (same timing)
 * - Velocity changes (same timing)
 * - Articulation changes (same timing)
 * - Control value changes (same timing)
 *
 * @param oldOp - Original operation
 * @param newOp - New operation
 * @returns True if the change cascades to subsequent sections
 */
export function isCascadingChange(
  oldOp: ClipOperation | undefined,
  newOp: ClipOperation | undefined
): boolean {
  // Add/remove is always cascading
  if (!oldOp || !newOp) {
    return true
  }

  // Different kinds is cascading (structural change)
  if (oldOp.kind !== newOp.kind) {
    return true
  }

  // Check kind-specific cascading rules
  switch (oldOp.kind) {
    case 'note': {
      const newNote = newOp as typeof oldOp
      // Duration change is cascading
      if (oldOp.duration !== newNote.duration) {
        return true
      }
      // Tie change can affect duration accumulation
      if (oldOp.tie !== newNote.tie) {
        return true
      }
      // Pitch, velocity, articulation, etc. are non-cascading
      return false
    }

    case 'rest': {
      const newRest = newOp as typeof oldOp
      // Rest duration change is cascading
      return oldOp.duration !== newRest.duration
    }

    case 'tempo':
    case 'time_signature':
      // Always cascading
      return true

    case 'loop': {
      const newLoop = newOp as typeof oldOp
      // Count change is cascading
      if (oldOp.count !== newLoop.count) {
        return true
      }
      // Need to check nested operations
      if (oldOp.operations.length !== newLoop.operations.length) {
        return true
      }
      // Check each nested operation
      for (let i = 0; i < oldOp.operations.length; i++) {
        if (isCascadingChange(oldOp.operations[i], newLoop.operations[i])) {
          return true
        }
      }
      return false
    }

    case 'stack': {
      const newStack = newOp as typeof oldOp
      // Stack branch count change is cascading
      if (oldOp.operations.length !== newStack.operations.length) {
        return true
      }
      // Check each branch
      for (let i = 0; i < oldOp.operations.length; i++) {
        if (isCascadingChange(oldOp.operations[i], newStack.operations[i])) {
          return true
        }
      }
      return false
    }

    case 'scope': {
      const newScope = newOp as typeof oldOp
      // Isolation settings don't affect timing
      // Check nested operation
      return isCascadingChange(oldOp.operation, newScope.operation)
    }

    case 'clip': {
      const newClip = newOp as typeof oldOp
      // Need to check nested clip operations
      const oldOps = oldOp.clip.operations
      const newOps = newClip.clip.operations
      if (oldOps.length !== newOps.length) {
        return true
      }
      for (let i = 0; i < oldOps.length; i++) {
        if (isCascadingChange(oldOps[i], newOps[i])) {
          return true
        }
      }
      return false
    }

    case 'transpose': {
      const newTranspose = newOp as typeof oldOp
      // Transposition amount doesn't affect timing
      // Check nested operation
      return isCascadingChange(oldOp.operation, newTranspose.operation)
    }

    case 'dynamics': {
      const newDynamics = newOp as typeof oldOp
      // Duration change in dynamics ramp is cascading
      return oldOp.duration !== newDynamics.duration
    }

    case 'control':
    case 'aftertouch':
    case 'vibrato':
    case 'automation':
    case 'pitch_bend':
    case 'block':
      // These don't affect beat timing
      return false

    default:
      // Unknown operation type - be safe, assume cascading
      return true
  }
}
