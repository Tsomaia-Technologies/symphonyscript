// =============================================================================
// SymphonyScript - Clip Factory (Music OS Entry Point)
// =============================================================================
// High-level DSL factory for composing music.

import { SiliconSynapse, SiliconBridge } from '@symphonyscript/kernel'
import { SynapticClip } from './SynapticClip'
import { SynapticMelody } from './SynapticMelody'


// =============================================================================
// Session Singleton
// =============================================================================

let activeBridge: SiliconBridge | null = null

/**
 * Initialize the Music OS session with a bridge.
 * Must be called before using Clip factory methods.
 */
export function initSession(bridge: SiliconBridge): void {
    activeBridge = bridge
}

/**
 * Create a default session if none exists.
 * For testing and quick prototyping.
 */
function getOrCreateBridge(): SiliconBridge {
    if (!activeBridge) {
        const linker = SiliconSynapse.create({
            nodeCapacity: 1024,
            safeZoneTicks: 0
        })
        activeBridge = new SiliconBridge(linker)
    }
    return activeBridge
}

// =============================================================================
// Clip Factory
// =============================================================================

/**
 * Clip factory for Music OS.
 * 
 * High-level DSL entry point for musical composition.
 * 
 * Usage:
 * ```typescript
 * const intro = Clip.melody('Intro')
 *   .key('C')
 *   .degree(1).degree(3).degree(5)
 * 
 * const verse = Clip.melody('Verse')
 *   .chord([1, 4, 6])
 * 
 * intro.play(verse)
 * ```
 */
export const Clip = {
    /**
     * Create a melody clip builder.
     * Returns SynapticMelody with fluent DSL (degree, chord, key, scale, etc.).
     * @param name - Clip name (for identification)
     */
    melody(name: string): SynapticMelody {
        const bridge = getOrCreateBridge()
        return new SynapticMelody(bridge)
    },

    /**
     * Create a generic clip builder.
     * Returns SynapticClip with fluent DSL (note, rest, play).
     * @param name - Clip name (for identification)
     */
    clip(name: string): SynapticClip {
        const bridge = getOrCreateBridge()
        return new SynapticClip(bridge)
    }
}
