import {parseDuration} from '@symphonyscript/core/util/duration'
import type {ExpandedSequence, TimedPipelineOp, TimedSequence} from './types'
import type {TimeSignatureString} from '@symphonyscript/core/types/primitives'

/**
 * Internal timing state during compilation.
 */
interface TimingState {
  beat: number
  measure: number
  beatInMeasure: number
  beatsPerMeasure: number
}

/**
 * Initial timing state for resuming compilation from a section boundary.
 * Exported for use by incremental compilation.
 */
export interface TimingInitialState {
  beat: number
  measure: number
  beatInMeasure: number
  beatsPerMeasure: number
}

interface StackFrame {
  startTime: number
  maxDuration: number
}

interface TimeSignatureSegment {
  startBeat: number
  beatsPerMeasure: number
}

/**
 * Calculate measure and beatInMeasure from absolute beat position.
 * Uses the time signature segment map for variable signature support.
 */
function beatToMeasure(
  beat: number,
  sigMap: TimeSignatureSegment[]
): { measure: number; beatInMeasure: number } {
  let measure = 1
  let remaining = beat

  for (let i = 0; i < sigMap.length; i++) {
    const seg = sigMap[i]
    const nextStart = sigMap[i + 1]?.startBeat ?? Infinity
    const segBeats = nextStart - seg.startBeat

    if (remaining < segBeats || i === sigMap.length - 1) {
      // We're in this segment
      const measuresInSeg = Math.floor(remaining / seg.beatsPerMeasure)
      return {
        measure: measure + measuresInSeg,
        beatInMeasure: remaining % seg.beatsPerMeasure
      }
    }

    // Count full measures in this segment and move to next
    measure += Math.floor(segBeats / seg.beatsPerMeasure)
    remaining -= segBeats
  }

  return { measure, beatInMeasure: 0 }
}

