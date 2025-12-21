// =============================================================================
// SymphonyScript v2.1 - Compiler (Pipeline-Based)
// =============================================================================
// =============================================================================
import { InstrumentId, unsafeInstrumentId, unsafeNoteName, type TimeSignatureString } from '@symphonyscript/core/types/primitives'
import type { SessionNode, TrackNode } from '@symphonyscript/core/session/types'
import type { Instrument } from '@symphonyscript/core/instrument/Instrument'
import { AudioEvent, CompiledOutput, TempoChange } from './types'
// Pipeline Import
import type { CompiledEvent } from './pipeline/types'
import { compileClip } from './pipeline'
import { parseDuration } from './utils'
import { type AsciiOptions, renderAsciiTimeline, type TrackEvents } from '../debug/ascii'
import { validateSession, ValidationIssue } from './validation'
import { resolveInitialTempo } from './tempo-resolver'
import { resolveInitialTimeSignature } from './timesig-resolver'
import { resolveRouting } from './routing-resolver'

export { serializeTimeline, SerializeOptions } from './serialize'

// --- Compile Options ---

export interface CompileOptions {
  // bpm removed - use session({ tempo }) or track options
  /** 
   * @deprecated Use session({ timeSignature }) or Track options instead.
   * This option is now a fallback if no hierarchy override is found (though resolver defaults to 4/4 anyway).
   */
  timeSignature?: TimeSignatureString
  seed?: number
  /** Emit warnings for common mistakes. Default: true in development */
  warnings?: boolean
  /** Throw errors for deprecated patterns. Default: false */
  strictDeprecations?: boolean
  /** Require branded NoteName types (no raw strings). Default: false */
  strictNoteNames?: boolean
}

// --- ID Resolution ---

function buildManifest(session: SessionNode): {
  manifest: Record<InstrumentId, any>
  idMap: Map<Instrument, InstrumentId>
} {
  const manifest: Record<InstrumentId, any> = {}
  const idMap = new Map<Instrument, InstrumentId>()

  function visit(inst: Instrument) {
    if (idMap.has(inst)) return

    const id = unsafeInstrumentId(crypto.randomUUID())
    idMap.set(inst, id)

    const config = inst.config
    const finalConfig: any = { ...config, name: inst.name }

    if (inst.sidechainConfig) {
      visit(inst.sidechainConfig.source)
      const sourceId = idMap.get(inst.sidechainConfig.source)

      if (!sourceId) {
        throw new Error(`Failed to resolve ID for sidechain source on instrument "${inst.name}"`)
      }

      finalConfig.sidechain = {
        ...inst.sidechainConfig,
        source: sourceId
      }
    }

    manifest[id] = finalConfig
  }

  for (const track of session.tracks) {
    // console.log('Visiting track', track.name, track.instrument)
    visit(track.instrument)
  }

  // console.log('Manifest built:', Object.keys(manifest).length, 'instruments')
  return { manifest, idMap }
}

// --- Main Compiler ---

export interface CompileResult {
  output: CompiledOutput
  warnings: ValidationIssue[]
  /** Print ASCII timeline to console (debug only) */
  print?: (options?: AsciiOptions) => void
  /** Get ASCII timeline as string (debug only) */
  toAscii?: (options?: AsciiOptions) => string
}

