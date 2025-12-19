// =============================================================================
// SymphonyScript - Silicon AudioWorkletNode Wrapper (RFC-043 Phase 3)
// =============================================================================
// Main thread wrapper for the Silicon AudioWorklet processor.

import { getAudioContext, ensureAudioContextRunning } from './context'

// SAB Header offset (must match @symphonyscript/core/linker/constants.ts)
const HDR_PLAYHEAD_TICK = 7

// =============================================================================
// Types
// =============================================================================

/**
 * MIDI note event from the processor.
 */
export interface SiliconNoteEvent {
  type: 'note'
  tick: number
  pitch: number
  velocity: number
  duration: number
  channel: number
  sourceId: number
}

/**
 * MIDI CC event from the processor.
 */
export interface SiliconCCEvent {
  type: 'cc'
  tick: number
  controller: number
  value: number
  channel: number
}

/**
 * MIDI pitch bend event from the processor.
 */
export interface SiliconBendEvent {
  type: 'bend'
  tick: number
  value: number
  channel: number
}

/**
 * Any MIDI event from the processor.
 */
export type SiliconMidiEvent = SiliconNoteEvent | SiliconCCEvent | SiliconBendEvent

/**
 * Event handler for MIDI events.
 */
export type MidiEventHandler = (events: SiliconMidiEvent[]) => void

/**
 * Event handler for playhead updates.
 */
export type PlayheadHandler = (tick: number) => void

/**
 * Options for creating a SiliconNode.
 */
export interface SiliconNodeOptions {
  /** AudioContext to use (uses shared context if not provided) */
  audioContext?: AudioContext
  /** Path to the processor module (defaults to './silicon-processor.js') */
  processorPath?: string
  /** Handler for MIDI events */
  onMidiEvent?: MidiEventHandler
  /** Handler for playhead updates */
  onPlayhead?: PlayheadHandler
}

// =============================================================================
// SiliconNode
// =============================================================================

/**
 * Main thread wrapper for the Silicon AudioWorklet processor.
 *
 * This class:
 * - Loads and initializes the AudioWorklet processor
 * - Passes the SharedArrayBuffer to the processor
 * - Handles MIDI events from the processor
 * - Provides play/pause/stop/seek controls
 */
export class SiliconNode {
  private audioContext: AudioContext
  private workletNode: AudioWorkletNode | null = null
  private processorPath: string
  private isInitialized: boolean = false
  private isPlaying: boolean = false

  // Event handlers
  private onMidiEvent: MidiEventHandler | null = null
  private onPlayhead: PlayheadHandler | null = null

  // SAB reference
  private buffer: SharedArrayBuffer | null = null

  constructor(options: SiliconNodeOptions = {}) {
    this.audioContext = options.audioContext ?? getAudioContext()
    this.processorPath = options.processorPath ?? './silicon-processor.js'
    this.onMidiEvent = options.onMidiEvent ?? null
    this.onPlayhead = options.onPlayhead ?? null
  }

  /**
   * Initialize the AudioWorklet processor.
   *
   * @param buffer - SharedArrayBuffer from the Silicon Linker
   * @returns Promise that resolves when initialization is complete
   */
  async init(buffer: SharedArrayBuffer): Promise<void> {
    if (this.isInitialized) {
      throw new Error('SiliconNode already initialized')
    }

    this.buffer = buffer

    // Ensure audio context is running
    await ensureAudioContextRunning()

    // Load the processor module
    await this.audioContext.audioWorklet.addModule(this.processorPath)

    // Create the worklet node
    this.workletNode = new AudioWorkletNode(this.audioContext, 'silicon-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })

    // Connect to destination (even though we don't output audio directly)
    // This keeps the processor running
    this.workletNode.connect(this.audioContext.destination)

    // Handle messages from the processor
    this.workletNode.port.onmessage = (event) => {
      this.handleProcessorMessage(event.data)
    }

    // Send the SAB to the processor
    this.workletNode.port.postMessage({
      type: 'init',
      buffer: this.buffer
    })

    this.isInitialized = true
  }

  /**
   * Handle messages from the processor.
   */
  private handleProcessorMessage(data: {
    type: string
    events?: SiliconMidiEvent[]
    tick?: number
  }): void {
    switch (data.type) {
      case 'events':
        if (data.events && this.onMidiEvent) {
          this.onMidiEvent(data.events)
        }
        break

      case 'playhead':
        if (data.tick !== undefined && this.onPlayhead) {
          this.onPlayhead(data.tick)
        }
        break
    }
  }

  /**
   * Start playback.
   */
  play(): void {
    if (!this.isInitialized || !this.workletNode) {
      throw new Error('SiliconNode not initialized')
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    this.workletNode.port.postMessage({ type: 'play' })
    this.isPlaying = true
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (!this.isInitialized || !this.workletNode) {
      throw new Error('SiliconNode not initialized')
    }

    this.workletNode.port.postMessage({ type: 'pause' })
    this.isPlaying = false
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    if (!this.isInitialized || !this.workletNode) {
      throw new Error('SiliconNode not initialized')
    }

    this.workletNode.port.postMessage({ type: 'stop' })
    this.isPlaying = false
  }

  /**
   * Seek to a specific tick position.
   *
   * Note: The actual seek is performed by setting PLAYHEAD_TICK in the SAB.
   * This method just tells the processor to re-sync its position.
   *
   * @param tick - Tick position to seek to
   */
  seek(tick: number): void {
    if (!this.isInitialized || !this.workletNode || !this.buffer) {
      throw new Error('SiliconNode not initialized')
    }

    // Set playhead tick in SAB
    const sab = new Int32Array(this.buffer)
    Atomics.store(sab, HDR_PLAYHEAD_TICK, tick)

    // Tell processor to re-sync
    this.workletNode.port.postMessage({ type: 'seek' })
  }

  /**
   * Set the MIDI event handler.
   */
  setMidiEventHandler(handler: MidiEventHandler | null): void {
    this.onMidiEvent = handler
  }

  /**
   * Set the playhead update handler.
   */
  setPlayheadHandler(handler: PlayheadHandler | null): void {
    this.onPlayhead = handler
  }

  /**
   * Check if currently playing.
   */
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * Check if initialized.
   */
  getIsInitialized(): boolean {
    return this.isInitialized
  }

  /**
   * Get the underlying AudioWorkletNode.
   */
  getWorkletNode(): AudioWorkletNode | null {
    return this.workletNode
  }

  /**
   * Get the AudioContext.
   */
  getAudioContext(): AudioContext {
    return this.audioContext
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' })
      this.workletNode.disconnect()
      this.workletNode = null
    }

    this.isInitialized = false
    this.isPlaying = false
    this.buffer = null
    this.onMidiEvent = null
    this.onPlayhead = null
  }
}

/**
 * Create a SiliconNode with default options.
 */
export function createSiliconNode(options?: SiliconNodeOptions): SiliconNode {
  return new SiliconNode(options)
}
