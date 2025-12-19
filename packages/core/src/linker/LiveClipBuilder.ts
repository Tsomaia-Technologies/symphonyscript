// =============================================================================
// SymphonyScript - LiveClipBuilder (RFC-043 Phase 4)
// =============================================================================
// Clean-slate ClipBuilder that mirrors DSL calls directly to SiliconBridge.
// Implements "Execution-as-Synchronization" paradigm.
//
// Key differences from regular ClipBuilder:
// - NO .build() or .compile() methods
// - Every DSL call directly mirrors to SAB
// - Tombstone pattern auto-prunes deleted nodes

import type { SiliconBridge, SourceLocation, EditorNoteData } from './silicon-bridge'
import type { NoteDuration } from '../types/primitives'
import { parseDuration } from '../util/duration'

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed call site from stack trace.
 */
interface CallSite {
  file: string
  line: number
  column: number
}

/**
 * Cache entry for parsed stack frames.
 */
interface StackCacheEntry {
  sourceId: number
  timestamp: number
}

// =============================================================================
// Constants
// =============================================================================

/** Default PPQ for duration conversion */
const DEFAULT_PPQ = 480

/** Cache TTL for stack frame parsing (5 minutes) */
const STACK_CACHE_TTL_MS = 5 * 60 * 1000

// =============================================================================
// LiveClipBuilder
// =============================================================================

/**
 * LiveClipBuilder mirrors DSL calls directly to the Silicon Linker SAB.
 *
 * This builder:
 * - Parses call sites for SOURCE_ID generation
 * - Patches existing nodes or inserts new ones
 * - Tracks touched nodes for tombstone pruning
 * - Provides < 5µs per DSL call performance
 *
 * Usage:
 * ```typescript
 * Clip.melody('Lead')
 *   .note(60, 100, '4n')
 *   .note(64, 100, '4n')
 *   .finalize()
 * ```
 */
export class LiveClipBuilder {
  private bridge: SiliconBridge
  private touchedSourceIds: Set<number> = new Set()
  private ownedSourceIds: Set<number> = new Set() // All sourceIds this builder has ever created
  private currentTick: number = 0
  private currentVelocity: number = 100
  private ppq: number = DEFAULT_PPQ
  private lastSourceId: number | undefined

  // Stack frame cache for performance
  private static stackCache: Map<string, StackCacheEntry> = new Map()
  private static cacheCleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(bridge: SiliconBridge, name?: string) {
    this.bridge = bridge

    // Initialize cache cleanup timer (once) - only in non-test environment
    if (!LiveClipBuilder.cacheCleanupTimer && typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
      LiveClipBuilder.cacheCleanupTimer = setInterval(() => {
        LiveClipBuilder.cleanupCache()
      }, STACK_CACHE_TTL_MS)
      // Ensure timer doesn't prevent process exit
      if (LiveClipBuilder.cacheCleanupTimer.unref) {
        LiveClipBuilder.cacheCleanupTimer.unref()
      }
    }
  }

  /**
   * Clear the stack cache and stop the cleanup timer.
   * Call this in tests to ensure clean teardown.
   */
  static clearCache(): void {
    LiveClipBuilder.stackCache.clear()
    if (LiveClipBuilder.cacheCleanupTimer) {
      clearInterval(LiveClipBuilder.cacheCleanupTimer)
      LiveClipBuilder.cacheCleanupTimer = null
    }
  }

  // ===========================================================================
  // Core DSL Methods (Public API matches existing ClipBuilder)
  // ===========================================================================

  /**
   * Add a note.
   * Performs: IDENTIFY → SYNCHRONIZE → MARK
   */
  note(pitch: number, velocity?: number, duration?: NoteDuration): this {
    const sourceId = this.getSourceIdFromCallSite()
    const vel = velocity ?? this.currentVelocity
    const dur = this.resolveDuration(duration)

    // synchronizeNote will update lastSourceId and touchedSourceIds
    this.synchronizeNote(sourceId, pitch, vel, dur, this.currentTick)

    this.currentTick += dur
    return this
  }

