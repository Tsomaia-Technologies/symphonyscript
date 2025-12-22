// =============================================================================
// SymphonyScript - SynapticNode (Phase 1: Builder Package)
// =============================================================================
// Unopinionated structure builder - low-level wrapper around SiliconBridge.
//
// CONSTRAINTS:
// - Strict typing (no any)
// - Zero-allocation in addNote (no temporary arrays/objects)
// - Blind implementation following exact method signatures

import type { SiliconBridge } from '@symphonyscript/kernel'

/**
 * SynapticNode - Clean low-level wrapper around SiliconBridge.
 * 
 * Tracks entry and exit source IDs for building note chains and
 * creating synaptic connections between builders.
 */
export class SynapticNode {
    private bridge: SiliconBridge
    private entryId: number | undefined
    private exitId: number | undefined

    /**
     * Create a new SynapticNode.
     * 
     * @param bridge - Instance of SiliconBridge from @symphonyscript/core
     */
    constructor(bridge: SiliconBridge) {
        this.bridge = bridge
        this.entryId = undefined
        this.exitId = undefined
    }

    /**
     * Add a note to the builder's chain.
     * 
     * Zero-allocation implementation: no temporary arrays or objects.
     * 
     * @param pitch - MIDI pitch (0-127)
     * @param velocity - MIDI velocity (0-127)
     * @param duration - Duration in ticks
     * @param baseTick - Start tick position
     * @param muted - Optional mute state (default: false)
     */
    addNote(
        pitch: number,
        velocity: number,
        duration: number,
        baseTick: number,
        muted?: boolean
    ): void {
        // Call bridge.insertAsync with afterSourceId set to current exit
        // This will chain notes together in the order they're added
        const sourceId = this.bridge.generateSourceId()

        const ptr = this.bridge.insertAsync(
            0x01, // OPCODE.NOTE
            pitch,
            velocity,
            duration,
            baseTick,
            muted ?? false,
            sourceId,
            this.exitId
        )

        // Only update IDs if insertion succeeded (ptr >= 0)
        if (ptr >= 0) {
            // Set entryId on first note
            if (this.entryId === undefined) {
                this.entryId = sourceId
            }

            // Always update exitId to the newly added note
            this.exitId = sourceId

            // Register mapping to make sourceId usable
            // Note: We need to process commands to actually link the node
            this.bridge.getLinker().processCommands()
        }
    }

    /**
     * Link this builder to a target builder via synaptic connection.
     * 
     * Creates a synapse from this builder's exit to the target's entry.
     * 
     * @param target - Target SynapticNode to link to
     * @param weight - Optional synapse weight (0-1000, default: 500)
     * @param jitter - Optional jitter in ticks (0-65535, default: 0)
     */
    linkTo(target: SynapticNode, weight?: number, jitter?: number): void {
        // Validate that both builders have notes
        if (this.exitId === undefined) {
            throw new Error('Cannot link: source builder has no exit (no notes added)')
        }

        const targetEntryId = target.getEntryId() // Will throw if undefined

        // Create synaptic connection
        this.bridge.connect(this.exitId, targetEntryId, { weight, jitter })
    }

    /**
     * Get the source ID of the first note added to this builder.
     * 
     * @returns The entry source ID
     * @throws Error if no notes have been added
     */
    getEntryId(): number {
        if (this.entryId === undefined) {
            throw new Error('No entry ID: no notes have been added to this builder')
        }
        return this.entryId
    }

    /**
     * Get the source ID of the last note added to this builder.
     * 
     * @returns The exit source ID
     * @throws Error if no notes have been added
     */
    getExitId(): number {
        if (this.exitId === undefined) {
            throw new Error('No exit ID: no notes have been added to this builder')
        }
        return this.exitId
    }
}
