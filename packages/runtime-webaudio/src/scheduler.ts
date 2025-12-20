/**
 * Lookahead scheduler for precise event timing.
 *
 * Web Audio's currentTime is highly accurate, but JavaScript's
 * main thread can lag. The lookahead pattern schedules events
 * slightly in the future to compensate.
 */

/** How far ahead to schedule (seconds) */
export const LOOKAHEAD = 0.1

/** How often to run the scheduler (ms) */
export const SCHEDULE_INTERVAL = 25

// @deprecated: Implement LLVM-compliant interface
export interface SchedulerConfig {
  /** Events to schedule */
  events: any[]
  /** Callback to schedule an event */
  onSchedule: (event: any, audioTime: number) => void
  /** Get current audio context time */
  getCurrentTime: () => number
  /** Get playback start time */
  getStartTime: () => number
  /** Get current offset in clip */
  getOffset: () => number
}

export interface Scheduler {
  start: () => void
  stop: () => void
  reset: () => void
}

export function createScheduler(config: SchedulerConfig): Scheduler {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let nextEventIndex = 0

  function scheduleEvents(): void {
    const currentTime = config.getCurrentTime()
    const startTime = config.getStartTime()
    const offset = config.getOffset()

    // Schedule events that fall within the lookahead window
    while (nextEventIndex < config.events.length) {
      const event = config.events[nextEventIndex]
      const eventClipTime = event.startSeconds

      // Skip events significantly before our current offset
      // Allow a small tolerance (e.g. 50ms) for humanized notes that might start slightly before 0
      if (eventClipTime < offset - 0.05) {
        nextEventIndex++
        continue
      }

      // Calculate when this event should play in AudioContext time
      const eventAudioTime = startTime + (eventClipTime - offset)

      // If event is beyond lookahead window, stop
      if (eventAudioTime > currentTime + LOOKAHEAD) {
        break
      }

      // Schedule the event
      config.onSchedule(event, eventAudioTime)
      nextEventIndex++
    }
  }

  return {
    start(): void {
      if (intervalId) return
      intervalId = setInterval(scheduleEvents, SCHEDULE_INTERVAL)
      scheduleEvents() // Run immediately
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },

    reset(): void {
      nextEventIndex = 0
    }
  }
}
