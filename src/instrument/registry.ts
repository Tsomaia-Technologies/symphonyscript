import type { Instrument } from './Instrument'
import { InstrumentId, unsafeInstrumentId } from '../types/primitives'
import type { SerializedSidechainConfig } from './types'

/**
 * Registry for instrument identity resolution.
 * Used during compilation to resolve ID-based references.
 */
export class InstrumentRegistry {
  private instruments = new Map<InstrumentId, Instrument>()
  private reverseMap = new WeakMap<Instrument, InstrumentId>()

  /**
   * Register an instrument with an explicit ID.
   */
  register(id: InstrumentId, instrument: Instrument): void {
    if (this.instruments.has(id)) {
      // If it's the exact same instrument instance, it's fine (idempotent)
      if (this.instruments.get(id) === instrument) return

      throw new Error(`Instrument ID "${id}" already registered`)
    }
    this.instruments.set(id, instrument)
    this.reverseMap.set(instrument, id)
  }

  /**
   * Auto-register an instrument, generating an ID if needed.
   */
  autoRegister(instrument: Instrument): InstrumentId {
    const existing = this.reverseMap.get(instrument)
    if (existing) return existing

    const id = unsafeInstrumentId(
      instrument.name
        ? `${instrument.name}-${crypto.randomUUID().slice(0, 8)}`
        : crypto.randomUUID()
    )

    this.register(id, instrument)
    return id
  }

  /**
   * Get instrument by ID.
   */
  get(id: InstrumentId): Instrument | undefined {
    return this.instruments.get(id)
  }

  /**
   * Get ID for instrument (if registered).
   */
  getId(instrument: Instrument): InstrumentId | undefined {
    return this.reverseMap.get(instrument)
  }

  /**
   * Check if instrument is registered.
   */
  has(instrument: Instrument): boolean {
    return this.reverseMap.has(instrument)
  }

  /**
   * Clear all registrations.
   */
  clear(): void {
    this.instruments.clear()
    // WeakMap entries are automatically cleaned up
  }

  /**
   * Get all registered instruments as a manifest.
   */
  toManifest(): Record<InstrumentId, import('./types').SerializedInstrumentConfig> {
    const manifest: Record<InstrumentId, import('./types').SerializedInstrumentConfig> = {}

    for (const [id, inst] of this.instruments) {
      const { config, sidechain } = this.splitConfig(inst)

      manifest[id] = {
        type: inst.kind,
        name: inst.name ?? 'Unnamed Instrument',
        config: config as any,
        sidechain
      }
    }

    return manifest
  }

  private splitConfig(inst: Instrument): { config: unknown; sidechain?: SerializedSidechainConfig } {
    const config = { ...(inst.config as any) }
    let sidechain: SerializedSidechainConfig | undefined

    // Convert sidechain source to ID reference
    if (inst.sidechainConfig) {
      const sourceId = this.reverseMap.get(inst.sidechainConfig.source)
      if (!sourceId) {
        throw new Error(
          `Sidechain source for "${inst.name}" is not registered. ` +
          `Register all instruments before serializing.`
        )
      }

      sidechain = {
        sourceId,  // ID reference instead of object
        amount: inst.sidechainConfig.amount,
        attack: inst.sidechainConfig.attack,
        release: inst.sidechainConfig.release
      }
    }

    // Remove 'sidechain' from the inner config object to avoid confusion/duplication
    // and to match the serializable type which shouldn't have object refs
    delete config.sidechain

    return { config, sidechain }
  }
}

// Global default registry (optional usage)
export const globalRegistry = new InstrumentRegistry()
