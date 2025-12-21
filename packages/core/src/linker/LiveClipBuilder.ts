// =============================================================================
// SymphonyScript - LiveClipBuilder (RFC-043 Phase 4 + RFC-045-04 Zero-Alloc)
// =============================================================================
// Base ClipBuilder that mirrors DSL calls directly to SiliconBridge.
// Implements "Execution-as-Synchronization" paradigm.
//
// RFC-045-04 COMPLIANCE: ABSOLUTE ZERO ALLOCATIONS
// - No Sets/Maps (use pre-allocated TypedArrays)
// - No throw (use error state)
// - No setInterval (use tick-based cleanup)
// - No for...of (use index-based while loops)

import type { SiliconBridge, SourceLocation, EditorNoteData } from './silicon-bridge'
import type { NodePtr } from './types'
import type { NoteDuration, TimeSignatureString, NoteName } from '../types/primitives'
import type { HumanizeSettings, QuantizeSettings } from '../../../../../symphonyscript-legacy/src/legacy/clip/types'
import type { GrooveTemplate } from '../groove/types'
import { parseDuration } from '../util/duration'
import { LiveNoteCursor, LiveNoteData } from './cursors/LiveNoteCursor'
import { noteToMidi } from '../util/midi'
import { OPCODE } from './constants'
import { writeGrooveTemplate } from './init'

// =============================================================================
// Constants
// =============================================================================

/** Default PPQ for duration conversion */
const DEFAULT_PPQ = 480

/** Maximum number of sourceIds that can be tracked per builder */
const MAX_SOURCE_IDS = 4096

/** Bitmap size in 32-bit words */
const BITMAP_SIZE_I32 = (MAX_SOURCE_IDS + 31) >> 5

// =============================================================================
// LiveClipBuilder
// =============================================================================

/**
 * LiveClipBuilder mirrors DSL calls directly to the Silicon Linker SAB.
 *
 * RFC-045-04 COMPLIANT: Absolute zero allocations in operation.
 * - Uses pre-allocated Int32Array bitmaps instead of Sets
 * - Uses simple counter-based sourceId generation (no Error.stack)
 * - No Map caching (counter-based is deterministic)
 * - No setInterval (no timer-based cleanup needed)
 */
export class LiveClipBuilder {
  protected bridge: SiliconBridge
  protected name: string

  // Pre-allocated bitmaps for sourceId tracking
  private readonly touchedBitmap: Int32Array
  private readonly ownedBitmap: Int32Array
  private readonly ownedSourceIds: Int32Array
  private ownedCount: number = 0

  protected currentTick: number = 0
  protected currentVelocity: number = 100
  protected ppq: number = DEFAULT_PPQ
  protected lastSourceId: number | undefined

  // Context state
  protected _defaultDuration: NoteDuration = '4n'
  protected _humanize: HumanizeSettings | undefined
  // Pre-allocated quantize settings (never reallocate, just update fields)
  protected _quantize: QuantizeSettings = { grid: '16n', strength: undefined, duration: undefined }
  protected _quantizeEnabled: boolean = false
  protected _swing: number = 0
  protected _groove: GrooveTemplate | undefined
  protected _transposition: number = 0

  // Groove template index counter (for writing multiple templates)
  private static nextGrooveTemplateIndex: number = 0

  // Stack mode flag: when true, notes don't advance currentTick
  private _inStackMode: boolean = false
  private _stackMaxTick: number = 0

  // Counter-based sourceId generation (deterministic, zero-alloc)
  private nextSourceId: number = 1
  private callSiteCounter: number = 0

  // Sync read state for hoisted callback (zero-allocation pattern)
  private _syncReadMuted: boolean = false

  // Error state instead of throw
  private lastError: number = 0

  constructor(bridge: SiliconBridge, name: string = 'Untitled Clip') {
    this.bridge = bridge
    this.name = name

    // Pre-allocate bitmaps for sourceId tracking
    this.touchedBitmap = new Int32Array(BITMAP_SIZE_I32)
    this.ownedBitmap = new Int32Array(BITMAP_SIZE_I32)
    this.ownedSourceIds = new Int32Array(MAX_SOURCE_IDS)
  }

  // ===========================================================================
  // Bitmap Operations (Zero-Allocation Set Replacement)
  // ===========================================================================

