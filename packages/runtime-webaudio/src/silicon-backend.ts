// =============================================================================
// SymphonyScript - Silicon Backend (RFC-043 Phase 3)
// =============================================================================
// High-level backend that integrates Silicon Linker with WebAudio synthesis.

import { SiliconNode, createSiliconNode } from './silicon-node'
import type { SiliconMidiEvent, SiliconNoteEvent, PlayheadHandler } from './silicon-node'
import { getAudioContext, ensureAudioContextRunning } from './context'
import { pitchToFrequency, type SynthConfig, type ADSR } from './synth'

// SAB Header offsets (must match @symphonyscript/core/linker/constants.ts)
const HDR_PPQ = 2
const HDR_BPM = 3
const HDR_PLAYHEAD_TICK = 7

// =============================================================================
// Constants
// =============================================================================

/** Default ADSR envelope */
const DEFAULT_ADSR: ADSR = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2
}

/** Lookahead time for scheduling (seconds) */
const LOOKAHEAD_SECONDS = 0.05

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a SiliconBackend.
 */
export interface SiliconBackendOptions {
  /** AudioContext to use */
  audioContext?: AudioContext
  /** Path to the processor module */
  processorPath?: string
  /** Master gain level (0-1) */
  masterGain?: number
  /** Callback for playhead updates */
  onPlayhead?: PlayheadHandler
}

/**
 * Scheduled note info for cleanup.
 */
interface ScheduledNote {
  oscillator: OscillatorNode
  gain: GainNode
  stopTime: number
  sourceId: number
}

// =============================================================================
// SiliconBackend
// =============================================================================

/**
 * High-level backend that integrates Silicon Linker with WebAudio synthesis.
 *
 * This backend:
 * - Creates and manages the SiliconNode (AudioWorklet consumer)
 * - Converts MIDI events from the processor into audio
 * - Provides transport controls (play/pause/stop/seek)
 * - Manages the audio graph (master gain, compressor)
 */
export class SiliconBackend {
  private audioContext: AudioContext
  private siliconNode: SiliconNode
  private masterGain: GainNode
  private masterCompressor: DynamicsCompressorNode
  private scheduledNotes: ScheduledNote[] = []
  private isInitialized: boolean = false
  private buffer: SharedArrayBuffer | null = null
  private sab: Int32Array | null = null
  private onPlayhead: PlayheadHandler | null = null

  constructor(options: SiliconBackendOptions = {}) {
    this.audioContext = options.audioContext ?? getAudioContext()
    this.onPlayhead = options.onPlayhead ?? null

    // Create master compressor
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

    // Create silicon node
    this.siliconNode = createSiliconNode({
      audioContext: this.audioContext,
      processorPath: options.processorPath,
      onMidiEvent: (events) => this.handleMidiEvents(events),
      onPlayhead: (tick) => this.handlePlayhead(tick)
    })
  }

  /**
   * Initialize the backend with a SharedArrayBuffer.
   *
   * @param buffer - SharedArrayBuffer from the Silicon Linker
   */
  async init(buffer: SharedArrayBuffer): Promise<void> {
    if (this.isInitialized) {
      throw new Error('SiliconBackend already initialized')
    }

    this.buffer = buffer
    this.sab = new Int32Array(buffer)

    await ensureAudioContextRunning()
    await this.siliconNode.init(buffer)

    this.isInitialized = true
  }

  /**
   * Handle MIDI events from the processor.
   */
  private handleMidiEvents(events: SiliconMidiEvent[]): void {
    const now = this.audioContext.currentTime

    for (const event of events) {
      if (event.type === 'note') {
        this.scheduleNote(event, now)
      }
      // CC and bend events would be handled here for external MIDI output
    }

    // Cleanup old notes
    this.cleanupScheduledNotes()
  }

  /**
   * Handle playhead updates.
   */
  private handlePlayhead(tick: number): void {
    if (this.onPlayhead) {
      this.onPlayhead(tick)
    }
  }

