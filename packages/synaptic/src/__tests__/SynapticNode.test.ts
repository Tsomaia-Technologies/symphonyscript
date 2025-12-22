// =============================================================================
// SynapticNode Tests - Synaptic Package
// =============================================================================

import { SynapticNode } from '../SynapticNode'
import { SiliconSynapse, SiliconBridge, NULL_PTR, NODE } from '@symphonyscript/kernel'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestBridge(): SiliconBridge {
    const linker = SiliconSynapse.create({
        nodeCapacity: 256,
        safeZoneTicks: 0 // Disable safe zone for testing
    })
    return new SiliconBridge(linker)
}

// Helper to read node data from SAB using the linker's readNode callback
function readNodeFromSAB(
    bridge: SiliconBridge,
    ptr: number
): {
    pitch: number
    velocity: number
    duration: number
    baseTick: number
    nextPtr: number
    sourceId: number
} | null {
    let result: {
        pitch: number
        velocity: number
        duration: number
        baseTick: number
        nextPtr: number
        sourceId: number
    } | null = null

    bridge.getLinker().readNode(ptr, (
        _ptr: number,
        _opcode: number,
        pitch: number,
        velocity: number,
        duration: number,
        baseTick: number,
        nextPtr: number,
        sourceId: number,
        _flags: number,
        _seq: number
    ): void => {
        result = {
            pitch,
            velocity,
            duration,
            baseTick,
            nextPtr,
            sourceId
        }
    })

    return result
}

// Helper to check if a synapse exists between two source IDs
function synapseExists(
    bridge: SiliconBridge,
    sourceId: number,
    targetId: number
): boolean {
    const sourcePtr = bridge.getNodePtr(sourceId)
    const targetPtr = bridge.getNodePtr(targetId)

    if (sourcePtr === undefined || targetPtr === undefined) {
        return false
    }

    // Use the bridge's synapse allocator to check if connection exists
    // We'll read synapse data by checking the connection
    const linker = bridge.getLinker()
    const sab = linker.getSAB()
    const i32 = new Int32Array(sab)

    // The SynapseAllocator stores synapses in a table indexed by slot
    // We need to scan the table to find a synapse with matching source/target
    // This is done via the synapse table which is accessible through the allocator

    // For testing purposes, we can verify by attempting to disconnect
    // If disconnect succeeds, a synapse existed
    // But that's destructive. Instead, let's check via snapshot.

    // Actually, let's use a simpler approach: check if we can find the synapse
    // by inspecting the synapse table directly

    // Get synapse allocator (it's private, but we can access via the bridge's methods)
    // The connect() method returns a SynapsePtr or error code
    // If the synapse already exists, it might return an error or overwrite

    // For this test, we'll use a different approach:
    // We'll use the snapshot API to check if the synapse exists
    let found = false

    bridge.snapshotStream(
        (sid: number, tid: number, _weight: number, _jitter: number): void => {
            if (sid === sourceId && tid === targetId) {
                found = true
            }
        },
        (_count: number): void => { } // onComplete callback
    )

    return found
}

// =============================================================================
// SynapticNode Tests
// =============================================================================

describe('SynapticNode - Basic Construction', () => {
    test('constructs with SiliconBridge', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        expect(builder).toBeInstanceOf(SynapticNode)
    })

    test('getEntryId throws when no notes added', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        expect(() => builder.getEntryId()).toThrow('No entry ID')
    })

    test('getExitId throws when no notes added', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        expect(() => builder.getExitId()).toThrow('No exit ID')
    })
})

describe('SynapticNode - Adding Notes', () => {
    test('addNote sets entryId and exitId', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        builder.addNote(60, 100, 480, 0)

        expect(() => builder.getEntryId()).not.toThrow()
        expect(() => builder.getExitId()).not.toThrow()
        expect(builder.getEntryId()).toBe(builder.getExitId())
    })

    test('addNote creates linked list in SAB', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        builder.addNote(60, 100, 480, 0)
        builder.addNote(64, 110, 480, 480)

        const entryId = builder.getEntryId()
        const exitId = builder.getExitId()

        // Entry and exit should be different for 2 notes
        expect(entryId).not.toBe(exitId)

        // Read the entry node from SAB
        const entryPtr = bridge.getNodePtr(entryId)!
        const entryNode = readNodeFromSAB(bridge, entryPtr)!

        expect(entryNode.pitch).toBe(60)
        expect(entryNode.velocity).toBe(100)
        expect(entryNode.duration).toBe(480)
        expect(entryNode.baseTick).toBe(0)

        // Verify linked list: entry's nextPtr should point to exit node
        expect(entryNode.nextPtr).not.toBe(NULL_PTR)

        const exitPtr = bridge.getNodePtr(exitId)!
        expect(entryNode.nextPtr).toBe(exitPtr)

        // Read the exit node
        const exitNode = readNodeFromSAB(bridge, exitPtr)!
        expect(exitNode.pitch).toBe(64)
        expect(exitNode.velocity).toBe(110)
        expect(exitNode.sourceId).toBe(exitId)
    })

    test('addNote chains multiple notes in order', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        builder.addNote(60, 100, 480, 0)     // Note 1
        builder.addNote(64, 110, 480, 480)   // Note 2
        builder.addNote(67, 120, 480, 960)   // Note 3

        const entryId = builder.getEntryId()
        const exitId = builder.getExitId()

        // Walk the linked list
        const entryPtr = bridge.getNodePtr(entryId)!
        const node1 = readNodeFromSAB(bridge, entryPtr)!

        expect(node1.pitch).toBe(60)
        expect(node1.nextPtr).not.toBe(NULL_PTR)

        const node2 = readNodeFromSAB(bridge, node1.nextPtr)!
        expect(node2.pitch).toBe(64)
        expect(node2.nextPtr).not.toBe(NULL_PTR)

        const node3 = readNodeFromSAB(bridge, node2.nextPtr)!
        expect(node3.pitch).toBe(67)
        expect(node3.sourceId).toBe(exitId)
    })

    test('addNote handles muted parameter', () => {
        const bridge = createTestBridge()
        const builder = new SynapticNode(bridge)

        builder.addNote(60, 100, 480, 0, true)

        const entryId = builder.getEntryId()

        // Verify muted state via bridge.readNote
        let muted = false
        bridge.readNote(entryId, (_p: number, _v: number, _d: number, _bt: number, m: boolean): void => {
            muted = m
        })

        expect(muted).toBe(true)
    })
})

