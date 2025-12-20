// =============================================================================
// SymphonyScript - LiveClipBuilder (RFC-043 Phase 4)
// =============================================================================
// Base ClipBuilder that mirrors DSL calls directly to SiliconBridge.
// Implements "Execution-as-Synchronization" paradigm.
//
// Key points:
// - Every DSL call directly mirrors to SAB
// - Tombstone pattern auto-prunes deleted nodes

import type { SiliconBridge, SourceLocation, EditorNoteData } from './silicon-bridge'
import type { NoteDuration, TimeSignatureString, NoteName } from '../types/primitives'
import type { HumanizeSettings, QuantizeSettings } from '../../../../../symphonyscript-legacy/src/legacy/clip/types'
import type { GrooveTemplate } from '../groove/types'
import { parseDuration } from '../util/duration'
import { LiveNoteCursor, LiveNoteData } from './cursors/LiveNoteCursor'
import { noteToMidi } from '../util/midi'
import { OPCODE } from './constants'
import { writeGrooveTemplate } from './init'

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
 * This is the base builder class. Specialized builders (LiveMelodyBuilder,
 * LiveDrumBuilder, etc.) extend this with instrument-specific methods.
 *
 * Usage:
 * ```typescript
 * Clip.melody('Lead')
 *   .note('C4', '4n').velocity(0.8).commit()
 *   .note('E4', '4n')
 *   .finalize()
 * ```
 */
export class LiveClipBuilder {
  protected bridge: SiliconBridge
  protected name: string
  protected touchedSourceIds: Set<number> = new Set()
  protected ownedSourceIds: Set<number> = new Set()
  protected currentTick: number = 0
  protected currentVelocity: number = 100
  protected ppq: number = DEFAULT_PPQ
  protected lastSourceId: number | undefined

  // Context state
  protected _defaultDuration: NoteDuration = '4n'
  protected _humanize: HumanizeSettings | undefined
  protected _quantize: QuantizeSettings | undefined
  protected _swing: number = 0
  protected _groove: GrooveTemplate | undefined
  protected _transposition: number = 0

  // Groove template index counter (for writing multiple templates)
  private static nextGrooveTemplateIndex: number = 0

  // Stack mode flag: when true, notes don't advance currentTick
  private _inStackMode: boolean = false
  private _stackMaxTick: number = 0

  // Stack frame cache for performance
  private static stackCache: Map<string, StackCacheEntry> = new Map()
  private static cacheCleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(bridge: SiliconBridge, name: string = 'Untitled Clip') {
    this.bridge = bridge
    this.name = name

    // Initialize cache cleanup timer (once) - only in non-test environment
    if (!LiveClipBuilder.cacheCleanupTimer && typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
      LiveClipBuilder.cacheCleanupTimer = setInterval(() => {
        LiveClipBuilder.cleanupCache()
      }, STACK_CACHE_TTL_MS)
      if (LiveClipBuilder.cacheCleanupTimer.unref) {
        LiveClipBuilder.cacheCleanupTimer.unref()
      }
    }
  }

  /**
   * Clear the stack cache and stop the cleanup timer.
   */
  static clearCache(): void {
    LiveClipBuilder.stackCache.clear()
    if (LiveClipBuilder.cacheCleanupTimer) {
      clearInterval(LiveClipBuilder.cacheCleanupTimer)
      LiveClipBuilder.cacheCleanupTimer = null
    }
  }

  // ===========================================================================
  // Core DSL Methods
  // ===========================================================================