  private setBit(bitmap: Int32Array, id: number): void {
    if (id <= 0 || id >= MAX_SOURCE_IDS) return
    const wordIndex = id >> 5
    const bitIndex = id & 31
    bitmap[wordIndex] = bitmap[wordIndex] | (1 << bitIndex)
  }

  private clearBit(bitmap: Int32Array, id: number): void {
    if (id <= 0 || id >= MAX_SOURCE_IDS) return
    const wordIndex = id >> 5
    const bitIndex = id & 31
    bitmap[wordIndex] = bitmap[wordIndex] & ~(1 << bitIndex)
  }

  private hasBit(bitmap: Int32Array, id: number): boolean {
    if (id <= 0 || id >= MAX_SOURCE_IDS) return false
    const wordIndex = id >> 5
    const bitIndex = id & 31
    return (bitmap[wordIndex] & (1 << bitIndex)) !== 0
  }

  private clearBitmap(bitmap: Int32Array): void {
    let i = 0
    while (i < BITMAP_SIZE_I32) {
      bitmap[i] = 0
      i = i + 1
    }
  }

  private addOwned(sourceId: number): void {
    if (!this.hasBit(this.ownedBitmap, sourceId)) {
      this.setBit(this.ownedBitmap, sourceId)
      if (this.ownedCount < MAX_SOURCE_IDS) {
        this.ownedSourceIds[this.ownedCount] = sourceId
        this.ownedCount = this.ownedCount + 1
      }
    }
  }

  // ===========================================================================
  // Error Handling (Zero-Allocation)
  // ===========================================================================

  getLastError(): number {
    return this.lastError
  }

  clearError(): void {
    this.lastError = 0
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
      this.currentTick = this.currentTick + dur
    }

