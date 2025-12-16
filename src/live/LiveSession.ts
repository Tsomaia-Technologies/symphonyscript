/**
 * RFC-031: Live Coding Runtime - LiveSession
 * 
 * Main controller for live coding sessions.
 * Orchestrates compilation, scheduling, and playback.
 */

import type { SessionNode, TrackNode } from '@symphonyscript/core'
import type { ClipNode } from '@symphonyscript/core'
import type { CompiledClip, CompiledEvent } from '@symphonyscript/core'
import type { CompilationCache } from '@symphonyscript/core'
import { compileClip } from '@symphonyscript/core'
import { incrementalCompile } from '@symphonyscript/core'

import type {
  LiveSessionOptions,
  LiveSessionState,
  EvalResult,
  QuantizeMode,
  Unsubscribe,
  BeatCallback,
  BarCallback,
  ErrorCallback,
  LiveSessionEvent,
  TrackState
} from './types'
import type { AudioBackend } from './backends/types'
import { WebAudioBackend } from './backends/WebAudioBackend'
import { MIDIBackend } from './backends/MIDIBackend'
import { StreamingScheduler, DEFAULT_LOOKAHEAD } from './StreamingScheduler'
import {
  parseTimeSignature,
  getQuantizeTargetBeat,
  beatsToSeconds,
  secondsToBeats,
  getTimeUntilNextQuantize,
  getBeatGridInfo,
  isAtQuantizeBoundary,
  getQuantizeTargetWithLookahead
} from './quantize'
import {
  createEvalContext,
  safeEval,
  diffSessions,
  mergeTracksIntoSession,
  preprocessCode,
  validateCode
} from './eval'
import { synth } from '@symphonyscript/core'
import { SCHEMA_VERSION } from '@symphonyscript/core'
import {
  createFileWatcher,
  type FileWatcher,
  type WatcherOptions,
  type FileChangeEvent
} from './watcher'

// =============================================================================
// Constants
// =============================================================================

/** Default tempo */
const DEFAULT_BPM = 120

/** Default time signature */
const DEFAULT_TIME_SIGNATURE = '4/4' as const

/** Beat event interval (every beat) */
const BEAT_CHECK_INTERVAL = 25 // ms

// =============================================================================
// Event Emitter Helper
// =============================================================================

type EventHandlers = {
  beat: Set<BeatCallback>
  bar: Set<BarCallback>
  error: Set<ErrorCallback>
}

// =============================================================================
// LiveSession
// =============================================================================

/**
 * Main controller for live coding sessions.
 * 
 * Usage:
 * ```typescript
 * const live = new LiveSession({ bpm: 120 })
 * await live.init()
 * live.play()
 * 
 * live.eval(`
 *   track('drums', t => t.clip(Clip.drums().kick('4n').loop(4)))
 * `)
 * ```
 */
export class LiveSession {
  // Configuration
  private options: Required<LiveSessionOptions>
  
  // Backends
  private webAudioBackend: WebAudioBackend | null = null
  private midiBackend: MIDIBackend | null = null
  private activeBackend: AudioBackend | null = null
  
  // Scheduler
  private scheduler: StreamingScheduler | null = null
  
  // State
  private state: LiveSessionState
  
  // Event handlers
  private handlers: EventHandlers = {
    beat: new Set(),
    bar: new Set(),
    error: new Set()
  }
  
  // Beat/bar tracking
  private lastEmittedBeat: number = -1
  private lastEmittedBar: number = -1
  private beatCheckInterval: ReturnType<typeof setInterval> | null = null
  
  // File watcher (Phase 6)
  private fileWatcher: FileWatcher | null = null
  private watchedFiles: Set<string> = new Set()
  
  // Initialization state
  private initialized: boolean = false
  private disposed: boolean = false
  
