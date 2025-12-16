import { getBpmAtPosition, integrateTempo } from '../tempo'
import type { TempoMap, TempoPoint, TimedSequence } from './types'
import { parseDuration } from '../../util/duration'

export function buildTempoMap(
  sequence: TimedSequence,
  initialBpm: number,
  options: {
    tempoPrecision?: 'standard' | 'high' | 'sample',
    sampleRate?: number
  } = {}
): TempoMap {
  const points: TempoPoint[] = [{ beatPosition: 0, bpm: initialBpm }]

  // NEW: Tempo Scope Stack for Isolation
  interface TempoScopeFrame {
    entryBpm: number
    entryBeat: number
  }
  const scopeStack: TempoScopeFrame[] = []
  let currentBpm = initialBpm

  // Extract tempo ops from sequence
  // Note: They are already timed efficiently in 'timing' phase
  // We just need to collect them.
  for (const op of sequence.operations) {
    // Handle scope markers for isolation
    if (op.kind === 'scope_start' && op.isolate?.tempo) {
      scopeStack.push({
        entryBpm: currentBpm,
        entryBeat: op.beatStart
      })
    }

    if (op.kind === 'scope_end' && op.isolate?.tempo) {
      const frame = scopeStack.pop()
      if (frame) {
        // Restore tempo
        // Insert a point at the current beat to jump back to entryBpm
        points.push({
          beatPosition: op.beatStart,
          bpm: frame.entryBpm
        })
        currentBpm = frame.entryBpm
      }
    }

    if (op.kind === 'op' && op.original.kind === 'tempo') {
      const t = op.original
      let transitionBeats = 0
      let curve = undefined
      let envelope = undefined
      let targetBpm = undefined

      if (t.transition) {
        if (typeof t.transition === 'object' && 'duration' in t.transition) {
          transitionBeats = parseDuration(t.transition.duration)
          curve = t.transition.curve
          envelope = t.transition.envelope
        } else {
          transitionBeats = parseDuration(t.transition)
        }
        targetBpm = t.bpm
      }

      // Handle complex envelope
      if (envelope) {
        const keyframes = (envelope as import('../../types/primitives').TempoEnvelope).keyframes
        const startBeat = op.beatStart

        // Sort keyframes by beat just in case
        keyframes.sort((a, b) => a.beat - b.beat)

        // Envelope logic update: update currentBpm at the end of envelope
        let lastBpm = currentBpm;

        for (let i = 0; i < keyframes.length; i++) {
          const kf = keyframes[i]
          const absBeat = startBeat + kf.beat

          if (i === 0) {
            // First keyframe: effectively an instant jump/set to this BPM at this time
            // We need to resolve the previous BPM to know if we are jumping
            // But actually, we just push a point.
            // If there is a next keyframe, this point will have transition properties.
            const next = keyframes[i + 1]
            if (next) {
              points.push({
                beatPosition: absBeat,
                bpm: kf.bpm,
                targetBpm: next.bpm,
                transitionBeats: next.beat - kf.beat,
                curve: next.curve // Curve belongs to the destination segment
              })
            } else {
              // Single point envelope? Just a jump.
              points.push({
                beatPosition: absBeat,
                bpm: kf.bpm,
                curve: 'linear'
              })
            }
          } else {
            // Subsequent keyframes
            // If this is not the last one, it starts a new transition
            const next = keyframes[i + 1]
            if (next) {
              points.push({
                beatPosition: absBeat,
                bpm: kf.bpm,
                targetBpm: next.bpm,
                transitionBeats: next.beat - kf.beat,
                curve: next.curve
              })
            } else {
              // Last keyframe. No further transition defined here.
              // It just holds the target BPM.
              // We don't push a new point for the *end* of a transition usually?
              // Wait, TempoMap must have points at every inflection.
              // Yes, we need a point at the end of the transition to establish the new steady state.
              points.push({
                beatPosition: absBeat,
                bpm: kf.bpm,
                curve: 'linear'
              })
            }
          }
          lastBpm = kf.bpm // Approximate tracking
        }
        currentBpm = lastBpm // We lose some precision here w.r.t ramps ending, but it's a start
        continue
      }

      // Standard transition (single ramp or jump)
      const prevBpm = getCurrentBpm(points, op.beatStart)

      // Update current BPM tracking
      currentBpm = t.bpm;

      points.push({
        beatPosition: op.beatStart,
        bpm: transitionBeats > 0 ? prevBpm : t.bpm, // If ramping, start at prev. Else jump.
        targetBpm: transitionBeats > 0 ? t.bpm : undefined,
        transitionBeats: transitionBeats > 0 ? transitionBeats : undefined,
        curve: (curve as import('../../types/primitives').TempoCurve) ?? 'linear'
      })
    }
  }

  // Sort by position (stable sort)
  points.sort((a, b) => a.beatPosition - b.beatPosition)

  // Pre-compute cumulative seconds
  const cumSeconds: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const beats = curr.beatPosition - prev.beatPosition

    // Safety check for negative beats (out of order?)
    if (beats < 0) {
      // Should not happen if sorted
    }

    const segmentSeconds = computeSeconds(prev, beats, options)
    cumSeconds.push(cumSeconds[i - 1] + segmentSeconds)
  }

  return {
    points,

    getBpmAt(beat: number): number {
      const idx = findLastIndex(points, beat) // Use last index <= beat
      const p = points[idx]

      if (p.targetBpm && p.transitionBeats) {
        const t = (beat - p.beatPosition) / p.transitionBeats
        if (t < 1 && t >= 0) {
          return getBpmAtPosition(p.bpm, p.targetBpm, t, p.curve ?? 'linear')
        }
        return p.targetBpm
      }
      return p.bpm
    },

    beatToSeconds(beat: number): number {
      const idx = findLastIndex(points, beat)
      const p = points[idx]
      const beatsFrom = beat - p.beatPosition

      return cumSeconds[idx] + computeSeconds(p, beatsFrom, options)
    },

    durationToSeconds(start: number, dur: number): number {
      return this.beatToSeconds(start + dur) - this.beatToSeconds(start)
    }
  }
}

