/**
 * @symphonyscript/midi-backend-web
 * 
 * Web MIDI API backend implementing RuntimeBackend interface.
 * Sends note/CC events to external MIDI devices or software.
 * 
 * Browser Requirements:
 * - Secure context (HTTPS or localhost)
 * - User permission for MIDI access
 */

import type { RuntimeBackend, CompiledEvent } from '@symphonyscript/core'

// =============================================================================
// Local Type Definitions
// =============================================================================

/**
 * MIDI device information.
 */
export interface MIDIDevice {
  id: string
  name: string
  manufacturer?: string
}

/**
 * Options for creating a WebMIDIBackend.
 */
export interface WebMIDIBackendOptions {
  /** MIDI output port to use */
  output?: MIDIOutput
  /** Default MIDI channel (1-16, default: 1) */
  defaultChannel?: number
}

// =============================================================================
// Local Utility Functions
// =============================================================================

/**
 * Convert beats to seconds.
 */
function beatsToSeconds(beats: number, bpm: number): number {
  return (beats / bpm) * 60
}

/**
 * Convert seconds to beats.
 */
function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds / 60) * bpm
}

// =============================================================================
// Constants
// =============================================================================

/** MIDI message types */
const MIDI_NOTE_ON = 0x90
const MIDI_NOTE_OFF = 0x80
const MIDI_CONTROL_CHANGE = 0xB0

/** Default MIDI channel (0-indexed internally, 1-16 for users) */
const DEFAULT_CHANNEL = 0

// =============================================================================
// Scheduled MIDI Event
// =============================================================================

interface ScheduledMidiEvent {
  /** Timeout ID for the note on */
  noteOnTimeout: ReturnType<typeof setTimeout> | null
  /** Timeout ID for the note off */
  noteOffTimeout: ReturnType<typeof setTimeout> | null
  /** Beat position */
  beat: number
  /** Track ID */
  trackId?: string
  /** MIDI note number for note off */
  noteNumber?: number
  /** MIDI channel for note off */
  channel: number
}

// =============================================================================
// WebMIDIBackend
// =============================================================================

/**
 * Web MIDI backend for live coding.
 * 
 * Features:
 * - Web MIDI API integration
 * - Per-track channel mapping
 * - Note scheduling with proper note-off handling
 * - Graceful degradation when MIDI unavailable
 */
export class WebMIDIBackend implements RuntimeBackend {
  // MIDI state
  private midiAccess: MIDIAccess | null = null
  private midiOutput: MIDIOutput | null = null
  
  // Configuration
  private defaultChannel: number
  
  // Track-to-channel mapping
  private trackChannels: Map<string, number> = new Map()
  
  // Scheduled events for cancellation
  private scheduledEvents: ScheduledMidiEvent[] = []
  
  // State
  private bpm: number = 120
  private disposed: boolean = false
  private initialized: boolean = false
  
  // Timing reference (we need a time source since MIDI doesn't have one)
  private startTime: number = 0
  
  constructor(options: WebMIDIBackendOptions = {}) {
    this.midiOutput = options.output ?? null
    this.defaultChannel = (options.defaultChannel ?? 1) - 1 // Convert to 0-indexed
    this.startTime = performance.now()
  }
  
  // ===========================================================================
  // Static Methods
  // ===========================================================================
  
  /**
   * Check if Web MIDI API is supported in the current environment.
   */
  static async isSupported(): Promise<boolean> {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }
  
  // ===========================================================================
  // RuntimeBackend Implementation
  // ===========================================================================
  
  /**
   * Request MIDI access from the browser.
   * Must be called before scheduling events.
   * 
   * @returns True if MIDI access was granted
   */
  async init(): Promise<boolean> {
    if (this.initialized) return this.midiOutput !== null
    
    // Check for Web MIDI API support
    if (!(await WebMIDIBackend.isSupported())) {
      console.warn('WebMIDIBackend: Web MIDI API not supported in this browser')
      this.initialized = true
      return false
    }
    
    try {
      this.midiAccess = await navigator.requestMIDIAccess()
      
      // If no output was provided, try to get the first available
      if (!this.midiOutput) {
        const outputs = this.getMidiOutputs()
        if (outputs.length > 0) {
          this.midiOutput = outputs[0]
          console.log(`WebMIDIBackend: Using output "${this.midiOutput.name}"`)
        } else {
          console.warn('WebMIDIBackend: No MIDI outputs available')
        }
      }
      
      this.initialized = true
      return this.midiOutput !== null
    } catch (err) {
      console.warn('WebMIDIBackend: MIDI access denied or unavailable:', err)
      this.initialized = true
      return false
    }
  }
  