  constructor(options: LiveSessionOptions) {
    // Normalize options with defaults
    this.options = {
      bpm: options.bpm ?? DEFAULT_BPM,
      backend: options.backend ?? 'webaudio',
      lookahead: options.lookahead ?? DEFAULT_LOOKAHEAD,
      quantize: options.quantize ?? 'bar',
      timeSignature: options.timeSignature ?? DEFAULT_TIME_SIGNATURE
    }
    
    // Parse time signature for beats per measure
    const { beatsPerMeasure } = parseTimeSignature(this.options.timeSignature)
    
    // Initialize state
    this.state = {
      session: null,
      tracks: new Map(),
      cache: null,
      tempoMap: null,
      isPlaying: false,
      bpm: this.options.bpm,
      quantize: this.options.quantize,
      timeSignature: this.options.timeSignature
    }
  }
  
  // ===========================================================================
  // Initialization
  // ===========================================================================
  
  /**
   * Initialize audio/MIDI backends.
   * Must be called from a user gesture (click, keypress) for audio to work.
   */
  async init(): Promise<void> {
    if (this.initialized || this.disposed) return
    
    const { backend } = this.options
    
    // Initialize WebAudio backend
    if (backend === 'webaudio' || backend === 'both') {
      this.webAudioBackend = new WebAudioBackend({
        masterGain: 0.8
      })
      await this.webAudioBackend.resume()
    }
    
    // Initialize MIDI backend
    if (backend === 'midi' || backend === 'both') {
      this.midiBackend = new MIDIBackend()
      await this.midiBackend.init()
    }
    
    // Set active backend (prefer WebAudio for timing)
    this.activeBackend = this.webAudioBackend ?? this.midiBackend
    
    if (!this.activeBackend) {
      throw new Error('No audio backend available')
    }
    
    // Create scheduler
    const { beatsPerMeasure } = parseTimeSignature(this.options.timeSignature)
    this.scheduler = new StreamingScheduler(this.activeBackend, {
      bpm: this.state.bpm,
      lookahead: this.options.lookahead,
      beatsPerMeasure
    })
    
    this.initialized = true
  }
  
  // ===========================================================================
  // Playback Control
  // ===========================================================================
  
  /**
   * Start playback.
   * If no session is loaded, starts from beat 0 (ready for eval).
   */
  play(): void {
    this.ensureInitialized()
    
    if (this.state.isPlaying) return
    
    this.scheduler!.start(0)
    this.state.isPlaying = true
    
    // Start beat/bar tracking
    this.startBeatTracking()
  }
  
  /**
   * Pause playback (keeps position).
   */
  pause(): void {
    if (!this.state.isPlaying) return
    
    this.scheduler?.pause()
    this.state.isPlaying = false
    
    this.stopBeatTracking()
  }
  
  /**
   * Resume from pause.
   */
  resume(): void {
    if (this.state.isPlaying) return
    
    this.scheduler?.resume()
    this.state.isPlaying = true
    
    this.startBeatTracking()
  }
  
  /**
   * Stop playback and reset to beginning.
   * Optionally stop only a specific track.
   * 
   * @param trackName - If provided, only stop this track
   */
  stop(trackName?: string): void {
    if (trackName) {
      // Stop specific track
      this.stopTrack(trackName)
    } else {
      // Stop everything
      this.scheduler?.stop()
      this.state.isPlaying = false
      this.stopBeatTracking()
      
      // Reset position tracking
      this.lastEmittedBeat = -1
      this.lastEmittedBar = -1
    }
  }
  
  // ===========================================================================
  // Session Management
  // ===========================================================================
  
  /**
   * Load a session for playback.
   * 
   * @param session - SessionNode or builder with build() method
   */
  load(session: SessionNode | { build(): SessionNode }): void {
    this.ensureInitialized()
    
    // Normalize to SessionNode
    const sessionNode = 'build' in session && typeof session.build === 'function'
      ? session.build()
      : session as SessionNode
    
    // Store session
    this.state.session = sessionNode
    
    // Update tempo from session if specified
    if (sessionNode.tempo) {
      this.setTempo(sessionNode.tempo)
    }
    
    // Update time signature from session if specified
    if (sessionNode.timeSignature) {
      this.state.timeSignature = sessionNode.timeSignature
      const { beatsPerMeasure } = parseTimeSignature(sessionNode.timeSignature)
      this.scheduler?.setBeatsPerMeasure(beatsPerMeasure)
    }
    
    // Compile and schedule all tracks
    for (const track of sessionNode.tracks) {
      this.loadTrack(track)
    }
  }
  