  /**
   * Schedule a note for playback.
   */
  private scheduleNote(event: SiliconNoteEvent, baseTime: number): void {
    if (!this.sab) return

    const ppq = this.sab[HDR_PPQ]
    const bpm = this.sab[HDR_BPM]
    const playheadTick = Atomics.load(this.sab, HDR_PLAYHEAD_TICK)

    // Convert tick offset to seconds
    const ticksPerSecond = (bpm / 60) * ppq
    const tickOffset = event.tick - playheadTick
    const secondsOffset = tickOffset / ticksPerSecond

    // Calculate audio time with lookahead
    const audioTime = baseTime + LOOKAHEAD_SECONDS + Math.max(0, secondsOffset)

    // Skip if in the past
    if (audioTime < this.audioContext.currentTime) {
      return
    }

    // Convert MIDI pitch to frequency
    const frequency = this.midiToFrequency(event.pitch)
    if (frequency <= 0) return

    // Convert MIDI velocity to gain (0-1)
    const velocity = event.velocity / 127

    // Convert duration in ticks to seconds
    const durationSeconds = event.duration / ticksPerSecond

    // Create oscillator
    const oscillator = this.audioContext.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency

    // Create gain for envelope
    const gain = this.audioContext.createGain()
    gain.gain.value = 0

    // Connect
    oscillator.connect(gain)
    gain.connect(this.masterGain)

    // Apply ADSR envelope
    const adsr = DEFAULT_ADSR
    const peakGain = velocity * 0.3
    const sustainGain = peakGain * adsr.sustain

    gain.gain.setValueAtTime(0, audioTime)
    gain.gain.linearRampToValueAtTime(peakGain, audioTime + adsr.attack)
    gain.gain.linearRampToValueAtTime(
      sustainGain,
      audioTime + adsr.attack + adsr.decay
    )

    const releaseStart = Math.max(
      audioTime + adsr.attack + adsr.decay,
      audioTime + durationSeconds - adsr.release
    )
    gain.gain.setValueAtTime(sustainGain, releaseStart)
    gain.gain.linearRampToValueAtTime(0, audioTime + durationSeconds)

    // Schedule start/stop
    const stopTime = audioTime + durationSeconds + 0.1
    oscillator.start(audioTime)
    oscillator.stop(stopTime)

    // Track for cleanup
    this.scheduledNotes.push({
      oscillator,
      gain,
      stopTime,
      sourceId: event.sourceId
    })

    // Auto-cleanup when done
    oscillator.onended = () => {
      this.scheduledNotes = this.scheduledNotes.filter(
        (n) => n.oscillator !== oscillator
      )
      gain.disconnect()
    }
  }

  /**
   * Convert MIDI note number to frequency.
   */
  private midiToFrequency(midiNote: number): number {
    if (midiNote < 0 || midiNote > 127) return 0
    return 440 * Math.pow(2, (midiNote - 69) / 12)
  }

  /**
   * Cleanup scheduled notes that have finished.
   */
  private cleanupScheduledNotes(): void {
    const now = this.audioContext.currentTime
    this.scheduledNotes = this.scheduledNotes.filter((note) => {
      if (note.stopTime < now) {
        try {
          note.gain.disconnect()
        } catch {
          // Already disconnected
        }
        return false
      }
      return true
    })
  }

  /**
   * Start playback.
   */
  play(): void {
    if (!this.isInitialized) {
      throw new Error('SiliconBackend not initialized')
    }

    // Resume audio context if needed
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    this.siliconNode.play()
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (!this.isInitialized) {
      throw new Error('SiliconBackend not initialized')
    }

    this.siliconNode.pause()
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    if (!this.isInitialized) {
      throw new Error('SiliconBackend not initialized')
    }

    this.siliconNode.stop()
    this.cancelAllNotes()
  }

  /**
   * Seek to a specific tick position.
   */
  seek(tick: number): void {
    if (!this.isInitialized) {
      throw new Error('SiliconBackend not initialized')
    }

    // Cancel notes ahead of seek position
    this.cancelAllNotes()
    this.siliconNode.seek(tick)
  }

  /**
   * Cancel all scheduled notes.
   */
  private cancelAllNotes(): void {
    const now = this.audioContext.currentTime

    for (const note of this.scheduledNotes) {
      try {
        // Rapid fadeout to avoid clicks
        note.gain.gain.cancelScheduledValues(now)
        note.gain.gain.setValueAtTime(note.gain.gain.value, now)
        note.gain.gain.linearRampToValueAtTime(0, now + 0.01)
        note.oscillator.stop(now + 0.02)
      } catch {
        // Node may have already stopped
      }
    }

    this.scheduledNotes = []
  }

  /**
   * Set master volume.
   */
  setMasterVolume(level: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, level))
  }

  /**
   * Get current master volume.
   */
  getMasterVolume(): number {
    return this.masterGain.gain.value
  }

  /**
   * Set playhead update handler.
   */
  setPlayheadHandler(handler: PlayheadHandler | null): void {
    this.onPlayhead = handler
  }

  /**
   * Check if currently playing.
   */
  isPlaying(): boolean {
    return this.siliconNode.getIsPlaying()
  }

  /**
   * Check if initialized.
   */
  getIsInitialized(): boolean {
    return this.isInitialized
  }

  /**
   * Get the AudioContext.
   */
  getAudioContext(): AudioContext {
    return this.audioContext
  }

  /**
   * Get the SiliconNode.
   */
  getSiliconNode(): SiliconNode {
    return this.siliconNode
  }

  /**
   * Get current playhead tick from SAB.
   */
  getPlayheadTick(): number {
    if (!this.sab) return 0
    return Atomics.load(this.sab, HDR_PLAYHEAD_TICK)
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.cancelAllNotes()
    this.siliconNode.dispose()
    this.masterGain.disconnect()
    this.masterCompressor.disconnect()
    this.isInitialized = false
    this.buffer = null
    this.sab = null
  }
}

/**
 * Create a SiliconBackend with default options.
 */
export function createSiliconBackend(
  options?: SiliconBackendOptions
): SiliconBackend {
  return new SiliconBackend(options)
}
