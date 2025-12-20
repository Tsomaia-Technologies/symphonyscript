# SymphonyScript Development Map

## Current Mission
Implementing **RFC-043: Continuous Silicon Kernel**.

## Rules of Engagement
1. **Source of Truth**: All implementation must follow `/research/rfcs/043-continuous-silicon-kernel.md`.
2. **Legacy Guard**: Ignore `packages/core/src/builder/` (Legacy RFC-040). The new standard is `packages/core/src/linker/`.
3. **Workflow**:
    - Check the current Phase in `/implementation/plans/`.
    - Review pending changes in `/implementation/reviews/`.
    - Execute code changes in `/packages/`.

## Active Lifecycle Automation
- `LiveClipBuilder` handles its own finalization via the `Tombstone Pattern`.
- `Track` and `Session` builders trigger `finalize()` automatically upon `build()`.