  /**
   * Load a single track.
   */
  private loadTrack(track: TrackNode): void {
    const trackId = track.name ?? `track-${this.state.tracks.size}`
    
    try {
      // Compile the track's clip
      const compiled = compileClip(track.clip, {
        bpm: this.state.bpm,
        timeSignature: this.state.timeSignature,
        channel: track.midiChannel ?? 1
      })
      
      // Store track state
      const trackState: TrackState = {
        id: trackId,
        events: compiled.events,
        muted: false,
        cache: undefined // Full compile, no incremental cache yet
      }
      this.state.tracks.set(trackId, trackState)
      
      // Schedule events
      this.scheduler?.consume(compiled.events, trackId)
      
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    }
  }
  
  /**
   * Update a track with new clip (for live coding).
   * Changes take effect at the next quantize boundary.
   * 
   * @param trackId - Track to update
   * @param clip - New clip
   */
  updateTrack(trackId: string, clip: ClipNode): void {
    this.ensureInitialized()
    
    const trackState = this.state.tracks.get(trackId)
    
    try {
      // Compile clip (use incremental if cache exists)
      let compiled: CompiledClip
      
      if (trackState?.cache) {
        const result = incrementalCompile(clip, trackState.cache, {
          bpm: this.state.bpm,
          timeSignature: this.state.timeSignature
        })
        compiled = result.result
        trackState.cache = result.cache
      } else {
        compiled = compileClip(clip, {
          bpm: this.state.bpm,
          timeSignature: this.state.timeSignature
        })
      }
      
      // Calculate target beat for quantized update
      const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
      const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
      const targetBeat = getQuantizeTargetBeat(
        currentBeat,
        this.state.quantize,
        beatsPerMeasure
      )
      
      // Queue the update
      this.scheduler?.queueUpdate({
        targetBeat,
        events: compiled.events,
        trackId,
        onApplied: () => {
          // Update track state when applied
          if (trackState) {
            trackState.events = compiled.events
          } else {
            this.state.tracks.set(trackId, {
              id: trackId,
              events: compiled.events,
              muted: false
            })
          }
        }
      })
      
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    }
  }
  
  /**
   * Stop a specific track.
   */
  private stopTrack(trackId: string): void {
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
    const targetBeat = getQuantizeTargetBeat(
      currentBeat,
      this.state.quantize,
      beatsPerMeasure
    )
    
    // Cancel events for this track
    this.scheduler?.cancelAfter(targetBeat, trackId)
    
    // Remove track state
    this.state.tracks.delete(trackId)
  }
  
  /**
   * Mute a track.
   */
  muteTrack(trackId: string): void {
    const trackState = this.state.tracks.get(trackId)
    if (trackState) {
      trackState.muted = true
    }
    
    // Mute on backend
    this.webAudioBackend?.muteTrack(trackId)
  }
  
  /**
   * Unmute a track.
   */
  unmuteTrack(trackId: string): void {
    const trackState = this.state.tracks.get(trackId)
    if (trackState) {
      trackState.muted = false
    }
    
    // Unmute on backend
    this.webAudioBackend?.unmuteTrack(trackId)
  }
  
  // ===========================================================================
  // Live Evaluation
  // ===========================================================================
  
  /**
   * Evaluate code string and update the session.
   * Changes take effect at the next quantize boundary.
   * 
   * Uses safe evaluation with new Function() - no raw eval().
   * Only DSL objects (Clip, Session, Track, etc.) are exposed.
   * 
   * @param code - Code to evaluate
   * @returns Evaluation result (synchronous return, async processing)
   * 
   * @example
   * ```typescript
   * live.eval(`
   *   track('drums', t => t.clip(
   *     Clip.drums().kick('4n').snare('4n').loop(4)
   *   ))
   * `)
   * ```
   */
  eval(code: string): EvalResult {
    // Validate code first
    const validation = validateCode(code)
    if (!validation.valid) {
      const error = new Error(validation.error)
      this.emitError(error)
      return {
        success: false,
        error
      }
    }
    
    // Preprocess code
    const processedCode = preprocessCode(code)
    
    // Create eval context
    const context = createEvalContext(this)
    
    // Execute evaluation asynchronously but return result synchronously
    // The actual processing happens in the background
    this.processEval(processedCode, context)
    
    return {
      success: true,
      warnings: []
    }
  }
  
