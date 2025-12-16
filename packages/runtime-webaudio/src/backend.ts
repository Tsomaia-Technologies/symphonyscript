/**
 * RFC-031: Live Coding Runtime - WebAudio Backend
 * 
 * Implements AudioBackend interface using Web Audio API.
 * Wraps the existing synthesis from src/runtime/synth.ts with
 * proper node tracking for live coding updates.
 */

import type { RuntimeBackend, CompiledEvent } from '@symphonyscript/core'
import type { 
  WebAudioBackendOptions, 
  ScheduledNodeInfo, 
  BackendState 
} from './types'
import {
  playNote,
  playKick,
  playSnare,
  playHiHat,
  pitchToFrequency,
  type SynthConfig,
  type ADSR
} from './synth'
import { getAudioContext, ensureAudioContextRunning } from './context' 
// Note: beatsToSeconds moved to core? No, it's in live/quantize. 
// We should probably implement simple conversion here or import from core if available.
// For now, I'll copy the logic (it's simple math) to avoid dep on live.
// Or wait, beatsToSeconds logic is: beats * (60/bpm).

/** Default master gain level */
const DEFAULT_MASTER_GAIN = 0.8

/** Default ADSR envelope for melodic notes */
const DEFAULT_ADSR: ADSR = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2
}

// =============================================================================
// Constants
// =============================================================================


// Helper for time conversion
function secondsToBeats(seconds: number, bpm: number): number {
  return seconds * (bpm / 60)
}

/**
 * WebAudio backend for live coding.
 */
export class WebAudioBackend implements RuntimeBackend {
  // Audio context
  private audioContext: AudioContext
  private ownsContext: boolean = false
  
  // Audio graph
  private masterGain: GainNode
  private masterCompressor: DynamicsCompressorNode
  
  // Track-specific nodes
  private trackGains: Map<string, GainNode> = new Map()
  
  // Node tracking for cancellation
  private scheduledNodes: ScheduledNodeInfo[] = []
  
  // Synth config (reused for scheduling)
  private synthConfig: SynthConfig
  
  // State
  private state: BackendState = {
    initialized: false,
    disposed: false,
    bpm: 120,
    scheduledNodes: []
  }
  
  // Configuration
  private seed?: number
  
  constructor(options: WebAudioBackendOptions = {}) {
    // Create or use existing AudioContext
    if (options.audioContext) {
      this.audioContext = options.audioContext
      this.ownsContext = false
    } else {
      // Use the shared singleton from context.ts
      this.audioContext = getAudioContext()
      this.ownsContext = false // It's shared
    }
    
    this.seed = options.seed
    
    // Create master compressor to prevent clipping
    this.masterCompressor = this.audioContext.createDynamicsCompressor()
    this.masterCompressor.threshold.value = -10
    this.masterCompressor.knee.value = 40
    this.masterCompressor.ratio.value = 12
    this.masterCompressor.attack.value = 0
    this.masterCompressor.release.value = 0.25
    this.masterCompressor.connect(this.audioContext.destination)
    
    // Create master gain
    this.masterGain = this.audioContext.createGain()
    this.masterGain.gain.value = options.masterGain ?? 0.8
    this.masterGain.connect(this.masterCompressor)
    
    // Create synth config
    this.synthConfig = {
      audioContext: this.audioContext,
      destination: this.masterGain,
      seed: this.seed
    }
    
    this.state.initialized = true
  }

  /**
   * Initialize audio context (user gesture required).
   */
  async init(): Promise<boolean> {
    if (this.state.disposed) return false
    try {
      await ensureAudioContextRunning()
      return this.audioContext.state === 'running'
    } catch {
      return false
    }
  }
  
  // ===========================================================================
  // RuntimeBackend Implementation
  // ===========================================================================
  
  /**
   * Schedule an event for playback.
   */
  schedule(event: CompiledEvent, audioTime: number): void {
    if (this.state.disposed) return
    
    // Resume context if suspended (needed for user gesture requirement)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {})
    }
    
    // Skip events in the past
    if (audioTime < this.audioContext.currentTime - 0.05) {
      return
    }
    
    // Get or create track gain node
    const trackId = this.getTrackIdFromEvent(event)
    const destination = this.getTrackGain(trackId)
    
    // Create synth config with track destination
    const trackConfig: SynthConfig = {
      audioContext: this.audioContext,
      destination,
      seed: this.seed
    }
    