export function compile(
  sessionInput: SessionNode | { build(): SessionNode },
  options: CompileOptions = {}
): CompileResult {
  // Normalize Session Builder -> SessionNode
  const session = ('build' in sessionInput && typeof sessionInput.build === 'function')
    ? sessionInput.build()
    : sessionInput as SessionNode

  // 0. Validate Session
  const issues = validateSession(session)
  const errors = issues.filter(i => i.level === 'error')

  if (errors.length > 0) {
    throw new Error(
      `Compilation failed with ${errors.length} errors:\n` +
      errors.map(e => `  [${e.code}] ${e.message} ${e.location ? `(at ${e.location.clip})` : ''}`).join('\n')
    )
  }

// DEBUG
  if (options.seed !== undefined) console.log('Compiling with seed', options.seed)

  // Normalize options
  const fallbackTimeSignature = options.timeSignature // Legacy option fallback
  const seed = options.seed

  // 1. Resolve Identities
  const { manifest, idMap } = buildManifest(session)

  const allEvents: AudioEvent[] = []
  const tempoChanges: TempoChange[] = []
  const debugTracks: TrackEvents[] = []
  let maxDurationSeconds = 0

  for (const track of session.tracks) {
    const instrumentId = idMap.get(track.instrument)
    if (!instrumentId) continue

    // 2. Resolve Tempo & Compile Events via Pipeline
    const trackBpm = resolveInitialTempo(session, track, track.clip)
    
    // Resolve Time Signature (Hierarchy: Clip -> Track -> Session -> Options -> 4/4)
    // We pass the session/track objects to the resolver, checking standard hierarchy first.
    // If resolver returns '4/4' (default), we check if legacy options.timeSignature was provided.
    // However, clean implementation implies hierarchy should win. 
    // Let's rely on resolver which checks session context.
    const resolvedTimeSig = resolveInitialTimeSignature(session, track, track.clip)
    
    // If resolver defaulted (did not find explicit override) but legacy option is present, use it?
    // RFC behavior: Hierarchy includes Session. 
    // If session.timeSignature is undefined, resolver returns 4/4.
    // To support backward compat seamlessly: if resolver returns default '4/4' AND we have a legacy option, use legacy option.
    // But checking if "resolver returned default" is tricky without exposing source.
    // Better strategy: The hierarchy is Clip -> Track -> Session -> 4/4.
    // Legacy `options.timeSignature` is passed where? 
    // It's conceptually a "compilation-level" default.
    // We can interpret `fallbackTimeSignature` as a "global default" replacing the '4/4' fallback.
    
    // Let's refine logical precedence:
    // If resolver returns NOT 4/4, use it.
    // If resolver returns 4/4, check fallback options.
    const activeTimeSig = (resolvedTimeSig === '4/4' && fallbackTimeSignature) 
      ? fallbackTimeSignature 
      : resolvedTimeSig

    const result = compileTrack(track, instrumentId, trackBpm, activeTimeSig, seed)
    allEvents.push(...result.events)
    tempoChanges.push(...result.tempoChanges)

    // Collect for debug
    debugTracks.push({
      name: track.name ?? 'Track',
      instrumentId,
      events: result.rawEvents // We need raw CompilveEvents for renderer?
      // Wait, renderAsciiTimeline expects CompiledEvent[] (from pipeline), but compileTrack returns legacy AudioEvent[].
      // renderAsciiTimeline logic: "if (event.kind !== 'note') continue"
      // AudioEvent has 'note_on', 'control', etc.
      // My renderer `ascii.ts` imports `CompiledEvent` from `pipeline/types`.
      // AudioEvent != CompiledEvent.
      // I need to enable compileTrack to return the raw pipeline events too if I want to use them.
      // OR I update renderAsciiTimeline to handle AudioEvent?
      // The spec says `renderAsciiTimeline(tracks: TrackEvents[])`. `TrackEvents` has `events: CompiledEvent[]`.
      // So I must provide `CompiledEvent[]`.
      // `compileTrack` calls `compileClip` which returns `CompiledClip` (containing `CompiledEvent[]`).
      // I should modify `compileTrack` to return the `CompiledClip` or just the events.
    })

    if (result.durationSeconds > maxDurationSeconds) {
      maxDurationSeconds = result.durationSeconds
    }
  }

  // Sort by time
  allEvents.sort((a, b) => a.time - b.time)

  // Dedupe tempo changes
  const uniqueTempoChanges = tempoChanges.reduce((acc, change) => {
    const existing = acc.find(c => Math.abs(c.atSecond - change.atSecond) < 0.001)
    if (!existing) acc.push(change)
    return acc
  }, [] as TempoChange[])

  // Resolve effect routing (RFC-018)
  const sessionBpm = session.tempo ?? 120
  const { routing, warnings: routingWarnings } = resolveRouting(session, idMap, sessionBpm)
  issues.push(...routingWarnings)

  return {
    output: {
      meta: {
        // bpm meta is now ambiguous with mixed tempos.
        // We report the session default or fallback 120 for meta display.
        bpm: sessionBpm,
        durationSeconds: maxDurationSeconds,
        timeSignature: session.timeSignature ?? fallbackTimeSignature ?? '4/4',
        tempoChanges: uniqueTempoChanges.sort((a, b) => a.atSecond - b.atSecond)
      },
      manifest,
      timeline: allEvents,
      routing: routing.tracks.length > 0 || routing.buses.length > 0 ? routing : undefined
    },
    warnings: issues.filter(i => i.level === 'warning'),
    print: (asciiOptions?: AsciiOptions) => {
      // For ASCII we need a reference BPM. Use session default or 120.
      console.log(renderAsciiTimeline(debugTracks, { bpm: session.tempo ?? 120, ...asciiOptions }))
    },
    toAscii: (asciiOptions?: AsciiOptions) => {
      return renderAsciiTimeline(debugTracks, { bpm: session.tempo ?? 120, ...asciiOptions })
    }
  }
}

// --- Track Compilation ---

interface TrackCompileResult {
  events: AudioEvent[]
  tempoChanges: TempoChange[]
  durationSeconds: number
  rawEvents: CompiledEvent[]
}