  /**
   * Process evaluation asynchronously.
   */
  private async processEval(
    code: string, 
    context: ReturnType<typeof createEvalContext>
  ): Promise<void> {
    try {
      // Execute code
      const result = await safeEval(code, context)
      
      if (!result.success) {
        this.emitError(result.error ?? new Error('Evaluation failed'))
        return
      }
      
      // Process results
      if (result.session) {
        // Full session was built - diff and update
        await this.applySessionUpdate(result.session)
      } else if (result.tracks && result.tracks.size > 0) {
        // Individual tracks were defined
        await this.applyTrackUpdates(result.tracks)
      }
      
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    }
  }
  
  /**
   * Apply a session update from eval.
   */
  private async applySessionUpdate(newSession: SessionNode): Promise<void> {
    const oldSession = this.state.session
    
    // Find changed tracks
    const changedTracks = diffSessions(oldSession, newSession)
    
    // Update session
    this.state.session = newSession
    
    // Update tempo if changed
    if (newSession.tempo && newSession.tempo !== this.state.bpm) {
      this.setTempo(newSession.tempo)
    }
    
    // Update time signature if changed
    if (newSession.timeSignature && newSession.timeSignature !== this.state.timeSignature) {
      this.state.timeSignature = newSession.timeSignature
      const { beatsPerMeasure } = parseTimeSignature(newSession.timeSignature)
      this.scheduler?.setBeatsPerMeasure(beatsPerMeasure)
    }
    
    // Schedule updates for changed tracks
    for (const trackName of changedTracks) {
      const track = newSession.tracks.find(t => t.name === trackName)
      if (track) {
        this.updateTrack(trackName, track.clip)
      } else {
        // Track was removed
        this.stopTrack(trackName)
      }
    }
  }
  
  /**
   * Apply track updates from eval.
   */
  private async applyTrackUpdates(
    tracks: Map<string, { name: string; clip: ClipNode; instrument?: any }>
  ): Promise<void> {
    // Default instrument for tracks without one
    const defaultInstrument = synth('default-synth')
    
    // Merge into session
    const newSession = mergeTracksIntoSession(
      this.state.session,
      tracks,
      defaultInstrument
    )
    
    // Ensure version is set
    if (!newSession._version) {
      (newSession as any)._version = SCHEMA_VERSION
    }
    
    // Apply as session update
    await this.applySessionUpdate(newSession)
  }
  
  /**
   * Evaluate a file and update the session.
   * Only available in Node.js environment.
   * 
   * @param path - Path to file
   * @returns Evaluation result
   */
  evalFile(path: string): EvalResult {
    // Check if we're in Node.js
    if (typeof require === 'undefined') {
      const error = new Error('evalFile() is only available in Node.js environment')
      this.emitError(error)
      return {
        success: false,
        error
      }
    }
    
    try {
      // Read file (Node.js only)
      const fs = require('fs')
      const code = fs.readFileSync(path, 'utf-8')
      
      // Evaluate the code
      return this.eval(code)
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.emitError(err)
      return {
        success: false,
        error: err
      }
    }
  }
  
  // ===========================================================================
  // Configuration
  // ===========================================================================
  
  /**
   * Get current tempo.
   */
  getTempo(): number {
    return this.state.bpm
  }
  
  /**
   * Set tempo.
   * Takes effect immediately (tempo changes don't need quantization).
   */
  setTempo(bpm: number): void {
    this.state.bpm = bpm
    this.scheduler?.setTempo(bpm)
    this.webAudioBackend?.setTempo(bpm)
    this.midiBackend?.setTempo(bpm)
  }
  
  /**
   * Get current quantize mode.
   */
  getQuantize(): QuantizeMode {
    return this.state.quantize
  }
  
  /**
   * Set quantize mode.
   * 
   * @param mode - 'bar', 'beat', or 'off'
   */
  setQuantize(mode: QuantizeMode): void {
    this.state.quantize = mode
  }
  
  /**
   * Get the current session.
   */
  getSession(): SessionNode | null {
    return this.state.session
  }
  
