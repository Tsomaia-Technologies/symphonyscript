/**
 * Singleton AudioContext with user gesture handling.
 *
 * Modern browsers require a user interaction (click, tap) before
 * AudioContext can produce sound. This module handles that.
 */

let audioContext: AudioContext | null = null

/**
 * Get or create the AudioContext singleton.
 * Call this from a user gesture handler (click, keypress).
 */
export function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Resume AudioContext if suspended.
 * Must be called from user gesture.
 */
export async function ensureAudioContextRunning(): Promise<AudioContext> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  return ctx
}

/**
 * Get current audio time (for scheduling).
 */
export function getCurrentTime(): number {
  return audioContext?.currentTime ?? 0
}
