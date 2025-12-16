/**
 * Playback state management.
 */

export interface TransportState {
  /** AudioContext time when playback started */
  startTime: number
  /** AudioContext time when paused (0 if not paused) */
  pauseTime: number
  /** Current position in clip (seconds) */
  offset: number
  /** Whether playback is active */
  isPlaying: boolean
  /** Total duration of current clip */
  duration: number
}

export function createTransport(): TransportState {
  return {
    startTime: 0,
    pauseTime: 0,
    offset: 0,
    isPlaying: false,
    duration: 0
  }
}

/**
 * Calculate current playback position.
 */
export function getPlaybackPosition(
  transport: TransportState,
  currentTime: number
): number {
  if (!transport.isPlaying) {
    return transport.offset
  }
  return transport.offset + (currentTime - transport.startTime)
}
