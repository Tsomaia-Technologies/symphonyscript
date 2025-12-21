import type {CompiledEvent} from '../compiler/pipeline/types'

export interface AsciiOptions {
  /** Steps per beat (resolution). Default: 4 (16th notes) */
  stepsPerBeat?: number
  /** Total beats to display. Auto-calculated if omitted */
  totalBeats?: number
  /** Character for empty step */
  emptyChar?: string
  /** Character for sustain (held note) */
  sustainChar?: string
  /** BPM for time calculation */
  bpm?: number
  /** Show beat markers */
  showBeats?: boolean
  /** Max track name length */
  trackNameWidth?: number
}

export interface TrackEvents {
  name: string
  instrumentId: string
  events: CompiledEvent[]
}

/**
 * Render events to ASCII timeline.
 */
export function renderAsciiTimeline(
  tracks: TrackEvents[],
  options: AsciiOptions = {}
): string {
  const {
    stepsPerBeat = 4,
    emptyChar = '-',
    sustainChar = '.',
    bpm = 120,
    showBeats = true,
    trackNameWidth = 8
  } = options

  // Calculate total duration
  let maxSeconds = 0
  for (const track of tracks) {
    for (const event of track.events) {
      if (event.kind !== 'note' && event.kind !== 'control') continue // consider other events? Spec focuses on notes.
      let duration = 0
      if ('durationSeconds' in event && typeof event.durationSeconds === 'number') {
        duration = event.durationSeconds
      }
      const endTime = event.startSeconds + duration
      maxSeconds = Math.max(maxSeconds, endTime)
    }
  }

  const secondsPerBeat = 60 / bpm
  const totalBeats = options.totalBeats ?? Math.ceil(maxSeconds / secondsPerBeat)
  const totalSteps = totalBeats * stepsPerBeat

  const lines: string[] = []

  // Beat markers header
  if (showBeats) {
    let header = ' '.repeat(trackNameWidth + 3)
    for (let beat = 1; beat <= totalBeats; beat++) {
      header += beat.toString().padEnd(stepsPerBeat, ' ')
    }
    lines.push(header)
  }

  // Render each track
  for (const track of tracks) {
    const grid: string[] = Array(totalSteps).fill(emptyChar)

    // Place events on grid
    for (const event of track.events) {
      if (event.kind !== 'note') continue

      const startStep = Math.floor((event.startSeconds / secondsPerBeat) * stepsPerBeat)
      const dur = 'durationSeconds' in event ? (event.durationSeconds ?? 0) : 0
      const durationSteps = Math.max(1, Math.floor((dur / secondsPerBeat) * stepsPerBeat))

      if (startStep >= totalSteps) continue

      // Get display character
      const displayChar = getEventChar(event, track.name)
      grid[startStep] = displayChar

      // Add sustain for longer notes
      for (let i = 1; i < durationSteps && startStep + i < totalSteps; i++) {
        // Only overwrite if empty? Or always overwrite?
        // Spec implies overwrite or careful placement.
        // Simple overwrite is fine for monophonic view or just last-wins.
        // If grid has char, maybe don't overwrite if it's not empty?
        // Let's overwrite for now to show duration clearly.
        if (grid[startStep + i] === emptyChar) {
          grid[startStep + i] = sustainChar
        }
      }
    }

    // Format track line
    const trackName = track.name.substring(0, trackNameWidth).padEnd(trackNameWidth)
    lines.push(`${trackName} | ${grid.join('')}`)
  }

  return lines.join('\n')
}

/**
 * Get display character for an event.
 */
function getEventChar(event: CompiledEvent, trackName?: string): string {
  if (event.kind !== 'note') return '?'

  const pitch = event.payload?.pitch as string
  if (!pitch) return 'x'

  // If track name implies drums, or pitch matches drum name
  const isDrumTrack = trackName && /drum|perc|kit/i.test(trackName)
  const isDrumPitch = /^(Kick|Snare|HiHat|Clap|Tom|Crash|Ride)/i.test(pitch)

  if (isDrumTrack || isDrumPitch) {
    return 'x'
  }

  // For melodic notes, use the note letter
  const match = pitch.match(/^([A-G])([#b]?)(\d)$/)
  if (match) {
    const letter = match[1]
    const accidental = match[2]
    return accidental ? letter.toLowerCase() : letter
  }

  return 'x'
}

/**
 * Render a simple pattern view (for single clips).
 */
export function renderPattern(
  events: CompiledEvent[],
  name: string = 'Pattern',
  options: AsciiOptions = {}
): string {
  return renderAsciiTimeline([{name, instrumentId: '', events}], options)
}
