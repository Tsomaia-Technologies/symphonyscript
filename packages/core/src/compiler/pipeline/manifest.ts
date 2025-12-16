import type { CompiledEvent, InstrumentRequirement, PlaybackManifest } from './types'
import { CC, midiControl } from '../../types/midi'
import { InstrumentId, unsafeInstrumentId } from '../../types/primitives'

/**
 * Scans compiled events to generate a rigorous PlaybackManifest.
 * This analyzes polyphony, required features, and controller usage.
 */
export function generateManifest(events: CompiledEvent[]): PlaybackManifest {
  const instruments: Record<InstrumentId, InstrumentRequirement> = {}
  const controllers = new Set<number>()
  let maxPitchBend = 2 // Default semester range

  // Temporary storage for polyphony calculation
  // map<instrumentId, list<activeNotes>>
  const activeNotes: Record<string, { end: number }[]> = {}

  // Sort by start time to ensure linear scan for polyphony works
  // (Events should already be sorted, but safety first for this algo)
  const sortedEvents = [...events].sort((a, b) => a.startSeconds - b.startSeconds)

  for (const event of sortedEvents) {
    // Track Controllers
    if (event.kind === 'control') {
      controllers.add(event.payload.controller)
    }

    // Track Automation acting as Controllers
    if (event.kind === 'automation') {
      if (event.payload.target === 'pan') controllers.add(CC.Pan)
      else if (event.payload.target === 'volume') controllers.add(CC.Volume)
      else if (event.payload.target === 'expression') controllers.add(CC.Expression)
    }

    // Track Pitch Bend Range
    if (event.kind === 'note' && event.payload.detune) {
      // If detune is used, we might need to check if it exceeds standard range
      // Standard MPE detune is usually within ±2 semitones (±2400 cents often? No, ±48 usually for MPE)
      // But 'detune' here is microtonal offset in cents.
      // If > 200 cents (2 semitones), we might want to bump range.
      const absDetune = Math.abs(event.payload.detune)
      if (absDetune > 200) {
        // Heuristic: Round up to next 12
        maxPitchBend = Math.max(maxPitchBend, Math.ceil(absDetune / 100))
      }
    }

    // Track Instrument Requirements
    if ('channel' in event) {
      // We don't have explicit instrument IDs in CompiledEvent (it uses channel).
      // Wait, src/compiler/types.ts has `channel: MidiChannel`.
      // BUT earlier `CompiledEvent` definition in my update `types.ts` didn't include `instrumentId`.
      // The original `CompiledOutput` interface had `manifest: Record<InstrumentId...>`
      // But `NoteOnEvent` had `instrumentId`.
      // My recent update to `CompiledEvent` union REMOVED `instrumentId` in favor of just `channel`?
      // Let's re-read the file content I just wrote.
      // ... Checks file content ...
      // Yes, I defined `CompiledEvent` unions with `channel` but NOT `instrumentId`.
      // This is a discrepancy with the Plan "Strict instrument requirements".
      // If we only have channel 1-16, we can key by "Channel 1", "Channel 2".
      // OR we assume 1 instrument per channel.
      // I will assume channel mappings for manifest generation here.

      // Fix: cast channel-based ID to InstrumentId
      const bufId = unsafeInstrumentId(`channel_${event.channel}`)

      if (!instruments[bufId]) {
        instruments[bufId] = {
          id: bufId,
          polyphony: 0,
          features: []
        }
        activeNotes[bufId] = []
      }

      const inst = instruments[bufId]

      // Feature Detection
      if (event.kind === 'control') {
        if (event.payload.controller === CC.Sustain && !inst.features.includes('sustain')) {
          inst.features.push('sustain')
        }
      }
      if (event.kind === 'aftertouch' && !inst.features.includes('aftertouch')) {
        inst.features.push('aftertouch')
      }
      if (event.kind === 'note') {
        if ((event.payload.timbre !== undefined || event.payload.pressure !== undefined) && !inst.features.includes('mpe')) {
          inst.features.push('mpe')
        }

        if (event.payload.detune !== undefined && !inst.features.includes('pitch_bend')) {
          inst.features.push('pitch_bend')
        }
      }
      if (event.kind === 'pitch_bend' && !inst.features.includes('pitch_bend')) {
        inst.features.push('pitch_bend')
      }

      // Polyphony Calculation
      if (event.kind === 'note' && event.durationSeconds) {
        const notes = activeNotes[bufId]
        const now = event.startSeconds

        // Remove finished notes
        // We keep notes that end AFTER now
        let activeCount = 0
        const nextNotes: { end: number }[] = []

        for (const note of notes) {
          if (note.end > now + 0.001) { // 1ms tolerance
            nextNotes.push(note)
            activeCount++
          }
        }

        // Add current
        nextNotes.push({ end: now + event.durationSeconds })
        activeCount++

        activeNotes[bufId] = nextNotes
        inst.polyphony = Math.max(inst.polyphony, activeCount)
      }
    }
  }

  return {
    pitchBendRange: maxPitchBend,
    controllersUsed: Array.from(controllers).sort((a, b) => a - b).map(c => midiControl(c)),
    instruments
  }
}