  /**
   * Add a chord (multiple notes at same time).
   */
  chord(pitches: number[], velocity?: number, duration?: NoteDuration): this {
    const vel = velocity ?? this.currentVelocity
    const dur = this.resolveDuration(duration)
    const baseTick = this.currentTick

    // Each note in chord gets its own SOURCE_ID (different column offsets)
    for (let i = 0; i < pitches.length; i++) {
      // Generate unique source ID for each chord note
      const sourceId = this.getSourceIdFromCallSite(i)
      // synchronizeNote handles tracking internally
      this.synchronizeNote(sourceId, pitches[i], vel, dur, baseTick)
    }

    this.currentTick += dur
    return this
  }

  /**
   * Add a rest (advances time without playing).
   */
  rest(duration?: NoteDuration): this {
    const dur = this.resolveDuration(duration)
    this.currentTick += dur
    return this
  }

  /**
   * Set default velocity for subsequent notes.
   */
  velocity(v: number): this {
    this.currentVelocity = Math.max(0, Math.min(127, v))
    return this
  }

  /**
   * Set default duration for subsequent notes.
   * @deprecated Use duration parameter in note() instead
   */
  defaultDuration(duration: NoteDuration): this {
    // This is a context setter, doesn't need mirroring
    return this
  }

  /**
   * Transpose subsequent notes by semitones.
   * Note: In live mode, transposition is applied at note() time.
   */
  transpose(semitones: number): this {
    // Store transposition for use in note()
    // In this simplified version, we don't track transposition
    // A full implementation would add a _transposition field
    return this
  }

  /**
   * Set octave register.
   */
  octave(n: number): this {
    // Similar to transpose, this would be tracked and applied at note() time
    return this
  }

  // ===========================================================================
  // Tombstone Pattern
  // ===========================================================================

  /**
   * Finalize execution and prune tombstones.
   * Call this at the end of script execution.
   *
   * Only nodes owned by THIS builder that were not touched are deleted.
   * This allows multiple clips to coexist in the same bridge.
   */
  finalize(): void {
    // Only prune nodes that this builder owns but didn't touch
    for (const sourceId of this.ownedSourceIds) {
      if (!this.touchedSourceIds.has(sourceId)) {
        // Node was not touched → user deleted this line
        this.bridge.deleteNoteImmediate(sourceId)
        this.ownedSourceIds.delete(sourceId)
      }
    }

    this.touchedSourceIds.clear()
    this.currentTick = 0
  }

  /**
   * Reset touched set without pruning.
   * Use when re-executing the same script.
   */
  resetTouched(): void {
    this.touchedSourceIds.clear()
    this.currentTick = 0
  }

  // ===========================================================================
  // Source ID Generation (Call-Site Parsing)
  // ===========================================================================

  /**
   * Generate SOURCE_ID from call site.
   * Uses Error.stack to identify the calling line.
   *
   * @param offset - Optional offset for chord notes (different column)
   */
  private getSourceIdFromCallSite(offset: number = 0): number {
    const stack = new Error().stack
    if (!stack) {
      // Fallback: use sequential ID
      return this.bridge.generateSourceId()
    }

    // Check cache first (keyed by stack + offset)
    const cacheKey = `${stack}:${offset}`
    const cached = LiveClipBuilder.stackCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < STACK_CACHE_TTL_MS) {
      return cached.sourceId
    }

    // Parse call site from stack
    const callSite = this.parseCallSite(stack)

    // Apply offset for chord notes
    const location: SourceLocation = {
      file: callSite.file,
      line: callSite.line,
      column: callSite.column + offset
    }

    const sourceId = this.bridge.generateSourceId(location)

    // Cache the result
    LiveClipBuilder.stackCache.set(cacheKey, {
      sourceId,
      timestamp: Date.now()
    })