describe('SynapticNode - Linking Builders', () => {
    test('linkTo creates synapse connection', () => {
        const bridge = createTestBridge()

        const builderA = new SynapticNode(bridge)
        builderA.addNote(60, 100, 480, 0)
        builderA.addNote(64, 110, 480, 480)

        const builderB = new SynapticNode(bridge)
        builderB.addNote(67, 120, 480, 960)
        builderB.addNote(72, 130, 480, 1440)

        // Link A to B
        builderA.linkTo(builderB)

        // Verify synapse exists between A's exit and B's entry
        const exitIdA = builderA.getExitId()
        const entryIdB = builderB.getEntryId()

        expect(synapseExists(bridge, exitIdA, entryIdB)).toBe(true)
    })

    test('linkTo with weight and jitter parameters', () => {
        const bridge = createTestBridge()

        const builderA = new SynapticNode(bridge)
        builderA.addNote(60, 100, 480, 0)

        const builderB = new SynapticNode(bridge)
        builderB.addNote(64, 110, 480, 480)

        // Link with custom weight and jitter
        builderA.linkTo(builderB, 750, 100)

        // Verify synapse exists (weight/jitter verification would require
        // deeper SAB inspection or snapshot API)
        expect(synapseExists(bridge, builderA.getExitId(), builderB.getEntryId())).toBe(true)
    })

    test('linkTo throws when source has no notes', () => {
        const bridge = createTestBridge()

        const builderA = new SynapticNode(bridge)
        const builderB = new SynapticNode(bridge)
        builderB.addNote(60, 100, 480, 0)

        expect(() => builderA.linkTo(builderB)).toThrow('Cannot link: source builder has no exit')
    })

    test('linkTo throws when target has no notes', () => {
        const bridge = createTestBridge()

        const builderA = new SynapticNode(bridge)
        builderA.addNote(60, 100, 480, 0)

        const builderB = new SynapticNode(bridge)

        expect(() => builderA.linkTo(builderB)).toThrow('No entry ID')
    })
})

describe('SynapticNode - Complete Scenario', () => {
    test('builderA adds 2 notes, builderB adds 2 notes, link A to B', () => {
        const bridge = createTestBridge()

        // Create builderA and add 2 notes
        const builderA = new SynapticNode(bridge)
        builderA.addNote(60, 100, 480, 0, false)
        builderA.addNote(64, 110, 480, 480, false)

        // Create builderB and add 2 notes
        const builderB = new SynapticNode(bridge)
        builderB.addNote(67, 120, 480, 960, false)
        builderB.addNote(72, 130, 480, 1440, false)

        // Link builderA to builderB
        builderA.linkTo(builderB)

        // ========================================================================
        // VERIFICATION: Check SAB contains the linked list
        // ========================================================================

        const entryA = builderA.getEntryId()
        const exitA = builderA.getExitId()
        const entryB = builderB.getEntryId()
        const exitB = builderB.getExitId()

        // Verify builderA's chain
        const ptrA1 = bridge.getNodePtr(entryA)!
        const nodeA1 = readNodeFromSAB(bridge, ptrA1)!
        expect(nodeA1.pitch).toBe(60)
        expect(nodeA1.baseTick).toBe(0)
        expect(nodeA1.nextPtr).not.toBe(NULL_PTR)

        const nodeA2 = readNodeFromSAB(bridge, nodeA1.nextPtr)!
        expect(nodeA2.pitch).toBe(64)
        expect(nodeA2.baseTick).toBe(480)
        expect(nodeA2.sourceId).toBe(exitA)

        // Verify builderB's chain
        const ptrB1 = bridge.getNodePtr(entryB)!
        const nodeB1 = readNodeFromSAB(bridge, ptrB1)!
        expect(nodeB1.pitch).toBe(67)
        expect(nodeB1.baseTick).toBe(960)
        expect(nodeB1.nextPtr).not.toBe(NULL_PTR)

        const nodeB2 = readNodeFromSAB(bridge, nodeB1.nextPtr)!
        expect(nodeB2.pitch).toBe(72)
        expect(nodeB2.baseTick).toBe(1440)
        expect(nodeB2.sourceId).toBe(exitB)

        // ========================================================================
        // VERIFICATION: Check synapse connection exists
        // ========================================================================

        expect(synapseExists(bridge, exitA, entryB)).toBe(true)

        // Additional verification: use streamSnapshot to get synapse details
        let foundSynapse = false
        let synapseWeight = 0
        let synapseJitter = 0

        bridge.snapshotStream(
            (sourceId: number, targetId: number, weight: number, jitter: number): void => {
                if (sourceId === exitA && targetId === entryB) {
                    foundSynapse = true
                    synapseWeight = weight
                    synapseJitter = jitter
                }
            },
            (_count: number): void => { } // onComplete
        )

        expect(foundSynapse).toBe(true)
        // Default weight should be 500 (from SiliconBridge.connect)
        expect(synapseWeight).toBe(500)
        expect(synapseJitter).toBe(0)
    })
})
