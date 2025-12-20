/**
 * RuntimeBackend Interface
 * 
 * Defines the contract for audio runtime implementations.
 * Implementations live in separate packages:
 * - @symphonyscript/runtime-webaudio
 * - @symphonyscript/runtime-csound (future)
 */

import type { CompiledEvent } from '../../../../../symphonyscript-legacy/src/legacy/compiler/pipeline/types';

/**
 * Runtime backend interface for audio playback.
 */
export interface RuntimeBackend {
  /** Initialize the runtime. Call from user gesture in browsers. */
  init(): Promise<boolean>;

  /** Schedule an event at the specified audio time. */
  schedule(event: CompiledEvent, audioTime: number): void;

  /** Cancel events after the specified beat. */
  cancelAfter(beat: number, trackId?: string): void;

  /** Cancel all scheduled events. */
  cancelAll(): void;

  /** Get current audio time in seconds. */
  getCurrentTime(): number;

  /** Set playback tempo. */
  setTempo(bpm: number): void;

  /** Dispose resources and stop playback. */
  dispose(): void;
}