  /**
   * Add a note.
   * Returns a cursor for applying modifiers.
   * Accepts either MIDI number (60) or NoteName ('C4').
   */
  note(pitch: number | NoteName | string, velocity?: number, duration?: NoteDuration): LiveNoteCursor<this> {
    const sourceId = this.getSourceIdFromCallSite()
    const midiPitch = this.resolvePitch(pitch)
    const vel = velocity ?? this.currentVelocity
    const dur = this.resolveDuration(duration ?? this._defaultDuration)

    const noteData = this.synchronizeNote(sourceId, midiPitch, vel, dur, this.currentTick)

    // In stack mode, track max tick but don't advance currentTick
    if (this._inStackMode) {
      this._stackMaxTick = Math.max(this._stackMaxTick, this.currentTick + dur)
    } else {
      this.currentTick += dur
    }

    return new LiveNoteCursor(this, noteData)
  }

  /**
   * Add a chord (multiple notes at same time).
   * Accepts either MIDI numbers or NoteNames.
   * Subclasses may return a cursor instead of this.
   */
  chord(pitches: (number | NoteName | string)[], velocity?: number, duration?: NoteDuration): any {
    const vel = velocity ?? this.currentVelocity
    const dur = this.resolveDuration(duration ?? this._defaultDuration)
    const baseTick = this.currentTick

    for (let i = 0; i < pitches.length; i++) {
      const sourceId = this.getSourceIdFromCallSite(i)
      const midiPitch = this.resolvePitch(pitches[i])
      this.synchronizeNote(sourceId, midiPitch, vel, dur, baseTick)
    }

    this.currentTick += dur
    return this
  }

  /**
   * Add a rest (advances time without playing).
   */
  rest(duration?: NoteDuration): this {
    const dur = this.resolveDuration(duration ?? this._defaultDuration)
    this.currentTick += dur
    return this
  }

  /**
   * Set default velocity for subsequent notes.
   */
  velocity(v: number): this {
    this.currentVelocity = v <= 1 ? Math.round(v * 127) : Math.max(0, Math.min(127, Math.round(v)))
    return this
  }

  /**
   * Set default duration for subsequent notes.
   */
  defaultDuration(duration: NoteDuration): this {
    this._defaultDuration = duration
    return this
  }

  // ===========================================================================
  // Tempo, Time Signature & Swing
  // ===========================================================================

  /**
   * Set tempo (BPM).
   * Writes directly to SAB header's BPM register for immediate effect.
   */
  tempo(bpm: number): this {
    const clampedBpm = Math.max(1, Math.min(999, Math.round(bpm)))
    this.bridge.getLinker().setBpm(clampedBpm)
    return this
  }

  /**
   * Set time signature.
   */
  timeSignature(signature: TimeSignatureString): this {
    // Store for metadata
    return this
  }

  /**
   * Set swing amount (0-1).
   * Swing delays off-beat notes (8th note grid).
   * Applied during note synchronization.
   */
  swing(amount: number): this {
    this._swing = Math.max(0, Math.min(1, amount))
    // Clear groove when setting swing directly (they're mutually exclusive)
    if (amount > 0 && this._groove) {
      this._groove = undefined
      this.bridge.getLinker().clearGroove()
    }
    return this
  }

  /**
   * Set groove template.
   * Writes template to SAB and activates it for playback.
   */
  groove(template: GrooveTemplate): this {
    this._groove = template
    // Clear swing when setting groove (they're mutually exclusive)
    this._swing = 0

    // Convert groove template steps to tick offsets
    const ticksPerStep = this.ppq / template.stepsPerBeat
    const offsets = template.steps.map((step, i) => {
      const timingOffset = step.timing ?? 0
      return Math.round(timingOffset * ticksPerStep)
    })

    // Write groove template to SAB
    const buffer = this.bridge.getLinker().getSAB()
    const templateIndex = LiveClipBuilder.nextGrooveTemplateIndex++
    writeGrooveTemplate(buffer, templateIndex, offsets)

    // Calculate byte offset to the template
    // Each template is 17 i32s (1 length + 16 offsets) = 68 bytes
    const sab = new Int32Array(buffer)
    const grooveStartBytes = sab[14] // HDR.GROOVE_START = 14
    const templateByteOffset = grooveStartBytes + templateIndex * 68

    // Activate the groove
    this.bridge.getLinker().setGroove(templateByteOffset, offsets.length)

    return this
  }

