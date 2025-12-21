// =============================================================================
// SymphonyScript - Effect Routing Resolver (RFC-018)
// =============================================================================

import type { SessionNode } from '../../../../symphonyscript/packages/core/src/session/types'
import type { Instrument } from '../../../../symphonyscript/packages/core/src/instrument/Instrument'
import type { InstrumentId, NoteDuration } from '../../../../symphonyscript/packages/core/src/types/primitives'
import type { EffectType } from '../../../../symphonyscript/packages/core/src/effects/types'
import type { ValidationIssue } from './validation'
import { parseDuration } from '../../../../symphonyscript/packages/core/src/util/duration'

// --- Routing Graph Types ---

/**
 * Complete audio routing graph for effects.
 * Used by runtime to wire up insert chains and send buses.
 */
export interface AudioRoutingGraph {
  /** Per-track insert chains and send configurations */
  tracks: TrackRouting[]
  /** Session-level effect bus definitions */
  buses: BusDefinition[]
}

/**
 * Routing configuration for a single track.
 */
export interface TrackRouting {
  /** Instrument ID this routing belongs to */
  instrumentId: InstrumentId
  /** Track name for debugging */
  trackName?: string
  /** Insert effects in signal chain order */
  inserts: CompiledEffect[]
  /** Sends to effect buses */
  sends: { busId: string; amount: number }[]
}

/**
 * A session-level effect bus definition.
 */
export interface BusDefinition {
  /** Unique bus identifier */
  id: string
  /** The effect configuration */
  effect: CompiledEffect
}

/**
 * A compiled effect with resolved parameters.
 * Tempo-synced values (like delay time) are converted to ms.
 */
export interface CompiledEffect {
  /** Effect type */
  type: EffectType
  /** Resolved parameters (e.g., '8n' → 250ms at 120 BPM) */
  params: Record<string, unknown>
}

// --- Resolver ---

/**
 * Resolve effect routing from a session.
 * 
 * - Collects all track insert/send configurations
 * - Collects all session bus definitions
 * - Resolves tempo-synced delay times to milliseconds
 * - Validates send targets exist
 * 
 * @param session - The session node to resolve
 * @param idMap - Map of instruments to their assigned IDs
 * @param bpm - Session tempo for resolving tempo-synced values
 * @returns Routing graph and any validation warnings
 */
export function resolveRouting(
  session: SessionNode,
  idMap: Map<Instrument, InstrumentId>,
  bpm: number
): { routing: AudioRoutingGraph; warnings: ValidationIssue[] } {
  const warnings: ValidationIssue[] = []
  
  // Collect valid bus IDs
  const busIds = new Set(session.effectBuses?.map(b => b.id) ?? [])
  
  // Build bus definitions (resolve tempo-synced delay times)
  const buses: BusDefinition[] = (session.effectBuses ?? []).map(bus => ({
    id: bus.id,
    effect: resolveEffect(bus.type, bus.params, bpm)
  }))
  
  // Build track routing
  const tracks: TrackRouting[] = session.tracks.map(track => {
    const instrumentId = idMap.get(track.instrument)
    
    if (!instrumentId) {
      // This should never happen if buildManifest ran first
      throw new Error(`No instrument ID found for track '${track.name ?? 'unnamed'}'`)
    }
    
    // Resolve insert effects
    const inserts: CompiledEffect[] = (track.inserts ?? []).map(insert =>
      resolveEffect(insert.type, insert.params, bpm)
    )
    
    // Validate and collect sends
    const validSends: { busId: string; amount: number }[] = []
    
    for (const send of track.sends ?? []) {
      if (!busIds.has(send.bus)) {
        warnings.push({
          level: 'warning',
          code: 'SEND_TO_UNKNOWN_BUS',
          message: `Track '${track.name ?? 'Unnamed'}' sends to unknown bus '${send.bus}'. Send will be ignored.`
        })
      } else {
        validSends.push({ busId: send.bus, amount: send.amount })
      }
    }
    
    return {
      instrumentId,
      trackName: track.name,
      inserts,
      sends: validSends
    }
  })
  
  return { routing: { tracks, buses }, warnings }
}

/**
 * Resolve effect parameters, converting tempo-synced values.
 * 
 * Currently handles:
 * - delay.time: NoteDuration → milliseconds
 * - reverb.preDelay: Could be tempo-synced in future
 */
function resolveEffect(
  type: EffectType,
  params: Record<string, unknown>,
  bpm: number
): CompiledEffect {
  const resolved = { ...params }
  
  // Resolve tempo-synced delay time
  if (type === 'delay' && resolved.time !== undefined) {
    const time = resolved.time
    if (typeof time === 'string') {
      // It's a NoteDuration - convert to milliseconds
      const beats = parseDuration(time as NoteDuration)
      const msPerBeat = 60000 / bpm
      resolved.time = beats * msPerBeat
    }
    // If it's already a number, it's assumed to be in ms
  }
  
  return { type, params: resolved }
}
