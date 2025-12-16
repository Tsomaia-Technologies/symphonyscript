/**
 * @symphonyscript/midi-backend-node
 * 
 * Node.js MIDI backend using jzz library.
 * Implements RuntimeBackend interface.
 * 
 * Requirements:
 * - Node.js 18+
 * - jzz package installed
 */

import type { RuntimeBackend, CompiledEvent } from '@symphonyscript/core'

// jzz types are untyped, using any for internal jzz state
import JZZ from 'jzz'

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
 * Options for creating a NodeMIDIBackend.
 */
export interface NodeMIDIBackendOptions {
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
// NodeMIDIBackend
// =============================================================================

/**
 * Node.js MIDI backend using jzz library.
 * 
 * Features:
 * - jzz library integration for cross-platform MIDI
 * - Per-track channel mapping
 * - Note scheduling with proper note-off handling
 * - Graceful degradation when MIDI unavailable
 */
export class NodeMIDIBackend implements RuntimeBackend {
  // jzz state
  private midi: any = null
  private midiOutput: any = null
  
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
  
  // Timing reference
  private startTime: number = 0
  
  // Selected output info
  private selectedDevice: MIDIDevice | null = null
  
  constructor(options: NodeMIDIBackendOptions = {}) {
    this.defaultChannel = (options.defaultChannel ?? 1) - 1 // Convert to 0-indexed
    this.startTime = performance.now()
  }
  
  // ===========================================================================
  // Static Methods
  // ===========================================================================
  
  /**
   * Check if Node.js MIDI is supported (always true in Node.js environment).
   */
  static async isSupported(): Promise<boolean> {
    return typeof process !== 'undefined' && process.versions?.node !== undefined
  }
  
  // ===========================================================================
  // RuntimeBackend Implementation
  // ===========================================================================
  
  /**
   * Initialize the jzz MIDI engine.
   * 
   * @returns True if initialization succeeded
   */
  async init(): Promise<boolean> {
    if (this.initialized) return this.midiOutput !== null
    
    try {
      this.midi = await JZZ()
      
      // Try to open the first available output
      const outputs = await this.listOutputs()
      if (outputs.length > 0) {
        await this.selectOutput(outputs[0].id)
        console.log(`NodeMIDIBackend: Using output "${outputs[0].name}"`)
      } else {
        console.warn('NodeMIDIBackend: No MIDI outputs available')
      }
      
      this.initialized = true
      return this.midiOutput !== null
    } catch (err) {
      console.warn('NodeMIDIBackend: JZZ initialization failed:', err)
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
        this.sendNoteOff(scheduled.channel, scheduled.noteNumber)
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
        this.sendNoteOff(scheduled.channel, scheduled.noteNumber)
      }
    }
    
    // All notes off on all channels
    if (this.midiOutput) {
      for (let ch = 0; ch < 16; ch++) {
        // CC 123 = All Notes Off
        this.sendControlChange(ch, 123, 0)
      }
    }
    
    this.scheduledEvents = []
  }
  
  /**
   * Get current time (using performance.now).
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
    
    if (this.midiOutput) {
      try {
        this.midiOutput.close()
      } catch {
        // Ignore close errors
      }
    }
    
    this.midiOutput = null
    this.midi = null
    this.trackChannels.clear()
    this.selectedDevice = null
    this.disposed = true
  }
  
  // ===========================================================================
  // MIDI-Specific Methods
  // ===========================================================================
  
  /**
   * List available MIDI outputs.
   */
  async listOutputs(): Promise<MIDIDevice[]> {
    if (!this.midi) {
      try {
        this.midi = await JZZ()
      } catch {
        return []
      }
    }
    
    const info = this.midi.info()
    if (!info || !info.outputs) return []
    
    return info.outputs.map((output: any, index: number) => ({
      id: String(index),
      name: output.name || `Output ${index}`,
      manufacturer: output.manufacturer || undefined
    }))
  }
  
  /**
   * Select a MIDI output by device ID.
   */
  async selectOutput(deviceId: string): Promise<boolean> {
    if (!this.midi) {
      try {
        this.midi = await JZZ()
      } catch {
        return false
      }
    }
    
    const outputs = await this.listOutputs()
    const device = outputs.find(o => o.id === deviceId)
    
    if (!device) return false
    
    try {
      const index = parseInt(deviceId, 10)
      this.midiOutput = this.midi.openMidiOut(index)
      this.selectedDevice = device
      return true
    } catch (err) {
      console.warn('NodeMIDIBackend: Failed to open MIDI output:', err)
      return false
    }
  }
  
  /**
   * Get the currently selected MIDI output.
   */
  getSelectedOutput(): MIDIDevice | null {
    return this.selectedDevice
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
    return this.selectedDevice?.name ?? null
  }
  
  /**
   * Check if backend is ready.
   */
  isReady(): boolean {
    return this.initialized && !this.disposed && this.midiOutput !== null
  }
  
  /**
   * Reset start time reference.
   */
  resetTime(): void {
    this.startTime = performance.now()
  }
  
  // ===========================================================================
  // Private Methods - MIDI Message Sending
  // ===========================================================================
  
  /**
   * Send a note on message.
   */
  private sendNoteOn(channel: number, note: number, velocity: number): void {
    if (!this.midiOutput) return
    try {
      this.midiOutput.send([MIDI_NOTE_ON | channel, note, velocity])
    } catch {
      // Ignore send errors
    }
  }
  
  /**
   * Send a note off message.
   */
  private sendNoteOff(channel: number, note: number): void {
    if (!this.midiOutput) return
    try {
      this.midiOutput.send([MIDI_NOTE_OFF | channel, note, 0])
    } catch {
      // Ignore send errors
    }
  }
  
  /**
   * Send a control change message.
   */
  private sendControlChange(channel: number, controller: number, value: number): void {
    if (!this.midiOutput) return
    try {
      this.midiOutput.send([MIDI_CONTROL_CHANGE | channel, controller, value])
    } catch {
      // Ignore send errors
    }
  }
  
  // ===========================================================================
  // Private Methods - Scheduling
  // ===========================================================================
  
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
        this.sendNoteOn(channel, noteNumber, velocity)
      }
      scheduled.noteOnTimeout = null
    }, delay)
    
    // Schedule note off
    scheduled.noteOffTimeout = setTimeout(() => {
      if (this.midiOutput && !this.disposed) {
        this.sendNoteOff(channel, noteNumber)
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
        this.sendControlChange(channel, controller, value)
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