  /**
   * Schedule an event for MIDI output.
   */
  schedule(event: CompiledEvent, audioTime: number): void {
    if (this.disposed || !this.midiOutput) return
    
    // Calculate delay from current time
    const now = this.getCurrentTime()
    const delay = Math.max(0, (audioTime - now) * 1000) // Convert to ms
    
    // Get track channel
    const trackId = this.getTrackIdFromEvent(event)
    const channel = this.getChannelForTrack(trackId)
    
    // Schedule based on event type
    if (event.kind === 'note') {
      this.scheduleNote(event, delay, channel, trackId, audioTime)
    } else if (event.kind === 'control') {
      this.scheduleControl(event, delay, channel)
    }
  }
  
  /**
   * Cancel all events after a specific beat.
   */
  cancelAfter(beat: number, trackId?: string): void {
    if (this.disposed) return
    
    // Find events to cancel
    const toCancel = this.scheduledEvents.filter(e => {
      const beatMatch = e.beat >= beat
      const trackMatch = trackId === undefined || e.trackId === trackId
      return beatMatch && trackMatch
    })
    
    // Cancel timeouts and send note offs
    for (const scheduled of toCancel) {
      if (scheduled.noteOnTimeout) {
        clearTimeout(scheduled.noteOnTimeout)
      }
      if (scheduled.noteOffTimeout) {
        clearTimeout(scheduled.noteOffTimeout)
      }
      
      // Send immediate note off if note was already triggered
      if (scheduled.noteNumber !== undefined && this.midiOutput) {
        const noteOff = [MIDI_NOTE_OFF | scheduled.channel, scheduled.noteNumber, 0]
        this.midiOutput.send(noteOff)
      }
    }
    
    // Remove cancelled events
    this.scheduledEvents = this.scheduledEvents.filter(e => {
      const beatMatch = e.beat >= beat
      const trackMatch = trackId === undefined || e.trackId === trackId
      return !(beatMatch && trackMatch)
    })
  }
  
  /**
   * Cancel all scheduled events.
   */
  cancelAll(): void {
    if (this.disposed) return
    
    // Cancel all timeouts
    for (const scheduled of this.scheduledEvents) {
      if (scheduled.noteOnTimeout) clearTimeout(scheduled.noteOnTimeout)
      if (scheduled.noteOffTimeout) clearTimeout(scheduled.noteOffTimeout)
      
      // Send note off
      if (scheduled.noteNumber !== undefined && this.midiOutput) {
        const noteOff = [MIDI_NOTE_OFF | scheduled.channel, scheduled.noteNumber, 0]
        this.midiOutput.send(noteOff)
      }
    }
    
    // All notes off on all channels
    if (this.midiOutput) {
      for (let ch = 0; ch < 16; ch++) {
        // CC 123 = All Notes Off
        this.midiOutput.send([MIDI_CONTROL_CHANGE | ch, 123, 0])
      }
    }
    
    this.scheduledEvents = []
  }
  
  /**
   * Get current time (using performance.now since MIDI has no clock).
   */
  getCurrentTime(): number {
    return (performance.now() - this.startTime) / 1000
  }
  
