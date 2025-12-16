/**
 * RFC-031: Live Coding Runtime - Streaming Scheduler
 * 
 * A beat-aware event scheduler that supports live updates through splicing.
 * Extends the lookahead pattern from src/runtime/scheduler.ts with:
 * - Beat-based position tracking
 * - Per-track event management
 * - Splice support for incremental updates
 * - Callback scheduling at beat boundaries
 */

import type { CompiledEvent } from '@symphonyscript/core'
import type { AudioBackend } from './backends/types'
import type { 
  StreamingSchedulerConfig, 
  ScheduledEvent, 
  PendingUpdate,
  ScheduledCallback
} from './types'
import {
  secondsToBeats,
  beatsToSeconds,
  getEffectiveCancelBeat,
  getCurrentBeatFromAudioTime,
  getAudioTimeForBeat,
  getNextBarBeat
} from './quantize'

// =============================================================================
// Constants
// =============================================================================

/** Default lookahead in seconds */
export const DEFAULT_LOOKAHEAD = 0.1

/** Default scheduling interval in milliseconds */
export const DEFAULT_SCHEDULE_INTERVAL = 25

// =============================================================================
// Streaming Scheduler
// =============================================================================

/**
 * Beat-aware event scheduler with live update support.
 */
export class StreamingScheduler {
  // Configuration
  private bpm: number
  private lookahead: number
  private scheduleInterval: number
  private beatsPerMeasure: number
  
  // Backend
  private backend: AudioBackend
  
  // Playback state
  private playbackStartTime: number = 0
  private playbackStartBeat: number = 0
  private isRunning: boolean = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  
  // Event queues (sorted by beat)
  private eventQueue: ScheduledEvent[] = []
  private scheduledIndex: number = 0
  
  // Pending updates (for quantized changes)
  private pendingUpdates: PendingUpdate[] = []
  
  // Scheduled callbacks (for beat/bar events)
  private scheduledCallbacks: ScheduledCallback[] = []
  
  // Track-based event storage for splice operations
  private trackEvents: Map<string, CompiledEvent[]> = new Map()
  
  constructor(backend: AudioBackend, config: StreamingSchedulerConfig) {
    this.backend = backend
    this.bpm = config.bpm
    this.lookahead = config.lookahead ?? DEFAULT_LOOKAHEAD
    this.scheduleInterval = config.scheduleInterval ?? DEFAULT_SCHEDULE_INTERVAL
    this.beatsPerMeasure = config.beatsPerMeasure ?? 4
  }
  
  // ===========================================================================
  // Public API
  // ===========================================================================
  
  /**
   * Load events into the scheduler.
   * Replaces all existing events.
   * 
   * @param events - Array of compiled events
   * @param trackId - Optional track ID to associate with events
   */
  consume(events: CompiledEvent[], trackId?: string): void {
    // Convert to scheduled events with beat positions
    const scheduledEvents = events.map(event => this.createScheduledEvent(event, trackId))
    
    // Sort by beat
    scheduledEvents.sort((a, b) => a.beat - b.beat)
    
    // Store for track if provided
    if (trackId) {
      this.trackEvents.set(trackId, events)
    }
    
    // Merge into main queue
    this.eventQueue = this.mergeEventQueues(this.eventQueue, scheduledEvents)
    
    // Reset index if we added events before current position
    if (scheduledEvents.length > 0 && scheduledEvents[0].beat < this.getCurrentBeat()) {
      this.reindexQueue()
    }
  }
  
  /**
   * Splice new events for a track, replacing events after a specific beat.
   * Respects the lookahead window - already scheduled events play through.
   * 
   * @param events - New events to splice in
   * @param startBeat - Beat position from which to replace
   * @param trackId - Track ID to splice (required for proper replacement)
   */
  splice(events: CompiledEvent[], startBeat: number, trackId?: string): void {
    const currentBeat = this.getCurrentBeat()
    const lookaheadBeats = secondsToBeats(this.lookahead, this.bpm)
    
    // Get effective cancel beat (respects lookahead window)
    const effectiveBeat = getEffectiveCancelBeat(startBeat, currentBeat, lookaheadBeats)
    
    // Cancel on backend
    this.backend.cancelAfter(effectiveBeat, trackId)
    
    // Remove old events from queue
    if (trackId) {
      this.eventQueue = this.eventQueue.filter(
        e => e.trackId !== trackId || e.beat < effectiveBeat
      )
    } else {
      this.eventQueue = this.eventQueue.filter(e => e.beat < effectiveBeat)
    }
    
    // Convert new events to scheduled events
    const scheduledEvents = events
      .filter(e => this.eventToBeat(e) >= effectiveBeat)
      .map(event => this.createScheduledEvent(event, trackId))
    
    // Sort by beat
    scheduledEvents.sort((a, b) => a.beat - b.beat)
    
    // Update track storage
    if (trackId) {
      this.trackEvents.set(trackId, events)
    }
    
    // Merge into queue
    this.eventQueue = this.mergeEventQueues(this.eventQueue, scheduledEvents)
    
    // Reindex
    this.reindexQueue()
  }
  