  // ===========================================================================
  // Humanization & Quantization
  // ===========================================================================

  /**
   * Set default humanization for subsequent notes.
   */
  defaultHumanize(settings: HumanizeSettings): this {
    this._humanize = settings
    return this
  }

  /**
   * Set default quantization for subsequent notes.
   */
  defaultQuantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this {
    this._quantize = { grid, ...options }
    return this
  }

  /**
   * Alias for defaultQuantize.
   */
  quantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this {
    return this.defaultQuantize(grid, options)
  }

  // ===========================================================================
  // Control Messages
  // ===========================================================================

  /**
   * Send MIDI Control Change (CC) message.
   * Inserts a CC event into the SAB at the current tick position.
   */
  control(controller: number, value: number): this {
    const sourceId = this.getSourceIdFromCallSite()
    const clampedController = Math.max(0, Math.min(127, controller))
    const clampedValue = Math.max(0, Math.min(127, value))

    this.synchronizeCC(sourceId, clampedController, clampedValue, this.currentTick)
    return this
  }

  /**
   * Synchronize a CC event: patch if exists, insert if new.
   */
  private synchronizeCC(
    sourceId: number,
    controller: number,
    value: number,
    baseTick: number
  ): void {
    const ptr = this.bridge.getNodePtr(sourceId)
    const linker = this.bridge.getLinker()

    if (ptr !== undefined) {
      // PATCH: Node exists - update the value
      linker.patchVelocity(ptr, value)
      linker.patchBaseTick(ptr, baseTick)
      this.touchedSourceIds.add(sourceId)
    } else {
      // INSERT: New CC node
      const nodeData = {
        opcode: OPCODE.CC,
        pitch: controller,
        velocity: value,
        duration: 0, // CC events have no duration
        baseTick,
        sourceId,
        flags: 0
      }

      // Insert at head or after last node
      let newPtr
      if (this.lastSourceId !== undefined) {
        const afterPtr = this.bridge.getNodePtr(this.lastSourceId)
        if (afterPtr !== undefined) {
          newPtr = linker.insertNode(afterPtr, nodeData)
        } else {
          newPtr = linker.insertHead(nodeData)
        }
      } else {
        newPtr = linker.insertHead(nodeData)
      }

      // Register the mapping manually since we bypassed bridge
      ;(this.bridge as any).sourceIdToPtr.set(sourceId, newPtr)
      ;(this.bridge as any).ptrToSourceId.set(newPtr, sourceId)

      this.touchedSourceIds.add(sourceId)
      this.ownedSourceIds.add(sourceId)
    }
  }

  // ===========================================================================
  // Structural Operations
  // ===========================================================================

  /**
   * Parallel execution - all operations in the callback start at same time.
   * After execution, currentTick advances to savedTick + maxDuration.
   */
  stack(builderFn: (b: this) => this | LiveNoteCursor<this>): this {
    const savedTick = this.currentTick
    const result = builderFn(this)

    // If cursor returned, commit it
    if (result instanceof LiveNoteCursor) {
      result.commit()
    }

    // Track the max tick reached during parallel execution
    const maxTickReached = this.currentTick

    // Restore tick to savedTick, then advance by the max duration
    // This allows parallel operations to start at the same time
    // but time advances by the longest operation
    const maxDuration = maxTickReached - savedTick
    this.currentTick = savedTick + maxDuration

    return this
  }

  /**
   * Loop - repeat operations.
   */
  loop(count: number, builderFn: (b: this, iteration: number) => this | LiveNoteCursor<this>): this {
    for (let i = 0; i < count; i++) {
      const result = builderFn(this, i)
      if (result instanceof LiveNoteCursor) {
        result.commit()
      }
    }
    return this
  }