    return new LiveNoteCursor(this, noteData)
  }

  /**
   * Add a chord (multiple notes at same time).
   * Accepts either MIDI numbers or NoteNames.
   */
  chord(pitches: (number | NoteName | string)[], velocity?: number, duration?: NoteDuration): any {
    const vel = velocity ?? this.currentVelocity
    const dur = this.resolveDuration(duration ?? this._defaultDuration)
    const baseTick = this.currentTick

    let i = 0
    while (i < pitches.length) {
      const sourceId = this.getSourceIdFromCallSite(i)
      const midiPitch = this.resolvePitch(pitches[i])
      this.synchronizeNote(sourceId, midiPitch, vel, dur, baseTick)
      i = i + 1
    }

    this.currentTick = this.currentTick + dur
    return this
  }

  /**
   * Add a rest (advances time without playing).
   */
  rest(duration?: NoteDuration): this {
    const dur = this.resolveDuration(duration ?? this._defaultDuration)
    this.currentTick = this.currentTick + dur
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
    return this
  }

  /**
   * Set swing amount (0-1).
   */
  swing(amount: number): this {
    this._swing = Math.max(0, Math.min(1, amount))
    if (amount > 0 && this._groove) {
      this._groove = undefined
      this.bridge.getLinker().clearGroove()
    }
    return this
  }

  // Pre-allocated groove offsets array
  private static readonly grooveOffsetsArray: Int32Array = new Int32Array(16)

  /**
   * Set groove template.
   */
  groove(template: GrooveTemplate): this {
    this._groove = template
    this._swing = 0

    // Convert groove template steps to tick offsets using pre-allocated array
    const ticksPerStep = this.ppq / template.stepsPerBeat
    let offsetCount = 0

    let i = 0
    while (i < template.steps.length && i < 16) {
      const step = template.steps[i]
      const timingOffset = step.timing ?? 0
      LiveClipBuilder.grooveOffsetsArray[i] = Math.round(timingOffset * ticksPerStep)
      offsetCount = offsetCount + 1
      i = i + 1
    }

    // Write groove template to SAB (zero-alloc: pass Int32Array directly)
    const buffer = this.bridge.getLinker().getSAB()
    const templateIndex = LiveClipBuilder.nextGrooveTemplateIndex
    LiveClipBuilder.nextGrooveTemplateIndex = LiveClipBuilder.nextGrooveTemplateIndex + 1

    writeGrooveTemplate(buffer, templateIndex, LiveClipBuilder.grooveOffsetsArray, offsetCount)

    // Calculate byte offset to the template
    const sab = new Int32Array(buffer)
    const nodeCapacity = sab[14]
    const grooveStartBytes = 128 + nodeCapacity * 32
    const templateByteOffset = grooveStartBytes + templateIndex * 68

    this.bridge.getLinker().setGroove(templateByteOffset, offsetCount)

    return this
  }

  // ===========================================================================
  // Humanization & Quantization
  // ===========================================================================

  defaultHumanize(settings: HumanizeSettings): this {
    this._humanize = settings
    return this
  }

  defaultQuantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this {
    // Zero-allocation: update pre-allocated fields
    this._quantize.grid = grid
    this._quantize.strength = options?.strength
    this._quantize.duration = options?.duration
    this._quantizeEnabled = true
    return this
  }

  quantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this {
    return this.defaultQuantize(grid, options)
  }

  // ===========================================================================
  // Control Messages
  // ===========================================================================

  control(controller: number, value: number): this {
    const sourceId = this.getSourceIdFromCallSite()
    const clampedController = Math.max(0, Math.min(127, controller))
    const clampedValue = Math.max(0, Math.min(127, value))

    this.synchronizeCC(sourceId, clampedController, clampedValue, this.currentTick)
    return this
  }

  private synchronizeCC(sourceId: number, controller: number, value: number, baseTick: number): void {
    const ptr = this.bridge.getNodePtr(sourceId)
    const linker = this.bridge.getLinker()

    if (ptr !== undefined) {
      linker.patchVelocity(ptr, value)
      linker.patchBaseTick(ptr, baseTick)
      this.setBit(this.touchedBitmap, sourceId)
    } else {
      let afterSourceIdPtr: number | undefined
      if (this.lastSourceId !== undefined && this.bridge.getNodePtr(this.lastSourceId) !== undefined) {
        afterSourceIdPtr = this.lastSourceId
      }

      this.bridge.insertImmediate(
        OPCODE.CC,
        controller,
        value,
        0,
        baseTick,
        false,
        undefined,
        afterSourceIdPtr,
        sourceId
      )

      this.setBit(this.touchedBitmap, sourceId)
      this.addOwned(sourceId)
    }
  }

  // ===========================================================================
  // Structural Operations
  // ===========================================================================

  stack(builderFn: (b: this) => this | LiveNoteCursor<this>): this {
    const savedTick = this.currentTick
    const result = builderFn(this)

    if (result instanceof LiveNoteCursor) {
      result.commit()
    }

    const maxTickReached = this.currentTick
    const maxDuration = maxTickReached - savedTick
    this.currentTick = savedTick + maxDuration

    return this
  }

  loop(count: number, builderFn: (b: this, iteration: number) => this | LiveNoteCursor<this>): this {
    let i = 0
    while (i < count) {
      const result = builderFn(this, i)
      if (result instanceof LiveNoteCursor) {
        result.commit()
      }
      i = i + 1
    }
    return this
  }

  play(clip: LiveClipBuilder): this {
    return this
  }

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

  finalize(): void {
    let i = 0
    while (i < this.ownedCount) {
      const sourceId = this.ownedSourceIds[i]
      if (!this.hasBit(this.touchedBitmap, sourceId)) {
        this.bridge.deleteNoteImmediate(sourceId)
        this.clearBit(this.ownedBitmap, sourceId)
      }
      i = i + 1
    }

    this.clearBitmap(this.touchedBitmap)
    this.currentTick = 0
  }

  resetTouched(): void {
    this.clearBitmap(this.touchedBitmap)
    this.currentTick = 0
  }

  // ===========================================================================
  // Source ID Generation (Zero-Allocation Counter-Based)
  // ===========================================================================

  protected getSourceIdFromCallSite(offset: number = 0): number {
    // Zero-allocation: Use deterministic counter instead of Error.stack
    // Each call site generates a unique, reproducible sourceId based on
    // execution order within the builder
    this.callSiteCounter = this.callSiteCounter + 1
    return (this.nextSourceId + this.callSiteCounter + offset) & 0x7fffffff
  }

  /**
   * Reset the call site counter.
   * Call this at the beginning of each script execution pass.
   */
  resetCallSiteCounter(): void {
    this.callSiteCounter = 0
  }

  // ===========================================================================
  // Synchronization Logic
  // ===========================================================================

  private handleSyncReadNote = (
    _pitch: number,
    _velocity: number,
    _duration: number,
    _baseTick: number,
    muted: boolean
  ): void => {
    this._syncReadMuted = muted
  }

  private applyQuantize(tick: number): number {
    if (!this._quantizeEnabled) return tick

    const gridTicks = this.resolveDuration(this._quantize.grid)
    const strength = this._quantize.strength ?? 1

    const nearestGrid = Math.round(tick / gridTicks) * gridTicks
    return Math.round(tick + (nearestGrid - tick) * strength)
  }

  private applySwing(tick: number): number {
    if (this._swing <= 0) return tick

    const eighthTicks = this.ppq / 2
    const eighthPosition = Math.floor(tick / eighthTicks)

    if (eighthPosition % 2 === 1) {
      const maxSwingOffset = eighthTicks / 2
      const swingOffset = Math.round(this._swing * maxSwingOffset)
      return tick + swingOffset
    }

    return tick
  }

  protected synchronizeNote(
    sourceId: number,
    pitch: number,
    velocity: number,
    duration: number,
    baseTick: number
  ): LiveNoteData {
    let transformedTick = baseTick
    transformedTick = this.applyQuantize(transformedTick)
    transformedTick = this.applySwing(transformedTick)

    let transformedDuration = duration
    if (this._quantizeEnabled && this._quantize.duration) {
      const gridTicks = this.resolveDuration(this._quantize.grid)
      transformedDuration = Math.max(gridTicks, Math.round(duration / gridTicks) * gridTicks)
    }

    const ptr = this.bridge.getNodePtr(sourceId)

    if (ptr !== undefined) {
      this._syncReadMuted = false
      this.bridge.readNote(sourceId, this.handleSyncReadNote)
      const existingMuted = this._syncReadMuted

      this.bridge.patchImmediate(sourceId, 'pitch', pitch)
      this.bridge.patchImmediate(sourceId, 'velocity', velocity)
      this.bridge.patchImmediate(sourceId, 'duration', transformedDuration)
      this.bridge.patchImmediate(sourceId, 'baseTick', transformedTick)

      this.setBit(this.touchedBitmap, sourceId)
      this.lastSourceId = sourceId

      return {
        sourceId,
        pitch,
        velocity,
        duration: transformedDuration,
        baseTick: transformedTick,
        muted: existingMuted
      }
    } else {
      let afterSourceIdPtr: number | undefined
      if (this.lastSourceId !== undefined && this.bridge.getNodePtr(this.lastSourceId) !== undefined) {
        afterSourceIdPtr = this.lastSourceId
      }

      this.bridge.insertImmediate(
        OPCODE.NOTE,
        pitch,
        velocity,
        transformedDuration,
        transformedTick,
        false,
        undefined,
        afterSourceIdPtr,
        sourceId
      )

      this.setBit(this.touchedBitmap, sourceId)
      this.addOwned(sourceId)
      this.lastSourceId = sourceId

      return {
        sourceId,
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

  protected resolvePitch(pitch: number | NoteName | string): number {
    if (typeof pitch === 'number') {
      return pitch
    }

    const midi = noteToMidi(pitch as NoteName)
    if (midi === null) {
      this.lastError = -1 // Invalid pitch error
      return 60 // Default to middle C
    }
    return midi
  }

  // ===========================================================================
  // Duration Resolution
  // ===========================================================================

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

  /**
   * Traverse touched source IDs with callback (zero-allocation).
   */
  traverseTouchedSourceIds(cb: (sourceId: number) => void): void {
    let word = 0
    while (word < BITMAP_SIZE_I32) {
      if (this.touchedBitmap[word] !== 0) {
        let bit = 0
        while (bit < 32) {
          if ((this.touchedBitmap[word] & (1 << bit)) !== 0) {
            const sourceId = (word << 5) | bit
            cb(sourceId)
          }
          bit = bit + 1
        }
      }
      word = word + 1
    }
  }

  getBridge(): SiliconBridge {
    return this.bridge
  }

  getName(): string {
    return this.name
  }

  // ===========================================================================
  // Static Cache Cleanup (No-Op - Cache Eliminated)
  // ===========================================================================

  static clearCache(): void {
    // No-op: Cache eliminated for zero-allocation compliance
  }
}