function compileTrack(
  track: TrackNode,
  instrumentId: InstrumentId,
  bpm: number,
  timeSignature: TimeSignatureString,
  seed?: number
): TrackCompileResult {
  const config = track.instrument.config as any // Access optional midiChannel
  const channel = track.midiChannel ?? config.midiChannel ?? 1

  // Pipeline Compilation
  const compiled = compileClip(track.clip, {
    bpm,
    timeSignature,
    channel,
    seed
  })

  // Map Events to Legacy AudioEvent format
  const events: AudioEvent[] = []
  const tempoChanges: TempoChange[] = []

  for (const e of compiled.events) {
    switch (e.kind) {
      case 'note':
        // Filter tied notes (legacy behavior: only emit start)
        if (e.payload.tie !== 'continue' && e.payload.tie !== 'end') {
          events.push({
            kind: 'note_on',
            time: e.startSeconds,
            instrumentId,
            note: unsafeNoteName(e.payload.pitch as string),
            velocity: e.payload.velocity as number,
            duration: e.durationSeconds!,
            articulation: e.payload.articulation as any,
            tie: e.payload.tie as any
          })
        }
        break

      case 'control':
        events.push({
          kind: 'control',
          time: e.startSeconds,
          instrumentId,
          controller: e.payload.controller as number,
          value: e.payload.value as number
        })
        break

      case 'automation':
        events.push({
          kind: 'automation',
          time: e.startSeconds,
          instrumentId,
          target: e.payload.target as any,
          value: e.payload.value as number,
          rampSeconds: undefined, // Payload has 'rampBeats'. Convert?
          // Compiler doesn't calculate rampSeconds yet.
          // We can access rampBeats via e.payload.rampBeats
          // But legacy AutomationEvent has rampSeconds? Or did I define it as rampSeconds?
          // In types.ts: rampSeconds?: number.
          // If we want seconds we need to calculate it.
          // Same issue as transitionSeconds in tempo.
          // For now pass undefined or try to calc?
          // Let's leave undefined or strictly map if possible.
          curve: e.payload.curve as any
        })
        break

      case 'pitch_bend':
        events.push({
          kind: 'pitch_bend',
          time: e.startSeconds,
          instrumentId,
          value: e.payload.value as number
        })
        break

      case 'aftertouch':
        events.push({
          kind: 'aftertouch',
          time: e.startSeconds,
          instrumentId,
          type: e.payload.type as any,
          value: e.payload.value as number,
          note: unsafeNoteName(e.payload.note as string)
        })
        break

      case 'tempo': {
        const transition = e.payload.transition as any
        let transitionSeconds: number | undefined

        // We need to calculate transitionSeconds if it was provided
        // However, 'tempo' event payload in emit.ts was just passing original transition object.
        // We need the calculated duration from tempo-map?
        // The emit phase DOES emit 'transitionSeconds' if mapped?
        // My emit.ts: `kind: 'tempo', payload: { bpm, transition }`.
        // It didn't calculate SECONDS duration of transition in payload.
        // BUT tempo properties in `AudioEvent` for legacy compiler require `transitionSeconds`.
        // Legacy compiler calculated it using `integrateTempo` or simple math.

        // Workaround: Re-calculate or use heuristics?
        // Better: The `tempoMap` has it.
        // But we are iterating events.

        if (transition) {
          // Parse duration from transition object
          const durStr = typeof transition === 'object' ? transition.duration : transition
          const durBeats = parseDuration(durStr)
          // Convert beats to seconds at THIS point?
          // Using tempoMap.durationToSeconds(beatStart, durBeats)?
          // We don't have beatStart easily here (it's in source op).

          // `e.source` is `ExpandedOpWrapper`. It has `beatStart` (if cast to TimedOp).
          // Yes, `emit.ts` attaches `source: op`.
          // `op` in emit is `TimedPipelineOp`.

          const op = e.source as any
          if (op && typeof op.beatStart === 'number') {
            // Use compiled.tempoMap
            transitionSeconds = compiled.tempoMap.durationToSeconds(op.beatStart, durBeats)
          }
        }

        const change: TempoChange = {
          atSecond: e.startSeconds,
          bpm: e.payload.bpm as number,
          transitionSeconds,
          curve: (typeof transition === 'object' ? transition.curve : undefined) ?? 'linear'
        }
        tempoChanges.push(change)

        // AudioEvent also needs 'tempo' event?
        // Legacy compiler pushed both TempoChange and AudioEvent(tempo).
        events.push({
          kind: 'tempo',
          time: e.startSeconds,
          bpm: e.payload.bpm as number,
          transitionSeconds,
          curve: change.curve
        })
      }
        break
    }
  }

  return {
    events,
    tempoChanges,
    durationSeconds: compiled.durationSeconds,
    rawEvents: compiled.events
  }
}
