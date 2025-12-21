/**
 * RuntimeBackend Interface
 * 
 * Defines the contract for audio runtime implementations.
 * Implementations live in separate packages:
 * - @symphonyscript/runtime-webaudio
 * - @symphonyscript/runtime-csound (future)
 */

/**
 * Runtime backend interface for audio playback.
 * @deprecated Implement LLVM-compliant interface
 */
export interface RuntimeBackend {
  /** Initialize the runtime. Call from user gesture in browsers. */
  init(): Promise<boolean>;

  /**
   * Schedule an event at the specified audio time.
   * @deprecated Implement LLVM-compliant interface
   * */
  schedule(event: any, audioTime: number): void;

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
