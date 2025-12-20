# SymphonyScript: AI Agent Rules of Engagement

This document is the primary entry point for AI agents. Follow these protocols to ensure architectural integrity and prevent context pollution.

## 1. Core Architectural Standard
- **The Standard**: RFC-043 (Continuous Silicon Kernel).
- **Memory Model**: Linked-List Instruction Stream in SharedArrayBuffer.

## 2. Implementation Workflow
Before executing any code changes, the agent MUST:
1. **Locate the Phase**: Read the active phase in `/implementation/plans/` (e.g., `phase1_stability.md`).
2. **Check for Reviews**: Review the latest `requested_changes.md` in `/implementation/reviews/`.
3. **Verify Constraints**: Ensure no changes violate the **Safe Zone** or **Atomic Handshake Protocol** defined in RFC-043.

## 3. High-Performance Coding Standards
- **Zero-Allocation**: No `new` keywords or JS object allocations in the hot path.
- **Atomic Operations**: Use `Atomics.compareExchange` for all structural changes.
- **Versioned Reads**: Implement `SEQ` counter loops for all node reads to prevent "Frankenstein" data.

## 4. Lifecycle Automation
- **Tombstones**: Builders must track `touchedSourceIds`.
- **Finalization**: `finalize()` is going to be automated via `Track.build()` and `Session.build()`. Do not require the user to call it manually in complex scripts.

## 5. Role Governance (Strict Separation)

### THE ARCHITECT
- **Responsibility**: Designing the "Silicon Mirroring" system and verifying the Handshake Protocol.
- **Output**: Detailed technical specifications, state machine diagrams, and review documents.
- **CONSTRAINT**: The Architect drafted documents are "Blueprints," not "Copy-Paste" code. The Architect must describe the solution, not implement it.

### THE ENGINEER
- **Responsibility**: Implementing logic into the codebase.
- **Constraint**: Must follow the Architect's Phase Documents exactly. If the Blueprint is ambiguous, the Engineer must request a "Blueprint Clarification" rather than making architectural assumptions.
- 