function findLastIndex(points: TempoPoint[], beat: number): number {
  let low = 0, high = points.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (points[mid].beatPosition <= beat) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return high >= 0 ? high : 0
}

function getCurrentBpm(points: TempoPoint[], beat: number): number {
  const idx = findLastIndex(points, beat)
  const p = points[idx]
  if (p.targetBpm && p.transitionBeats) {
    const t = (beat - p.beatPosition) / p.transitionBeats
    if (t >= 1) return p.targetBpm
    return getBpmAtPosition(p.bpm, p.targetBpm, t, p.curve ?? 'linear')
  }
  return p.bpm
}

function computeSeconds(
  point: TempoPoint,
  beats: number,
  options: { tempoPrecision?: 'standard' | 'high' | 'sample', sampleRate?: number } = {}
): number {
  if (!point.targetBpm || !point.transitionBeats) {
    return (beats / point.bpm) * 60
  }

  // Transition logic
  const tranBeats = Math.min(point.transitionBeats, beats)
  const steadyBeats = beats - tranBeats

  let s = 0
  if (tranBeats > 0) {
    // Fix: Calculate effective target scale for this partial duration
    // integratedTempo assumes the target is reached at the end of the specified duration.
    // So we calculate what the BPM is at 'tranBeats', and integrate to THAT.
    const t = tranBeats / point.transitionBeats
    const effectiveTargetBpm = getBpmAtPosition(point.bpm, point.targetBpm, t, point.curve ?? 'linear')

    s += integrateTempo(
      point.bpm,
      effectiveTargetBpm,
      tranBeats,
      point.curve ?? 'linear',
      options.tempoPrecision,
      options.sampleRate
    )
  }

  if (steadyBeats > 0) {
    s += (steadyBeats / point.targetBpm) * 60
  }

  return s
}