  /**
   * Get current playback position in beats.
   */
  getCurrentBeat(): number {
    return this.scheduler?.getCurrentBeat() ?? 0
  }
  
  /**
   * Get current bar number (0-indexed).
   */
  getCurrentBar(): number {
    return this.scheduler?.getCurrentBar() ?? 0
  }
  
  /**
   * Check if playback is active.
   */
  isPlaying(): boolean {
    return this.state.isPlaying
  }
  
  /**
   * Check if session is initialized and ready.
   */
  isReady(): boolean {
    return this.initialized && !this.disposed
  }
  
  // ===========================================================================
  // Event Handling
  // ===========================================================================
  
  /**
   * Subscribe to session events.
   * 
   * @param event - Event type ('beat', 'bar', 'error')
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<E extends LiveSessionEvent>(
    event: E,
    handler: E extends 'beat' ? BeatCallback :
             E extends 'bar' ? BarCallback :
             E extends 'error' ? ErrorCallback :
             never
  ): Unsubscribe {
    const handlerSet = this.handlers[event] as Set<typeof handler>
    handlerSet.add(handler)
    
    return () => {
      handlerSet.delete(handler)
    }
  }
  
  /**
   * Remove all handlers for an event type.
   */
  off(event: LiveSessionEvent): void {
    this.handlers[event].clear()
  }
  
  // ===========================================================================
  // Beat-Grid Information (Phase 5)
  // ===========================================================================
  
  /**
   * Get the current position in the beat grid.
   * Returns bar number, beat in bar, and timing information.
   */
  getBeatGridInfo(): {
    bar: number
    beatInBar: number
    fractionalBeat: number
    isOnBeat: boolean
    isOnBar: boolean
    beatsUntilNextBar: number
  } {
    const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    return getBeatGridInfo(currentBeat, beatsPerMeasure)
  }
  
  /**
   * Get the time (in seconds) until the next quantize boundary.
   * Useful for UI countdown indicators.
   */
  getTimeUntilNextQuantize(): number {
    const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    return getTimeUntilNextQuantize(
      currentBeat,
      this.state.quantize,
      beatsPerMeasure,
      this.state.bpm
    )
  }
  
  /**
   * Check if the current position is on a quantize boundary.
   */
  isAtQuantizeBoundary(): boolean {
    const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    return isAtQuantizeBoundary(currentBeat, this.state.quantize, beatsPerMeasure)
  }
  
  /**
   * Get the beat at which the next update will take effect.
   * Considers both quantize mode and lookahead window.
   */
  getNextUpdateBeat(): number {
    const currentBeat = this.scheduler?.getCurrentBeat() ?? 0
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    const lookaheadBeats = secondsToBeats(DEFAULT_LOOKAHEAD, this.state.bpm)
    
    return getQuantizeTargetWithLookahead(
      currentBeat,
      this.state.quantize,
      beatsPerMeasure,
      lookaheadBeats
    )
  }
  
  // ===========================================================================
  // File Watching (Phase 6)
  // ===========================================================================
  
  /**
   * Start watching a file or directory for changes.
   * When a watched file changes, it will be evaluated automatically.
   * Only available in Node.js environment.
   * 
   * @param path - Path to file or directory to watch
   * @param options - Watcher configuration
   * 
   * @example
   * ```typescript
   * // Watch a single file
   * live.watch('./music/drums.ts')
   * 
   * // Watch a directory recursively
   * live.watch('./music', { recursive: true })
   * ```
   */
  watch(path: string, options: WatcherOptions = {}): void {
    this.ensureInitialized()
    
    // Check if we're in Node.js
    if (typeof require === 'undefined') {
      this.emitError(new Error('watch() is only available in Node.js environment'))
      return
    }
    
    // Create watcher if not exists
    if (!this.fileWatcher) {
      this.fileWatcher = createFileWatcher(
        (event) => this.handleFileChange(event),
        {
          debounce: options.debounce ?? 300,
          recursive: options.recursive ?? false,
          extensions: options.extensions ?? ['.ts', '.js'],
          ignore: options.ignore ?? ['node_modules', '.git', '**/*.d.ts'],
          triggerOnStart: options.triggerOnStart ?? false
        }
      )
    }
    
    // Add path to watcher
    this.fileWatcher.add(path)
    this.watchedFiles.add(path)
  }
  