export function computeTiming(
  sequence: ExpandedSequence,
  timeSignature: TimeSignatureString = '4/4'
): TimedSequence {
  // Parse initial signature
  const [num, denom] = timeSignature.split('/').map(Number)
  const state: TimingState = {
    beat: 0,
    measure: 1,
    beatInMeasure: 0,
    beatsPerMeasure: num * (4 / denom)
  }

  const stack: StackFrame[] = []
  const timedOps: TimedPipelineOp[] = []

  // Build time signature map incrementally for absolute measure calculation
  const sigMap: TimeSignatureSegment[] = [
    { startBeat: 0, beatsPerMeasure: state.beatsPerMeasure }
  ]

  for (const op of sequence.operations) {
    // 1. Handle Markers
    if ('kind' in op) {
      if (op.kind === 'stack_start') {
        stack.push({startTime: state.beat, maxDuration: 0})
        // Markers exist at zero duration at current time
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'branch_start') {
        const frame = stack[stack.length - 1]
        if (frame) {
          // Reset time to stack start
          updateTime(state, frame.startTime, sigMap)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'branch_end') {
        const frame = stack[stack.length - 1]
        if (frame) {
          const branchDur = state.beat - frame.startTime
          frame.maxDuration = Math.max(frame.maxDuration, branchDur)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'stack_end') {
        const frame = stack.pop()
        if (frame) {
          // Advance time to end of longest branch
          updateTime(state, frame.startTime + frame.maxDuration, sigMap)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'scope_start' || op.kind === 'scope_end') {
        // Scope markers happen instantenously at current time
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'block_marker') {
        // Block has known duration - add it and advance time
        const block = op.block
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: block.durationBeats,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        updateTime(state, state.beat + block.durationBeats, sigMap)
        continue
      }
    }

    // 2. Handle Operations
    if (op.kind === 'op') {
      const original = op.original

      // Time Signature Change
      if (original.kind === 'time_signature') {
        const [n, d] = original.signature.split('/').map(Number)
        const newBPM = n * (4 / d)
        state.beatsPerMeasure = newBPM
        // Add to segment map for absolute measure calculation on backward jumps
        sigMap.push({ startBeat: state.beat, beatsPerMeasure: newBPM })
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      // Calculate Duration
      let dur = 0
      if ('duration' in original && original.duration !== undefined) {
        dur = parseDuration(original.duration)
      }

      timedOps.push({
        ...op,
        beatStart: state.beat,
        beatDuration: dur,
        measure: state.measure,
        beatInMeasure: state.beatInMeasure
      })

      // Advance Time
      // Ops that DON'T advance time: tempo, transpose, control, dynamics, etc.
      // BUT 'rest' and 'note' DO advance time.
      const advancesTime =
        original.kind === 'note' ||
        original.kind === 'rest' ||
        (original.kind === 'stack' ? false : false) // stack handled by markers

      // Wait, 'stack' op shouldn't appear here if flattened.
      // If expand logic missed something, we might see it.
      // But expand guarantees no nested stacks.

      if (advancesTime) {
        updateTime(state, state.beat + dur, sigMap)
      }
    }
  }

  return {
    operations: timedOps,
    totalBeats: state.beat,
    measures: state.measure
  }
}

function updateTime(state: TimingState, newBeat: number, sigMap: TimeSignatureSegment[]) {
  if (newBeat < state.beat) {
    // Jumping backward (e.g., branch_start reset to stack entry point)
    // Use absolute measure calculation from segment map
    state.beat = newBeat
    const result = beatToMeasure(newBeat, sigMap)
    state.measure = result.measure
    state.beatInMeasure = result.beatInMeasure
    return
  }

  const delta = newBeat - state.beat
  state.beat = newBeat

  let remaining = delta
  while (remaining > 0) {
    const spaceInMeasure = state.beatsPerMeasure - state.beatInMeasure
    if (remaining >= spaceInMeasure) {
      remaining -= spaceInMeasure
      state.measure++
      state.beatInMeasure = 0
    } else {
      state.beatInMeasure += remaining
      remaining = 0
    }
  }
}

/**
 * Compute timing starting from a specific state.
 * Used for incremental compilation to resume from a section boundary.
 *
 * @param sequence - Expanded sequence to time
 * @param timeSignature - Time signature string (e.g., '4/4')
 * @param initialState - State to resume from
 * @returns Timed sequence
 */
export function computeTimingFromState(
  sequence: ExpandedSequence,
  timeSignature: TimeSignatureString,
  initialState: TimingInitialState
): TimedSequence {
  // Initialize state from provided initial state
  const state: TimingState = {
    beat: initialState.beat,
    measure: initialState.measure,
    beatInMeasure: initialState.beatInMeasure,
    beatsPerMeasure: initialState.beatsPerMeasure
  }

  const stack: StackFrame[] = []
  const timedOps: TimedPipelineOp[] = []

  // Build time signature map starting from initial state
  const sigMap: TimeSignatureSegment[] = [
    { startBeat: initialState.beat, beatsPerMeasure: initialState.beatsPerMeasure }
  ]

  for (const op of sequence.operations) {
    // 1. Handle Markers
    if ('kind' in op) {
      if (op.kind === 'stack_start') {
        stack.push({startTime: state.beat, maxDuration: 0})
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'branch_start') {
        const frame = stack[stack.length - 1]
        if (frame) {
          updateTime(state, frame.startTime, sigMap)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'branch_end') {
        const frame = stack[stack.length - 1]
        if (frame) {
          const branchDur = state.beat - frame.startTime
          frame.maxDuration = Math.max(frame.maxDuration, branchDur)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'stack_end') {
        const frame = stack.pop()
        if (frame) {
          updateTime(state, frame.startTime + frame.maxDuration, sigMap)
        }
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'scope_start' || op.kind === 'scope_end') {
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      if (op.kind === 'block_marker') {
        const block = op.block
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: block.durationBeats,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        updateTime(state, state.beat + block.durationBeats, sigMap)
        continue
      }
    }

    // 2. Handle Operations
    if (op.kind === 'op') {
      const original = op.original

      // Time Signature Change
      if (original.kind === 'time_signature') {
        const [n, d] = original.signature.split('/').map(Number)
        const newBPM = n * (4 / d)
        state.beatsPerMeasure = newBPM
        sigMap.push({ startBeat: state.beat, beatsPerMeasure: newBPM })
        timedOps.push({
          ...op,
          beatStart: state.beat,
          beatDuration: 0,
          measure: state.measure,
          beatInMeasure: state.beatInMeasure
        })
        continue
      }

      // Calculate Duration
      let dur = 0
      if ('duration' in original && original.duration !== undefined) {
        dur = parseDuration(original.duration)
      }

      timedOps.push({
        ...op,
        beatStart: state.beat,
        beatDuration: dur,
        measure: state.measure,
        beatInMeasure: state.beatInMeasure
      })

      // Advance Time
      const advancesTime =
        original.kind === 'note' ||
        original.kind === 'rest' ||
        (original.kind === 'stack' ? false : false)

      if (advancesTime) {
        updateTime(state, state.beat + dur, sigMap)
      }
    }
  }

  return {
    operations: timedOps,
    totalBeats: state.beat,
    measures: state.measure
  }
}