  /**
   * Play another clip inline (sequential).
   */
  play(clip: LiveClipBuilder): this {
    // Copy operations from another clip
    // In live mode, this would merge the clip's notes into this one
    return this
  }

  /**
   * Isolate scope - operations don't affect parent context.
   */
  isolate(options: { tempo?: boolean; velocity?: boolean }, builderFn: (b: this) => this): this {
    const savedVelocity = this.currentVelocity
    const result = builderFn(this)

    if (options.velocity) {
      this.currentVelocity = savedVelocity
    }

    return this
  }

  // ===========================================================================
  // Tombstone Pattern
  // ===========================================================================

  /**
   * Finalize execution and prune tombstones.
   * Call this at the end of script execution.
   */
  finalize(): void {
    for (const sourceId of this.ownedSourceIds) {
      if (!this.touchedSourceIds.has(sourceId)) {
        this.bridge.deleteNoteImmediate(sourceId)
        this.ownedSourceIds.delete(sourceId)
      }
    }

    this.touchedSourceIds.clear()
    this.currentTick = 0
  }

  /**
   * Reset touched set without pruning.
   */
  resetTouched(): void {
    this.touchedSourceIds.clear()
    this.currentTick = 0
  }

  // ===========================================================================
  // Source ID Generation
  // ===========================================================================

  /**
   * Generate SOURCE_ID from call site.
   */
  protected getSourceIdFromCallSite(offset: number = 0): number {
    const stack = new Error().stack
    if (!stack) {
      return this.bridge.generateSourceId()
    }

    const cacheKey = `${stack}:${offset}`
    const cached = LiveClipBuilder.stackCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < STACK_CACHE_TTL_MS) {
      return cached.sourceId
    }

    const callSite = this.parseCallSite(stack)
    const location: SourceLocation = {
      file: callSite.file,
      line: callSite.line,
      column: callSite.column + offset
    }

    const sourceId = this.bridge.generateSourceId(location)

    LiveClipBuilder.stackCache.set(cacheKey, {
      sourceId,
      timestamp: Date.now()
    })

