import type {
  CompiledClip,
  CompiledEvent,
  ExpandedOpWrapper,
  PipelineMarker,
  TempoMap,
  TimedPipelineOp,
  TimedSequence
} from './types'
import { getArticulationMultiplier, transposeNote } from '../utils'
import type { EasingCurve, NoteName } from '../../types/primitives'
import { quantizeToSample } from '../tempo'

import { createRandom, SeededRandom } from '../../util/random'
import { parseDuration } from '../../util/duration'
import { midiChannel, type MidiChannel, midiControl, midiValue } from '../../types/midi'

interface DynamicsRegion {
  type: string
  startSeconds: number
  endSeconds: number
  fromVelocity?: number
  toVelocity?: number
  curve?: EasingCurve
  points?: any[]
}

interface EmitState {
  transposition: number
  velocity: number
  dynamicsRegion?: DynamicsRegion
}

interface EmitCtx {
  state: EmitState
  stateStack: EmitState[]
  tempoMap: TempoMap
  channel: MidiChannel
  sampleRate?: number
  random: SeededRandom
}

export function emitEvents(
  sequence: TimedSequence,
  tempoMap: TempoMap,
  options: {
    defaultVelocity?: number
    channel?: number
    sampleRate?: number
    seed?: number
  } = {}
): CompiledClip {

  const initialVelocity = options.defaultVelocity ?? 1
  const channel = midiChannel(options.channel ?? 1)

  const ctx: EmitCtx = {
    state: {
      transposition: 0,
      velocity: initialVelocity,
      dynamicsRegion: undefined
    },
    stateStack: [],
    tempoMap,
    channel,
    sampleRate: options.sampleRate,
    random: createRandom(options.seed)
  }

  const events: CompiledEvent[] = []
  const warnings: string[] = []

  let opIndex = 0
  for (const op of sequence.operations) {
    opIndex++
    if ('kind' in op && isMarker(op)) {
      // Handle BlockMarker specially - needs full timed op for beatStart
      if (op.kind === 'block_marker') {
        const block = op.block
        const blockStartSeconds = ctx.tempoMap.beatToSeconds(op.beatStart)

        for (const event of block.events) {
          const offsetEvent = offsetEventTime(event, blockStartSeconds)
          events.push(offsetEvent)
        }

        // Update state from block's end state
        ctx.state.transposition += block.endState.transposition
        continue
      }

      handleMarker(op, ctx)
      continue
    }

    if (op.kind === 'op') {
      handleOp(op, ctx, events, warnings, opIndex)
    }
  }

  // Sort events by time
  events.sort((a, b) => a.startSeconds - b.startSeconds)

  return {
    events,
    durationSeconds: tempoMap.beatToSeconds(sequence.totalBeats),
    durationBeats: sequence.totalBeats,
    tempoMap,
    metadata: {
      expandedOpCount: sequence.operations.length,
      maxDepth: 0, // Could track max depth if passed from sequence
      warnings
    }
  }
}

function handleMarker(marker: PipelineMarker, ctx: EmitCtx) {
  if (marker.kind === 'stack_start' || marker.kind === 'branch_start') {
    // Push State
    ctx.stateStack.push({ ...ctx.state })
    // Clone for new current state
    ctx.state = { ...ctx.state }
  } else if (marker.kind === 'stack_end' || marker.kind === 'branch_end') {
    // Pop State
    const popped = ctx.stateStack.pop()
    if (popped) {
      ctx.state = popped
    }
  } else if (marker.kind === 'scope_start') {
    // Determine isolation
    // Legacy Transpose (isolate undefined) -> Always isolate state (to restore transposition)
    // Explicit Isolation -> check dynamics flag
    const shouldIsolateState = !marker.isolate || marker.isolate.dynamics

    if (shouldIsolateState || marker.delta?.transposition) {
      ctx.stateStack.push({ ...ctx.state })
      ctx.state = { ...ctx.state }
    }

    if (marker.delta.transposition) {
      ctx.state.transposition += marker.delta.transposition
    }
  } else if (marker.kind === 'scope_end') {
    // Restore state if we pushed it
    // Heuristic: If legacy (isolate undefined) or explicit dynamics isolate
    const shouldIsolateState = !marker.isolate || marker.isolate.dynamics

    if (shouldIsolateState) {
      const popped = ctx.stateStack.pop()
      if (popped) {
        ctx.state = popped
      }
    }
  }
  // Note: block_marker is handled in main loop with access to beatStart
}

function offsetEventTime(event: CompiledEvent, secondsOffset: number): CompiledEvent {
  return {
    ...event,
    startSeconds: event.startSeconds + secondsOffset
  }
}