  /**
   * Queue an update to be applied at a specific beat.
   * Used for quantized updates (apply on next bar/beat).
   * 
   * @param update - The pending update
   */
  queueUpdate(update: PendingUpdate): void {
    this.pendingUpdates.push(update)
    // Sort by target beat
    this.pendingUpdates.sort((a, b) => a.targetBeat - b.targetBeat)
  }
  
  /**
   * Cancel all events after a specific beat.
   * 
   * @param beat - Beat after which to cancel
   * @param trackId - Optional track to filter
   */
  cancelAfter(beat: number, trackId?: string): void {
    const currentBeat = this.getCurrentBeat()
    const lookaheadBeats = secondsToBeats(this.lookahead, this.bpm)
    const effectiveBeat = getEffectiveCancelBeat(beat, currentBeat, lookaheadBeats)
    
    // Cancel on backend
    this.backend.cancelAfter(effectiveBeat, trackId)
    
    // Remove from queue
    if (trackId) {
      this.eventQueue = this.eventQueue.filter(
        e => e.trackId !== trackId || e.beat < effectiveBeat
      )
    } else {
      this.eventQueue = this.eventQueue.filter(e => e.beat < effectiveBeat)
    }
    
    this.reindexQueue()
  }
  
  /**
   * Schedule a callback to run at a specific beat.
   * 
   * @param beat - Target beat
   * @param callback - Function to call
   */
  scheduleCallback(beat: number, callback: () => void): void {
    this.scheduledCallbacks.push({
      beat,
      callback,
      executed: false
    })
    // Sort by beat
    this.scheduledCallbacks.sort((a, b) => a.beat - b.beat)
  }
  