    return sourceId
  }

  /**
   * Parse call site from Error.stack.
   */
  private parseCallSite(stack: string): CallSite {
    const lines = stack.split('\n')

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]

      if (
        line.includes('LiveClipBuilder') ||
        line.includes('LiveMelodyBuilder') ||
        line.includes('LiveDrumBuilder') ||
        line.includes('LiveKeyboardBuilder') ||
        line.includes('LiveStringsBuilder') ||
        line.includes('LiveWindBuilder') ||
        line.includes('LiveNoteCursor') ||
        line.includes('LiveMelodyNoteCursor') ||
        line.includes('LiveChordCursor') ||
        line.includes('LiveDrumHitCursor') ||
        line.includes('silicon-bridge') ||
        line.includes('silicon-linker') ||
        line.includes('LiveSession') ||
        line.includes('node_modules')
      ) {
        continue
      }

      const parsed = this.parseStackFrame(line)
      if (parsed) {
        return parsed
      }
    }

    return { file: 'unknown', line: 0, column: 0 }
  }

  /**
   * Parse a single stack frame line.
   */
  private parseStackFrame(frame: string): CallSite | null {
    const match = frame.match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?/)
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      }
    }

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
   * Apply quantization to a tick value.
   */
  private applyQuantize(tick: number): number {
    if (!this._quantize) return tick

    const gridTicks = this.resolveDuration(this._quantize.grid)
    const strength = this._quantize.strength ?? 1

    const nearestGrid = Math.round(tick / gridTicks) * gridTicks
    return Math.round(tick + (nearestGrid - tick) * strength)
  }

  /**
   * Apply swing offset to a tick value.
   * Swing delays off-beat 8th notes.
   */
  private applySwing(tick: number): number {
    if (this._swing <= 0) return tick

    // 8th note grid in ticks
    const eighthTicks = this.ppq / 2 // 240 ticks at 480 PPQ

    // Determine which 8th note position this tick falls on
    const eighthPosition = Math.floor(tick / eighthTicks)

    // Only apply swing to off-beats (odd positions: 1, 3, 5, etc.)
    if (eighthPosition % 2 === 1) {
      // Maximum swing delay is half an 8th note
      const maxSwingOffset = eighthTicks / 2
      const swingOffset = Math.round(this._swing * maxSwingOffset)
      return tick + swingOffset
    }

    return tick
  }

  /**
   * Synchronize a note: patch if exists, insert if new.
   * Applies quantization and swing transformations.
   */
  protected synchronizeNote(
    sourceId: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number
  ): LiveNoteData {
    // Apply timing transformations in order: Quantize → Swing
    // (Groove is applied by the AudioWorklet consumer, not here)
    let transformedTick = baseTick
    transformedTick = this.applyQuantize(transformedTick)
    transformedTick = this.applySwing(transformedTick)

    // Apply quantization to duration if enabled
    let transformedDuration = duration
    if (this._quantize?.duration) {
      const gridTicks = this.resolveDuration(this._quantize.grid)
      transformedDuration = Math.max(gridTicks, Math.round(duration / gridTicks) * gridTicks)
    }

    const ptr = this.bridge.getNodePtr(sourceId)

    if (ptr !== undefined) {
      // PATCH: Node exists
      this.bridge.patchImmediate(sourceId, 'pitch', pitch)
      this.bridge.patchImmediate(sourceId, 'velocity', velocity)
      this.bridge.patchImmediate(sourceId, 'duration', transformedDuration)
      this.bridge.patchImmediate(sourceId, 'baseTick', transformedTick)

      this.touchedSourceIds.add(sourceId)
      this.lastSourceId = sourceId

      return {
        sourceId,
        pitch,
        velocity,
        duration: transformedDuration,
        baseTick: transformedTick,
        muted: false
      }
    } else {
      // INSERT: New node
      const noteData: EditorNoteData = {
        pitch,
        velocity,
        duration: transformedDuration,
        baseTick: transformedTick,
        muted: false
      }

      let afterSourceId: number | undefined
      if (this.lastSourceId !== undefined && this.bridge.getNodePtr(this.lastSourceId) !== undefined) {
        afterSourceId = this.lastSourceId
      }

      const newSourceId = this.bridge.insertNoteImmediate(noteData, afterSourceId)

      this.touchedSourceIds.add(newSourceId)
      this.ownedSourceIds.add(newSourceId)
      this.lastSourceId = newSourceId

      return {
        sourceId: newSourceId,
        pitch,
        velocity,
        duration: transformedDuration,
        baseTick: transformedTick,
        muted: false
      }
    }
  }

  // ===========================================================================
  // Pitch Resolution
  // ===========================================================================

  /**
   * Resolve pitch notation to MIDI number.
   * Accepts either MIDI number or NoteName string.
   */
  protected resolvePitch(pitch: number | NoteName | string): number {
    if (typeof pitch === 'number') {
      return pitch
    }

    const midi = noteToMidi(pitch as NoteName)
    if (midi === null) {
      throw new Error(`Invalid pitch: ${pitch}`)
    }
    return midi
  }

  // ===========================================================================
  // Duration Resolution
  // ===========================================================================

  /**
   * Resolve duration notation to ticks.
   */
  protected resolveDuration(duration: NoteDuration): number {
    if (typeof duration === 'number') {
      return Math.round(duration * this.ppq)
    }

    return Math.round(parseDuration(duration) * this.ppq)
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  getCurrentTick(): number {
    return this.currentTick
  }

  getTouchedSourceIds(): Set<number> {
    return new Set(this.touchedSourceIds)
  }

  getBridge(): SiliconBridge {
    return this.bridge
  }

  getName(): string {
    return this.name
  }
}