function handleOp(
  op: TimedPipelineOp & ExpandedOpWrapper,
  ctx: EmitCtx,
  events: CompiledEvent[],
  warnings: string[],
  opIndex: number
) {
  const original = op.original
  const tm = ctx.tempoMap
  const state = ctx.state
  const channel = ctx.channel

  switch (original.kind) {
    case 'note': {
      // MPE channel assignment based on expressionId
      const noteChannel = original.expressionId !== undefined
        ? midiChannel((original.expressionId % 15) + 1)
        : channel

      let start = tm.beatToSeconds(op.beatStart)
      const dur = tm.durationToSeconds(op.beatStart, op.beatDuration)

      let timingOffsetSeconds = 0
      let velocityMult = 1
      let durationMult = 1
      let velocityHumanizeOffset = 0
      let quantizedBeatDuration = op.beatDuration

      // === QUANTIZE (Correction step) ===
      // Pipeline order: Quantize → Groove → Humanize
      if (original.quantize) {
        const gridBeats = parseDuration(original.quantize.grid)
        const strength = original.quantize.strength ?? 1.0
        
        // Calculate nearest grid point
        const nearestGrid = Math.round(op.beatStart / gridBeats) * gridBeats
        
        // Apply strength: lerp from original to grid
        const quantizedBeat = op.beatStart + (nearestGrid - op.beatStart) * strength
        
        // Update start time (groove/humanize will layer on top)
        start = tm.beatToSeconds(quantizedBeat)
        
        // Duration quantization if enabled
        if (original.quantize.duration) {
          const nearestDurGrid = Math.max(gridBeats, Math.round(op.beatDuration / gridBeats) * gridBeats)
          quantizedBeatDuration = op.beatDuration + (nearestDurGrid - op.beatDuration) * strength
        }
      }

      // === GROOVE (Style step) ===
      if (op.groove) {
        const stepsPerBeat = op.groove.stepsPerBeat
        const stepDuration = 1 / stepsPerBeat
        const rawIndex = op.beatStart * stepsPerBeat
        const stepIndex = Math.floor(rawIndex + 0.001) % op.groove.steps.length
        const step = op.groove.steps[stepIndex]

        if (step) {
          if (step.timing) {
            const stepDurationSeconds = tm.durationToSeconds(op.beatStart, stepDuration)
            timingOffsetSeconds += step.timing * stepDurationSeconds
          }
          if (step.velocity) velocityMult *= step.velocity
          if (step.duration) durationMult *= step.duration
        }
      } else if (op.swing) {
        const beatFraction = op.beatStart % 1
        if (Math.abs(beatFraction - 0.5) < 0.01) {
          const maxSwingDelay = 0.25 // Beats
          const swingDelayBeats = op.swing * maxSwingDelay
          timingOffsetSeconds += tm.durationToSeconds(op.beatStart, swingDelayBeats)
        }
      }

      // Apply humanization if set (and not explicitly null)
      if (original.humanize) {
        const rng = original.humanize.seed !== undefined
          ? new SeededRandom(original.humanize.seed ^ opIndex)
          : ctx.random

        if (original.humanize.timing) {
          const maxOffset = original.humanize.timing / 1000
          timingOffsetSeconds += (rng.next() - 0.5) * 2 * maxOffset
        }
        if (original.humanize.velocity) {
          const offset = (rng.next() - 0.5) * 2 * original.humanize.velocity
          velocityHumanizeOffset = offset
        }
      }

      start += timingOffsetSeconds

      const articulationMult = getArticulationMultiplier(original.articulation)
      // Use quantizedBeatDuration if duration quantization was applied
      const finalDur = quantizedBeatDuration !== op.beatDuration
        ? tm.durationToSeconds(op.beatStart, quantizedBeatDuration)
        : dur
      let soundDur = finalDur * articulationMult * durationMult

      const finalNote = transposeNote(original.note, state.transposition) as NoteName

      let finalVelocity = original.velocity * velocityMult

      if (state.dynamicsRegion) {
        const reg = state.dynamicsRegion
        if (start >= reg.startSeconds && start < reg.endSeconds) {
          const totalDur = reg.endSeconds - reg.startSeconds
          const progress = (start - reg.startSeconds) / totalDur
          const t = applyEasing(progress, reg.curve)

          const from = reg.fromVelocity ?? 0.5
          const to = reg.toVelocity ?? 0.5
          finalVelocity = from + (to - from) * t
        }
      }

      if (original.articulation === 'accent') {
        finalVelocity = Math.min(1, finalVelocity * 1.2)
      }

      finalVelocity += velocityHumanizeOffset
      finalVelocity = Math.max(0, Math.min(1, finalVelocity))

      if (ctx.sampleRate) {
        start = quantizeToSample(start, ctx.sampleRate)
        soundDur = quantizeToSample(soundDur, ctx.sampleRate)
      }

      // NEW: Emit MPE-related control messages if expression is set
      // Emit BEFORE note to ensure synth parameter is set
      if (original.timbre !== undefined) {
        events.push({
          kind: 'control',
          startSeconds: start,
          channel: noteChannel,
          payload: {
            controller: midiControl(74),  // CC74 = Brightness/Timbre
            value: midiValue(Math.round(original.timbre * 127))
          },
          source: op
        })
      }

      if (original.pressure !== undefined) {
        events.push({
          kind: 'aftertouch',
          startSeconds: start,
          channel: noteChannel,
          payload: {
            type: 'channel',
            value: midiValue(Math.round(original.pressure * 127))
          },
          source: op
        })
      }

      events.push({
        kind: 'note',
        startSeconds: start,
        durationSeconds: soundDur,
        channel: noteChannel,
        payload: {
          pitch: finalNote,
          velocity: midiValue(Math.round(finalVelocity * 127)),
          articulation: original.articulation,
          detune: original.detune,
          timbre: original.timbre !== undefined
            ? midiValue(Math.round(original.timbre * 127))
            : undefined,
          pressure: original.pressure !== undefined
            ? midiValue(Math.round(original.pressure * 127))
            : undefined,
          tie: original.tie
        },
        source: op
      })

      if (original.glide) {
        events.push({
          kind: 'pitch_bend',
          startSeconds: start,
          channel: noteChannel,
          payload: { value: midiValue(64 - 32) }, // Approx -0.5 in 0-127 range? Pitch bend is 14-bit in MIDI usually, but our type says MidiValue (7-bit) or we assume standard MIDI pitch bend message structure?
          // Re-reading types: PitchBendEvent payload.value is MidiValue (0-127). Center 64.
          source: op
        })
        events.push({
          kind: 'pitch_bend',
          startSeconds: start + tm.durationToSeconds(op.beatStart, original.glide.time as any),
          channel: noteChannel,
          payload: { value: midiValue(64) }, // Center
          source: op
        })
      }
      break
    }

    case 'rest':
      break

    case 'control':
      events.push({
        kind: 'control',
        startSeconds: tm.beatToSeconds(op.beatStart),
        channel,
        payload: {
          controller: midiControl(original.controller),
          value: midiValue(original.value)
        },
        source: op
      })
      break

    case 'tempo':
      events.push({
        kind: 'tempo',
        startSeconds: tm.beatToSeconds(op.beatStart),
        payload: {
          bpm: original.bpm,
          transition: original.transition
        },
        source: op
      })
      break

    case 'pitch_bend': {
      // Map semitones to normalized value (-1 to +1)
      const bendRange = 2 // Standard range
      const normalized = original.semitones / bendRange
      events.push({
        kind: 'pitch_bend',
        startSeconds: tm.beatToSeconds(op.beatStart),
        channel,
        payload: {
          value: midiValue(Math.round(64 + normalized * 63)) // 0-127, 64 = center
        },
        source: op
      })
      break
    }

    case 'transpose':
      state.transposition += original.semitones
      break

    case 'dynamics': {
      const start = tm.beatToSeconds(op.beatStart)
      const dur = tm.durationToSeconds(op.beatStart, op.beatDuration)
      state.dynamicsRegion = {
        type: original.type,
        startSeconds: start,
        endSeconds: start + dur,
        fromVelocity: original.from,
        toVelocity: original.to,
        curve: original.curve,
        points: original.points
      }
    }
      break

    case 'aftertouch':
      events.push({
        kind: 'aftertouch',
        startSeconds: tm.beatToSeconds(op.beatStart),
        channel,
        payload: {
          type: original.type ?? 'channel',
          value: midiValue(Math.round(original.value * 127)),
          note: original.note
        },
        source: op
      })
      break

    case 'vibrato':
      events.push({
        kind: 'control',
        startSeconds: tm.beatToSeconds(op.beatStart),
        channel,
        payload: {
          controller: midiControl(1),
          value: midiValue(Math.round((original.depth ?? 0.5) * 127))
        },
        source: op
      })
      break

    case 'automation': {
      events.push({
        kind: 'automation',
        startSeconds: tm.beatToSeconds(op.beatStart),
        channel,
        payload: {
          target: original.target,
          value: original.value,
          rampBeats: original.rampBeats,
          curve: original.curve
        },
        source: op
      })
    }
      break

    case 'stack':
      warnings.push(`Unexpected stack operation in Emit phase`)
      break

    case 'time_signature':
      break

    case 'loop':
    case 'clip':
      break
  }
}

function isMarker(op: any): op is PipelineMarker {
  return op.kind === 'stack_start' || op.kind === 'stack_end' ||
    op.kind === 'branch_start' || op.kind === 'branch_end' ||
    op.kind === 'scope_start' || op.kind === 'scope_end' ||
    op.kind === 'block_marker'
}

function applyEasing(t: number, curve?: EasingCurve): number {
  if (!curve) return t
  switch (curve) {
    case 'linear':
      return t
    case 'exponential':
      return t * t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'logarithmic':
      return Math.sqrt(t)
    default:
      return t
  }
}