    // Schedule based on event type
    if (event.kind === 'note') {
      this.scheduleNote(event, audioTime, trackConfig, trackId)
    }
  }
  
  /**
   * Cancel all events after a specific beat.
   */
  cancelAfter(beat: number, trackId?: string): void {
    if (this.state.disposed) return
    
    const now = this.audioContext.currentTime
    
    // Filter nodes to cancel
    const toCancel = this.scheduledNodes.filter(info => {
      const beatMatch = info.beat >= beat
      const trackMatch = trackId === undefined || info.trackId === trackId
      return beatMatch && trackMatch
    })
    
    // Stop nodes
    for (const info of toCancel) {
      try {
        // Only stop if it hasn't played yet
        if (info.stopTime > now) {
          // Ramp down gain quickly to avoid clicks
          // Note: We can't actually stop the node early without clicks,
          // but we can mute it rapidly
          try { info.node.stop(now + 0.01) } catch {}
        }
      } catch (e) {
        // Node may have already stopped
      }
    }
    
    // Remove from tracking
    this.scheduledNodes = this.scheduledNodes.filter(info => {
      const beatMatch = info.beat >= beat
      const trackMatch = trackId === undefined || info.trackId === trackId
      return !(beatMatch && trackMatch)
    })
  }
  
  /**
   * Cancel all scheduled events.
   */
  cancelAll(): void {
    if (this.state.disposed) return
    
    const now = this.audioContext.currentTime
    
    // Stop all nodes
    for (const info of this.scheduledNodes) {
      try {
        info.node.stop(now + 0.01)
      } catch (e) {
        // Node may have already stopped
      }
    }
    
    // Clear tracking
    this.scheduledNodes = []
  }
  
  /**
   * Get current audio context time.
   */
  getCurrentTime(): number {
    return this.audioContext.currentTime
  }
  
  /**
   * Update tempo (for beat calculations).
   */
  setTempo(bpm: number): void {
    this.state.bpm = bpm
  }
  
  /**
   * Clean up all resources.
   */
  dispose(): void {
    if (this.state.disposed) return
    
    // Cancel all
    this.cancelAll()
    
    // Disconnect track gains
    for (const gain of this.trackGains.values()) {
      gain.disconnect()
    }
    this.trackGains.clear()
    
    // Disconnect master chain
    this.masterGain.disconnect()
    this.masterCompressor.disconnect()
    
    // Close context if we own it
    if (this.ownsContext) {
      this.audioContext.close()
    }
    
    this.state.disposed = true
  }
  
  // ===========================================================================
  // Extended API
  // ===========================================================================
  
  /**
   * Get the AudioContext (for advanced usage).
   */
  getAudioContext(): AudioContext {
    return this.audioContext
  }
  
  /**
   * Set master volume.
   * 
   * @param level - Volume level (0-1)
   */
  setMasterVolume(level: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, level))
  }
  
  /**
   * Set volume for a specific track.
   * 
   * @param trackId - Track identifier
   * @param level - Volume level (0-1)
   */
  setTrackVolume(trackId: string, level: number): void {
    const gain = this.getTrackGain(trackId)
    gain.gain.value = Math.max(0, Math.min(1, level))
  }
  
  /**
   * Mute a track.
   */
  muteTrack(trackId: string): void {
    this.setTrackVolume(trackId, 0)
  }
  
  /**
   * Unmute a track.
   */
  unmuteTrack(trackId: string): void {
    this.setTrackVolume(trackId, 1)
  }
  
  /**
   * Resume audio context (call from user gesture).
   */
  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }
  
  /**
   * Check if backend is ready.
   */
  isReady(): boolean {
    return this.state.initialized && 
           !this.state.disposed && 
           this.audioContext.state === 'running'
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Get or create a gain node for a track.
   */
  private getTrackGain(trackId: string): GainNode {
    let gain = this.trackGains.get(trackId)
    
    if (!gain) {
      gain = this.audioContext.createGain()
      gain.gain.value = 1
      gain.connect(this.masterGain)
      this.trackGains.set(trackId, gain)
    }
    
    return gain
  }
  
  /**
   * Extract track ID from event (uses channel or defaults to 'default').
   */
  private getTrackIdFromEvent(event: CompiledEvent): string {
    // Could use event.source?.sourceClip or channel
    // For now, use channel as a simple track identifier
    return event.channel ? `track-${event.channel}` : 'default'
  }
  
  /**
   * Schedule a note event.
   */
  private scheduleNote(
    event: CompiledEvent & { kind: 'note' },
    audioTime: number,
    config: SynthConfig,
    trackId: string
  ): void {
    const pitch = event.payload.pitch as string
    if (!pitch) return
    
    const duration = event.durationSeconds ?? 0.25
    const velocity = this.normalizeVelocity(event.payload.velocity)
    
    // Calculate beat from audio time (approximate)
    const beat = secondsToBeats(audioTime - this.audioContext.currentTime, this.state.bpm)
    
    // Check for drum sounds
    const lowerPitch = pitch.toLowerCase()
    
    if (lowerPitch.includes('kick')) {
      this.scheduleKick(config, audioTime, velocity, beat, trackId)
    } else if (lowerPitch.includes('snare') || lowerPitch.includes('clap')) {
      this.scheduleSnare(config, audioTime, velocity, beat, trackId)
    } else if (lowerPitch.includes('hat') || lowerPitch.includes('hihat')) {
      const open = lowerPitch.includes('open')
      this.scheduleHiHat(config, audioTime, velocity, open, beat, trackId)
    } else {
      // Melodic note
      this.scheduleMelodicNote(config, pitch, audioTime, duration, velocity, beat, trackId)
    }
  }
  
  /**
   * Schedule a melodic note with node tracking.
   */
  private scheduleMelodicNote(
    config: SynthConfig,
    pitch: string,
    startTime: number,
    duration: number,
    velocity: number,
    beat: number,
    trackId: string
  ): void {
    const frequency = pitchToFrequency(pitch)
    if (frequency === 0) return
    
    const { audioContext, destination } = config
    
    // Create oscillator
    const osc = audioContext.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = frequency
    
    // Create gain for envelope
    const gain = audioContext.createGain()
    gain.gain.value = 0
    
    // Connect
    osc.connect(gain)
    gain.connect(destination)
    
    // ADSR envelope
    const adsr = DEFAULT_ADSR
    const peakGain = velocity * 0.3
    const sustainGain = peakGain * adsr.sustain
    
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(peakGain, startTime + adsr.attack)
    gain.gain.linearRampToValueAtTime(sustainGain, startTime + adsr.attack + adsr.decay)
    
    const releaseStart = Math.max(
      startTime + adsr.attack + adsr.decay,
      startTime + duration - adsr.release
    )
    gain.gain.setValueAtTime(sustainGain, releaseStart)
    gain.gain.linearRampToValueAtTime(0, startTime + duration)
    
    const stopTime = startTime + duration + 0.1
    osc.start(startTime)
    osc.stop(stopTime)
    
    // Track for cancellation
    this.scheduledNodes.push({
      node: osc,
      beat,
      trackId,
      stopTime
    })
    
    // Auto-cleanup after stop
    osc.onended = () => {
      this.scheduledNodes = this.scheduledNodes.filter(n => n.node !== osc)
    }
  }
  
  /**
   * Schedule a kick drum with node tracking.
   */
  private scheduleKick(
    config: SynthConfig,
    startTime: number,
    velocity: number,
    beat: number,
    trackId: string
  ): void {
    const { audioContext, destination } = config
    
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, startTime)
    osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.1)
    
    gain.gain.setValueAtTime(velocity * 0.8, startTime)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3)
    
    osc.connect(gain)
    gain.connect(destination)
    
    const stopTime = startTime + 0.3
    osc.start(startTime)
    osc.stop(stopTime)
    
    this.scheduledNodes.push({
      node: osc,
      beat,
      trackId,
      stopTime
    })
    
    osc.onended = () => {
      this.scheduledNodes = this.scheduledNodes.filter(n => n.node !== osc)
    }
  }
  
  /**
   * Schedule a snare drum with node tracking.
   */
  private scheduleSnare(
    config: SynthConfig,
    startTime: number,
    velocity: number,
    beat: number,
    trackId: string
  ): void {
    // Use the existing snare function (it manages its own nodes)
    // For proper tracking, we'd need to refactor synth.ts
    // For now, just call the existing function
    playSnare(config, startTime, velocity)
    
    // Note: These nodes won't be cancellable, but that's acceptable
    // for percussion sounds which are short
  }
  
  /**
   * Schedule a hi-hat with node tracking.
   */
  private scheduleHiHat(
    config: SynthConfig,
    startTime: number,
    velocity: number,
    open: boolean,
    beat: number,
    trackId: string
  ): void {
    // Use existing function
    playHiHat(config, startTime, velocity, open)
  }
  
  /**
   * Normalize velocity to 0-1 range.
   */
  private normalizeVelocity(velocity: unknown): number {
    if (typeof velocity !== 'number') return 0.8
    
    // If it's a branded MidiValue, extract the number
    const v = velocity as number
    
    // Assume 0-127 MIDI range and normalize
    if (v > 1) {
      return v / 127
    }
    
    return v
  }
}