  /**
   * Start the scheduler.
   * 
   * @param startBeat - Beat position to start from (default: 0)
   */
  start(startBeat: number = 0): void {
    if (this.isRunning) return
    
    this.playbackStartTime = this.backend.getCurrentTime()
    this.playbackStartBeat = startBeat
    this.isRunning = true
    
    // Find starting index in queue
    this.reindexQueue()
    
    // Start scheduler loop
    this.intervalId = setInterval(() => this.tick(), this.scheduleInterval)
    this.tick() // Run immediately
  }
  
  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (!this.isRunning) return
    
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    
    this.isRunning = false
    this.backend.cancelAll()
  }
  
  /**
   * Pause the scheduler (keeps state, stops scheduling).
   */
  pause(): void {
    if (!this.isRunning) return
    
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    
    this.isRunning = false
  }
  
  /**
   * Resume from pause.
   */
  resume(): void {
    if (this.isRunning) return
    
    const currentBeat = this.getCurrentBeat()
    this.start(currentBeat)
  }
  
  /**
   * Reset the scheduler to initial state.
   */
  reset(): void {
    this.stop()
    this.eventQueue = []
    this.scheduledIndex = 0
    this.pendingUpdates = []
    this.scheduledCallbacks = []
    this.trackEvents.clear()
    this.playbackStartTime = 0
    this.playbackStartBeat = 0
  }
  
  // ===========================================================================
  // Timing Queries
  // ===========================================================================
  
  /**
   * Get the current beat position.
   */
  getCurrentBeat(): number {
    if (!this.isRunning && this.playbackStartTime === 0) {
      return 0
    }
    
    return getCurrentBeatFromAudioTime(
      this.backend.getCurrentTime(),
      this.playbackStartTime,
      this.playbackStartBeat,
      this.bpm
    )
  }
  
  /**
   * Get the beat at the start of the next bar.
   */
  getNextBarBeat(): number {
    return getNextBarBeat(this.getCurrentBeat(), this.beatsPerMeasure)
  }
  
  /**
   * Get the current bar number (0-indexed).
   */
  getCurrentBar(): number {
    return Math.floor(this.getCurrentBeat() / this.beatsPerMeasure)
  }
  
  /**
   * Check if scheduler is running.
   */
  getIsRunning(): boolean {
    return this.isRunning
  }
  
  // ===========================================================================
  // Configuration
  // ===========================================================================
  
  /**
   * Update the tempo.
   */
  setTempo(bpm: number): void {
    // Record current position before changing tempo
    const currentBeat = this.getCurrentBeat()
    
    this.bpm = bpm
    this.backend.setTempo(bpm)
    
    // Adjust start time/beat to maintain position
    if (this.isRunning) {
      this.playbackStartTime = this.backend.getCurrentTime()
      this.playbackStartBeat = currentBeat
    }
  }
  
  /**
   * Update beats per measure (for bar calculations).
   */
  setBeatsPerMeasure(beatsPerMeasure: number): void {
    this.beatsPerMeasure = beatsPerMeasure
  }
  
  /**
   * Get current tempo.
   */
  getTempo(): number {
    return this.bpm
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Main scheduler tick - called on interval.
   */
  private tick(): void {
    const currentTime = this.backend.getCurrentTime()
    const currentBeat = this.getCurrentBeat()
    const lookaheadTime = currentTime + this.lookahead
    const lookaheadBeat = currentBeat + secondsToBeats(this.lookahead, this.bpm)
    
    // Process pending updates that are due
    this.processPendingUpdates(currentBeat)
    
    // Process scheduled callbacks
    this.processScheduledCallbacks(currentBeat)
    
    // Schedule events within lookahead window
    while (this.scheduledIndex < this.eventQueue.length) {
      const scheduled = this.eventQueue[this.scheduledIndex]
      
      // If event is beyond lookahead, stop
      if (scheduled.beat > lookaheadBeat) {
        break
      }
      
      // Calculate audio time for this event
      const audioTime = getAudioTimeForBeat(
        scheduled.beat,
        this.playbackStartTime,
        this.playbackStartBeat,
        this.bpm
      )
      
      // Skip events that are in the past
      if (audioTime < currentTime - 0.05) {
        this.scheduledIndex++
        continue
      }
      
      // Schedule on backend
      this.backend.schedule(scheduled.event, audioTime)
      this.scheduledIndex++
    }
  }
  
  /**
   * Process pending updates that have reached their target beat.
   */
  private processPendingUpdates(currentBeat: number): void {
    while (this.pendingUpdates.length > 0) {
      const update = this.pendingUpdates[0]
      
      // Check if it's time to apply this update
      if (update.targetBeat > currentBeat) {
        break
      }
      
      // Remove from pending
      this.pendingUpdates.shift()
      
      // Apply the update
      this.splice(update.events, update.targetBeat, update.trackId)
      
      // Invoke callback if provided
      if (update.onApplied) {
        update.onApplied()
      }
    }
  }
  
  /**
   * Process scheduled callbacks that have reached their target beat.
   */
  private processScheduledCallbacks(currentBeat: number): void {
    for (const scheduled of this.scheduledCallbacks) {
      if (scheduled.executed) continue
      
      if (scheduled.beat <= currentBeat) {
        scheduled.executed = true
        try {
          scheduled.callback()
        } catch (e) {
          console.error('Scheduled callback error:', e)
        }
      }
    }
    
    // Clean up executed callbacks
    this.scheduledCallbacks = this.scheduledCallbacks.filter(s => !s.executed)
  }
  
  /**
   * Create a ScheduledEvent from a CompiledEvent.
   */
  private createScheduledEvent(event: CompiledEvent, trackId?: string): ScheduledEvent {
    const beat = this.eventToBeat(event)
    const audioTime = getAudioTimeForBeat(
      beat,
      this.playbackStartTime,
      this.playbackStartBeat,
      this.bpm
    )
    
    return {
      event,
      audioTime,
      beat,
      trackId
    }
  }
  
  /**
   * Convert event start time to beat position.
   */
  private eventToBeat(event: CompiledEvent): number {
    return secondsToBeats(event.startSeconds, this.bpm)
  }
  
  /**
   * Merge two sorted event queues.
   */
  private mergeEventQueues(
    queue1: ScheduledEvent[],
    queue2: ScheduledEvent[]
  ): ScheduledEvent[] {
    const merged = [...queue1, ...queue2]
    merged.sort((a, b) => a.beat - b.beat)
    return merged
  }
  
  /**
   * Find the correct index in the queue for the current beat position.
   */
  private reindexQueue(): void {
    const currentBeat = this.getCurrentBeat()
    const lookaheadBeats = secondsToBeats(this.lookahead, this.bpm)
    const targetBeat = currentBeat - lookaheadBeats
    
    // Binary search for the first event >= targetBeat
    let lo = 0
    let hi = this.eventQueue.length
    
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (this.eventQueue[mid].beat < targetBeat) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    
    this.scheduledIndex = lo
  }
}