  /**
   * Update tempo.
   */
  setTempo(bpm: number): void {
    this.bpm = bpm
  }
  
  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.disposed) return
    
    this.cancelAll()
    
    this.midiOutput = null
    this.midiAccess = null
    this.trackChannels.clear()
    this.disposed = true
  }
  
  // ===========================================================================
  // MIDI-Specific Methods
  // ===========================================================================
  
  /**
   * List available MIDI outputs.
   */
  async listOutputs(): Promise<MIDIDevice[]> {
    if (!this.midiAccess) {
      await this.init()
    }
    
    return this.getMidiOutputs().map(output => ({
      id: output.id,
      name: output.name ?? 'Unknown',
      manufacturer: output.manufacturer ?? undefined
    }))
  }
  
  /**
   * Select a MIDI output by device ID.
   */
  async selectOutput(deviceId: string): Promise<boolean> {
    const outputs = await this.listOutputs()
    const rawOutputs = this.getMidiOutputs()
    
    const index = outputs.findIndex(o => o.id === deviceId)
    if (index >= 0 && index < rawOutputs.length) {
      this.midiOutput = rawOutputs[index]
      return true
    }
    
    return false
  }
  
  /**
   * Get the currently selected MIDI output.
   */
  getSelectedOutput(): MIDIDevice | null {
    if (!this.midiOutput) return null
    
    return {
      id: this.midiOutput.id,
      name: this.midiOutput.name ?? 'Unknown',
      manufacturer: this.midiOutput.manufacturer ?? undefined
    }
  }
  
  // ===========================================================================
  // Extended API
  // ===========================================================================
  
  /**
   * Set MIDI channel for a track.
   * 
   * @param trackId - Track identifier
   * @param channel - MIDI channel (1-16)
   */
  setTrackChannel(trackId: string, channel: number): void {
    // Convert to 0-indexed
    this.trackChannels.set(trackId, Math.max(0, Math.min(15, channel - 1)))
  }
  
  /**
   * Get the current MIDI output name.
   */
  getOutputName(): string | null {
    return this.midiOutput?.name ?? null
  }
  
  /**
   * Check if backend is ready.
   */
  isReady(): boolean {
    return this.initialized && !this.disposed && this.midiOutput !== null
  }
  
  /**
   * Send raw MIDI message (for advanced usage).
   */
  sendRaw(data: number[]): void {
    if (this.midiOutput) {
      this.midiOutput.send(data)
    }
  }
  
  /**
   * Reset start time reference.
   */
  resetTime(): void {
    this.startTime = performance.now()
  }
  
  // ===========================================================================
  // Private Methods
  // ===========================================================================
  
  /**
   * Get MIDI outputs from the access object (handles iterator conversion).
   */
  private getMidiOutputs(): MIDIOutput[] {
    if (!this.midiAccess) return []
    
    const outputs: MIDIOutput[] = []
    this.midiAccess.outputs.forEach((output) => {
      outputs.push(output)
    })
    return outputs
  }
  
  /**
   * Schedule a note event.
   */
  private scheduleNote(
    event: CompiledEvent & { kind: 'note' },
    delay: number,
    channel: number,
    trackId: string,
    audioTime: number
  ): void {
    const pitch = event.payload.pitch as string
    if (!pitch) return
    
    // Skip drum names (they're not actual pitches)
    const lowerPitch = pitch.toLowerCase()
    if (lowerPitch.includes('kick') || 
        lowerPitch.includes('snare') || 
        lowerPitch.includes('hat') ||
        lowerPitch.includes('clap')) {
      // Could map these to specific drum notes (GM drum map)
      // For now, skip
      return
    }
    
    const noteNumber = this.pitchToMidi(pitch)
    if (noteNumber === null) return
    
    const velocity = this.normalizeVelocity(event.payload.velocity)
    const duration = (event.durationSeconds ?? 0.25) * 1000 // Convert to ms
    const beat = secondsToBeats(audioTime, this.bpm)
    
    // Create scheduled event record
    const scheduled: ScheduledMidiEvent = {
      noteOnTimeout: null,
      noteOffTimeout: null,
      beat,
      trackId,
      noteNumber,
      channel
    }
    
    // Schedule note on
    scheduled.noteOnTimeout = setTimeout(() => {
      if (this.midiOutput && !this.disposed) {
        const noteOn = [MIDI_NOTE_ON | channel, noteNumber, velocity]
        this.midiOutput.send(noteOn)
      }
      scheduled.noteOnTimeout = null
    }, delay)
    
    // Schedule note off
    scheduled.noteOffTimeout = setTimeout(() => {
      if (this.midiOutput && !this.disposed) {
        const noteOff = [MIDI_NOTE_OFF | channel, noteNumber, 0]
        this.midiOutput.send(noteOff)
      }
      scheduled.noteOffTimeout = null
      
      // Remove from tracking
      this.scheduledEvents = this.scheduledEvents.filter(e => e !== scheduled)
    }, delay + duration)
    
    this.scheduledEvents.push(scheduled)
  }
  
  /**
   * Schedule a control change event.
   */
  private scheduleControl(
    event: CompiledEvent & { kind: 'control' },
    delay: number,
    channel: number
  ): void {
    const controller = event.payload.controller as number
    const value = event.payload.value as number
    
    setTimeout(() => {
      if (this.midiOutput && !this.disposed) {
        const cc = [MIDI_CONTROL_CHANGE | channel, controller, value]
        this.midiOutput.send(cc)
      }
    }, delay)
  }
  
  /**
   * Get channel for a track.
   */
  private getChannelForTrack(trackId: string): number {
    return this.trackChannels.get(trackId) ?? this.defaultChannel
  }
  
  /**
   * Extract track ID from event.
   */
  private getTrackIdFromEvent(event: CompiledEvent): string {
    return event.channel ? `track-${event.channel}` : 'default'
  }
  
  /**
   * Convert pitch string to MIDI note number.
   */
  private pitchToMidi(pitch: string): number | null {
    const match = pitch.match(/^([A-Ga-g])([#b]?)(\d+)$/)
    if (!match) return null
    
    const noteMap: Record<string, number> = {
      'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
    }
    
    const letter = match[1].toUpperCase()
    const accidental = match[2]
    const octave = parseInt(match[3], 10)
    
    let semitone = noteMap[letter]
    if (semitone === undefined) return null
    
    if (accidental === '#') semitone++
    if (accidental === 'b') semitone--
    
    // MIDI note number
    return semitone + (octave + 1) * 12
  }
  
  /**
   * Normalize velocity to MIDI range (0-127).
   */
  private normalizeVelocity(velocity: unknown): number {
    if (typeof velocity !== 'number') return 100
    
    const v = velocity as number
    
    // If already in 0-127 range
    if (v <= 127) {
      return Math.round(v)
    }
    
    // If in 0-1 range
    return Math.round(v * 127)
  }
}