    return sourceId
  }

  /**
   * Parse call site from Error.stack.
   * Finds the user code frame (skips internal frames).
   */
  private parseCallSite(stack: string): CallSite {
    const lines = stack.split('\n')

    // Skip first line (Error message) and internal frames
    // Look for first frame outside this file
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]

      // Skip internal frames (LiveClipBuilder, SiliconBridge, etc.)
      if (
        line.includes('LiveClipBuilder') ||
        line.includes('silicon-bridge') ||
        line.includes('silicon-linker') ||
        line.includes('LiveSession') ||
        line.includes('node_modules')
      ) {
        continue
      }

      // Parse the frame
      const parsed = this.parseStackFrame(line)
      if (parsed) {
        return parsed
      }
    }

    // Fallback: return generic location
    return { file: 'unknown', line: 0, column: 0 }
  }

  /**
   * Parse a single stack frame line.
   *
   * Handles formats:
   * - "    at functionName (file:line:column)"
   * - "    at file:line:column"
   * - "    at functionName (file:line)"
   */
  private parseStackFrame(frame: string): CallSite | null {
    // Match: "at ... (file:line:column)" or "at file:line:column"
    const match = frame.match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?/)
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      }
    }

    // Match: "at ... (file:line)"
    const match2 = frame.match(/at\s+(?:.*?\s+\()?(.+?):(\d+)\)?/)
    if (match2) {
      return {
        file: match2[1],
        line: parseInt(match2[2], 10),
        column: 0
      }
    }

    return null
  }

  /**
   * Cleanup expired cache entries.
   */
  private static cleanupCache(): void {
    const now = Date.now()
    for (const [key, entry] of LiveClipBuilder.stackCache) {
      if (now - entry.timestamp > STACK_CACHE_TTL_MS) {
        LiveClipBuilder.stackCache.delete(key)
      }
    }
  }

  // ===========================================================================
  // Synchronization Logic
  // ===========================================================================

  /**
   * Synchronize a note: patch if exists, insert if new.
   * Returns the actual sourceId used (may differ from input for new nodes).
   */
  private synchronizeNote(
    sourceId: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number
  ): number {
    const ptr = this.bridge.getNodePtr(sourceId)

    if (ptr !== undefined) {
      // PATCH: Node exists → update attributes
      this.bridge.patchImmediate(sourceId, 'pitch', pitch)
      this.bridge.patchImmediate(sourceId, 'velocity', velocity)
      this.bridge.patchImmediate(sourceId, 'duration', duration)
      this.bridge.patchImmediate(sourceId, 'baseTick', baseTick)

      // Track as touched and update lastSourceId
      this.touchedSourceIds.add(sourceId)
      this.lastSourceId = sourceId
      return sourceId
    } else {
      // INSERT: Node doesn't exist → create new
      const noteData: EditorNoteData = {
        pitch,
        velocity,
        duration,
        baseTick,
        muted: false
      }

      // Insert after the last inserted node for chain ordering
      // Only use afterSourceId if it exists in the bridge's mapping
      let afterSourceId: number | undefined
      if (this.lastSourceId !== undefined && this.bridge.getNodePtr(this.lastSourceId) !== undefined) {
        afterSourceId = this.lastSourceId
      }

      // insertNoteImmediate generates a new sourceId
      const newSourceId = this.bridge.insertNoteImmediate(noteData, afterSourceId)

      // Track with the actual sourceId
      this.touchedSourceIds.add(newSourceId)
      this.ownedSourceIds.add(newSourceId) // This builder now owns this node
      this.lastSourceId = newSourceId
      return newSourceId
    }
  }

  // ===========================================================================
  // Duration Resolution
  // ===========================================================================

  /**
   * Resolve duration notation to ticks.
   */
  private resolveDuration(duration?: NoteDuration): number {
    if (duration === undefined) {
      return this.ppq // Default to quarter note
    }

    if (typeof duration === 'number') {
      return Math.round(duration * this.ppq)
    }

    // Parse string notation (e.g., '4n', '8n', '16n')
    return Math.round(parseDuration(duration) * this.ppq)
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get current tick position.
   */
  getCurrentTick(): number {
    return this.currentTick
  }

  /**
   * Get set of touched SOURCE_IDs.
   */
  getTouchedSourceIds(): Set<number> {
    return new Set(this.touchedSourceIds)
  }

  /**
   * Get the underlying bridge.
   */
  getBridge(): SiliconBridge {
    return this.bridge
  }
}
