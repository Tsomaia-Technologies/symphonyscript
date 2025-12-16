/**
 * Main playback engine facade.
 */

import type {CompiledClip, CompiledEvent} from '@symphonyscript/core'
import type {CompiledOutput} from '@symphonyscript/core'
import {ensureAudioContextRunning} from './context'
import {createTransport, type TransportState} from './transport'
import {createScheduler, type Scheduler} from './scheduler'
import {scheduleEvent, type SynthConfig} from './synth'

export interface PlaybackEngine {
  /** Initialize audio (call from user gesture) */
  init: () => Promise<void>
  /** Play a compiled clip or session output */
  play: (input: CompiledClip | CompiledOutput) => void
  /** Pause playback */
  pause: () => void
  /** Resume playback */
  resume: () => void
  /** Stop playback and reset */
  stop: () => void
  /** Get current state */
  getState: () => TransportState
  /** Check if audio is ready */
  isReady: () => boolean
}

export function createPlaybackEngine(): PlaybackEngine {
  let audioContext: AudioContext | null = null
  let transport = createTransport()
  let scheduler: Scheduler | null = null
  let currentClip: CompiledClip | null = null
  let synthConfig: SynthConfig | null = null

  return {
    async init(): Promise<void> {
      audioContext = await ensureAudioContextRunning()

      // Add Master Compressor to prevent clipping
      const masterCompressor = audioContext.createDynamicsCompressor()
      masterCompressor.threshold.value = -10
      masterCompressor.knee.value = 40
      masterCompressor.ratio.value = 12
      masterCompressor.attack.value = 0
      masterCompressor.release.value = 0.25
      masterCompressor.connect(audioContext.destination)

      synthConfig = {
        audioContext,
        destination: masterCompressor
      }
    },

    play(input: CompiledClip | CompiledOutput): void {
      if (!audioContext || !synthConfig) {
        throw new Error('Engine not initialized. Call init() first from a user gesture.')
      }

      // Normalize input to CompiledClip structure
      let clip: CompiledClip

      if ('timeline' in input) {
        // Convert CompiledOutput (AudioEvent[]) to CompiledClip (CompiledEvent[])
        // Note: We only map basic note on events for now for playback
        const events: CompiledEvent[] = input.timeline.map(e => {
          if (e.kind === 'note_on') {
            return {
              kind: 'note',
              startSeconds: e.time,
              durationSeconds: e.duration,
              channel: 1, // Default channel
              payload: {
                pitch: e.note,
                velocity: e.velocity,
                articulation: e.articulation
              }
            } as CompiledEvent
          } else if (e.kind === 'control') {
            return {
              kind: 'control',
              startSeconds: e.time,
              channel: 1,
              payload: {
                controller: e.controller,
                value: e.value
              }
            } as CompiledEvent
          }
          // TODO: Map other events
          return null
        }).filter((e): e is CompiledEvent => e !== null)

        clip = {
          events,
          durationSeconds: input.meta.durationSeconds,
          durationBeats: 0, // Not needed for playback
          tempoMap: null as any, // Not needed for playback (already timed)
          metadata: {expandedOpCount: events.length, maxDepth: 0, warnings: []}
        }
      } else {
        clip = input
      }

      // Stop any current playback
      this.stop()

      currentClip = clip
      transport.duration = clip.durationSeconds
      transport.startTime = audioContext.currentTime
      transport.offset = 0
      transport.isPlaying = true

      // Create scheduler
      scheduler = createScheduler({
        events: clip.events,
        onSchedule: (event, time) => scheduleEvent(synthConfig!, event, time),
        getCurrentTime: () => audioContext!.currentTime,
        getStartTime: () => transport.startTime,
        getOffset: () => transport.offset
      })

      scheduler.start()
    },

    pause(): void {
      if (!transport.isPlaying || !audioContext) return

      transport.pauseTime = audioContext.currentTime
      transport.offset += transport.pauseTime - transport.startTime
      transport.isPlaying = false

      scheduler?.stop()
    },

    resume(): void {
      if (transport.isPlaying || !audioContext || !currentClip) return

      transport.startTime = audioContext.currentTime
      transport.pauseTime = 0
      transport.isPlaying = true

      scheduler?.start()
    },

    stop(): void {
      scheduler?.stop()
      scheduler = null
      transport = createTransport()
      currentClip = null
    },

    getState(): TransportState {
      return {...transport}
    },

    isReady(): boolean {
      return audioContext !== null && audioContext.state === 'running'
    }
  }
}