  /**
   * Stop watching a path.
   * 
   * @param path - Path to stop watching
   */
  unwatch(path: string): void {
    if (this.fileWatcher) {
      this.fileWatcher.unwatch(path)
      this.watchedFiles.delete(path)
    }
  }
  
  /**
   * Stop watching all files.
   */
  unwatchAll(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
      this.watchedFiles.clear()
    }
  }
  
  /**
   * Get list of currently watched paths.
   */
  getWatchedPaths(): string[] {
    return Array.from(this.watchedFiles)
  }
  
  /**
   * Check if file watching is active.
   */
  isWatching(): boolean {
    return this.fileWatcher?.isWatching() ?? false
  }
  
  /**
   * Handle file change event from watcher.
   */
  private handleFileChange(event: FileChangeEvent): void {
    // Skip unlink events (file deletions)
    if (event.type === 'unlink') {
      return
    }
    
    // Evaluate the changed file
    const result = this.evalFile(event.path)
    
    if (!result.success) {
      // Error already emitted by evalFile
      console.error(`File evaluation failed: ${event.path}`)
    }
  }
  
  // ===========================================================================
  // Cleanup
  // ===========================================================================
  
  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.disposed) return
    
    // Stop playback
    this.stop()
    
    // Stop file watching
    this.unwatchAll()
    
    // Stop beat tracking
    this.stopBeatTracking()
    
    // Reset scheduler
    this.scheduler?.reset()
    this.scheduler = null
    
    // Dispose backends
    this.webAudioBackend?.dispose()
    this.midiBackend?.dispose()
    this.webAudioBackend = null
    this.midiBackend = null
    this.activeBackend = null
    
    // Clear handlers
    this.handlers.beat.clear()
    this.handlers.bar.clear()
    this.handlers.error.clear()
    
    // Clear state
    this.state.tracks.clear()
    this.state.session = null
    this.state.cache = null
    
    this.disposed = true
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Ensure the session is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LiveSession not initialized. Call init() first.')
    }
    if (this.disposed) {
      throw new Error('LiveSession has been disposed.')
    }
  }
  
  /**
   * Start tracking beat/bar for events.
   */
  private startBeatTracking(): void {
    if (this.beatCheckInterval) return
    
    this.beatCheckInterval = setInterval(() => {
      this.checkBeatBar()
    }, BEAT_CHECK_INTERVAL)
  }
  
  /**
   * Stop beat/bar tracking.
   */
  private stopBeatTracking(): void {
    if (this.beatCheckInterval) {
      clearInterval(this.beatCheckInterval)
      this.beatCheckInterval = null
    }
  }
  
  /**
   * Check for beat/bar changes and emit events.
   */
  private checkBeatBar(): void {
    if (!this.scheduler || !this.state.isPlaying) return
    
    const currentBeat = Math.floor(this.scheduler.getCurrentBeat())
    const { beatsPerMeasure } = parseTimeSignature(this.state.timeSignature)
    const currentBar = Math.floor(currentBeat / beatsPerMeasure)
    
    // Emit beat event
    if (currentBeat !== this.lastEmittedBeat) {
      this.lastEmittedBeat = currentBeat
      for (const handler of this.handlers.beat) {
        try {
          handler(currentBeat)
        } catch (e) {
          console.error('Beat handler error:', e)
        }
      }
    }
    
    // Emit bar event
    if (currentBar !== this.lastEmittedBar) {
      this.lastEmittedBar = currentBar
      for (const handler of this.handlers.bar) {
        try {
          handler(currentBar)
        } catch (e) {
          console.error('Bar handler error:', e)
        }
      }
    }
  }
  
  /**
   * Emit an error event.
   */
  private emitError(error: Error): void {
    for (const handler of this.handlers.error) {
      try {
        handler(error)
      } catch (e) {
        console.error('Error handler error:', e)
      }
    }
    
    // Also log to console if no handlers
    if (this.handlers.error.size === 0) {
      console.error('LiveSession error:', error)
    }
  }
}
