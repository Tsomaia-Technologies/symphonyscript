# RFC-011 v3: Monorepo Migration & Package Structure

## Summary

Restructure SymphonyScript into a production-grade Nx monorepo with clearly separated packages. This enables universal builds, tree-shaking, and independent versioning.

---

## Decisions Log

| #   | Topic                   | Decision                                                                    |
| --- | ----------------------- | --------------------------------------------------------------------------- |
| 1   | Watchers                | `EventWatcher` in live (universal), `FileWatcher` in `@symphonyscript/node` |
| 2   | RuntimeBackend          | Interface defined in `core`                                                 |
| 3   | Package assembly        | User imports and wires packages explicitly                                  |
| 4   | Import/Export API       | Buffer-only (universal), no file system access in core                      |
| 5   | Testing                 | Unit tests move with packages, integration tests in leaf packages           |
| 6   | Build outputs           | ESM + CJS + UMD + TypeScript declarations                                   |
| 7   | Versioning              | Independent (Changesets)                                                    |
| 8   | Orchestration           | Nx                                                                          |
| 9   | npm scope               | `@symphonyscript/*` (claimed ✓)                                             |
| 10  | Core dependency         | Regular dependency (bundled with each package)                              |
| 11  | TypeScript              | Root `tsconfig.base.json` with extends                                      |
| 12  | UMD global              | Single `SymphonyScript` global, packages extend it                          |
| 13  | Node.js version         | 18+                                                                         |
| 14  | Browser support         | Chrome 80+, Firefox 78+, Safari 13+ (for WASM/Csound compat)                |
| 15  | Eval context            | Injected by user (flexibility)                                              |
| 16  | Compiler in LiveSession | Dependency injection                                                        |

---

## Package Structure

### Tier 1: Core (Universal)

| Package                | Description                                                                 | Platform  | UMD Global       |
| ---------------------- | --------------------------------------------------------------------------- | --------- | ---------------- |
| `@symphonyscript/core` | DSL, Compiler, Types, Import/Export (buffer-only), RuntimeBackend interface | Universal | `SymphonyScript` |

**Contents:**

- `clip/`, `chords/`, `compiler/`, `effects/`, `theory/`, `scales/`
- `session/`, `instrument/`, `groove/`, `types/`, `schema/`, `util/`
- `import/` (buffer input only — no fs)
- `export/` (buffer output)
- `codegen/`
- `RuntimeBackend` interface

---

### Tier 2: Runtimes (Platform-specific)

| Package                                 | Description              | Platform     | UMD Global                       |
| --------------------------------------- | ------------------------ | ------------ | -------------------------------- |
| `@symphonyscript/runtime-webaudio`      | WebAudio playback engine | Browser      | `SymphonyScript.WebAudioRuntime` |
| `@symphonyscript/runtime-csound`        | Csound WASM backend      | Browser/Node | (Future)                         |
| `@symphonyscript/runtime-supercollider` | SuperCollider backend    | Node         | (Future)                         |

**All runtimes implement `RuntimeBackend` interface from core.**

---

### Tier 3: Live Coding (Universal)

| Package                | Description                                                   | Platform  | UMD Global            |
| ---------------------- | ------------------------------------------------------------- | --------- | --------------------- |
| `@symphonyscript/live` | LiveSession, StreamingScheduler, EventWatcher, eval, quantize | Universal | `SymphonyScript.Live` |

**Features:**

- `LiveSession` — main controller (accepts runtime via DI)
- `StreamingScheduler` — event scheduling
- `EventWatcher` — generic watcher interface (user wires to source)
- `eval.ts` — safe evaluation (context injected by user)
- `quantize.ts` — beat-grid utilities

---

### Tier 4: Node.js Utilities

| Package                | Description                            | Platform | UMD |
| ---------------------- | -------------------------------------- | -------- | --- |
| `@symphonyscript/node` | FileWatcher (chokidar), file utilities | Node.js  | N/A |

---

### Tier 5: MIDI Backends

| Package                             | Description    | Platform | UMD Global                      |
| ----------------------------------- | -------------- | -------- | ------------------------------- |
| `@symphonyscript/midi-backend-web`  | Web MIDI API   | Browser  | `SymphonyScript.MIDIBackendWeb` |
| `@symphonyscript/midi-backend-node` | jzz-based MIDI | Node.js  | N/A                             |

---

### Tier 6: Synthesis & Analysis (Future)

| Package                     | Description                         | Platform  |
| --------------------------- | ----------------------------------- | --------- |
| `@symphonyscript/synthesis` | Waveform generation, audio analysis | Universal |

---

### Tier 7: Renderers (Future)

| Package                             | Description              | Platform  |
| ----------------------------------- | ------------------------ | --------- |
| `@symphonyscript/renderer-terminal` | ASCII piano roll         | Node.js   |
| `@symphonyscript/renderer-svg`      | SVG string output        | Universal |
| `@symphonyscript/renderer-canvas`   | DOM/Canvas visualization | Browser   |

---

### Tier 8: CLI (Future)

| Package               | Description                  | Platform |
| --------------------- | ---------------------------- | -------- |
| `@symphonyscript/cli` | `symphony` command-line tool | Node.js  |

---

### Tier 9: Playground

| Package                      | Description             | Platform |
| ---------------------------- | ----------------------- | -------- |
| `@symphonyscript/playground` | Samples, demos, teasers | Browser  |

---

## UMD Usage (CDN)

```html
<script src="https://unpkg.com/@symphonyscript/core"></script>
<script src="https://unpkg.com/@symphonyscript/runtime-webaudio"></script>
<script src="https://unpkg.com/@symphonyscript/live"></script>
<script>
  const { Clip, Session, WebAudioRuntime, LiveSession } = SymphonyScript;

  const runtime = new WebAudioRuntime();
  const live = new LiveSession({ runtime });
</script>
```

---

## Directory Structure

```
/
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── clip/
│   │       ├── chords/
│   │       ├── compiler/
│   │       ├── effects/
│   │       ├── export/
│   │       ├── groove/
│   │       ├── import/
│   │       ├── instrument/
│   │       ├── runtime/         # RuntimeBackend interface only
│   │       ├── scales/
│   │       ├── schema/
│   │       ├── session/
│   │       ├── theory/
│   │       ├── types/
│   │       └── util/
│   │
│   ├── runtime-webaudio/
│   │   ├── package.json
│   │   └── src/
│   │       ├── context.ts
│   │       ├── engine.ts
│   │       ├── scheduler.ts
│   │       ├── synth.ts
│   │       └── transport.ts
│   │
│   ├── live/
│   │   ├── package.json
│   │   └── src/
│   │       ├── LiveSession.ts
│   │       ├── StreamingScheduler.ts
│   │       ├── EventWatcher.ts
│   │       ├── eval.ts
│   │       ├── quantize.ts
│   │       └── types.ts
│   │
│   ├── node/
│   │   ├── package.json
│   │   └── src/
│   │       └── FileWatcher.ts
│   │
│   ├── midi-backend-web/
│   ├── midi-backend-node/
│   ├── synthesis/           # Future
│   ├── renderer-terminal/   # Future
│   ├── renderer-svg/        # Future
│   ├── renderer-canvas/     # Future
│   ├── cli/                 # Future
│   └── playground/
│
├── nx.json
├── package.json             # Workspace root
├── tsconfig.base.json
└── .changeset/
```

---

## Build Configuration

### Package.json (each package)

```json
{
  "name": "@symphonyscript/core",
  "version": "0.1.0",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "browser": "./dist/index.umd.js",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

### UMD Build (esbuild)

```bash
esbuild src/index.ts \
  --bundle \
  --format=iife \
  --global-name=SymphonyScript \
  --outfile=dist/index.umd.js
```

Sub-packages extend the global:

```bash
esbuild src/index.ts \
  --bundle \
  --format=iife \
  --global-name=SymphonyScript.WebAudioRuntime \
  --external:@symphonyscript/core \
  --outfile=dist/index.umd.js
```

---

## Migration Phases

### Phase 1: Infrastructure

- Initialize Nx workspace
- Configure `tsconfig.base.json`
- Set up Changesets
- Configure esbuild for ESM/CJS/UMD

### Phase 2: Extract Core

- Move universal code to `packages/core`
- Refactor `import/` to buffer-only (remove fs)
- Define `RuntimeBackend` interface
- Unit tests move with code

### Phase 3: Extract Runtime-WebAudio

- Move `runtime/` to `packages/runtime-webaudio`
- Implement `RuntimeBackend` interface
- Create UMD build extending `SymphonyScript`

### Phase 4: Extract Live

- Move `live/` to `packages/live`
- Refactor `LiveSession` for dependency injection
- Create `EventWatcher` (generic)
- Remove `FileWatcher` (goes to node package)

### Phase 5: Extract Node

- Create `packages/node`
- Move `FileWatcher` with chokidar dependency
- Node.js 18+ only

### Phase 6: Extract MIDI Backends

- `packages/midi-backend-web`
- `packages/midi-backend-node`

### Phase 7: Playground

- `packages/playground`
- Demos, samples, teasers

### Phase 8: Future Packages

- synthesis, renderers, CLI (as needed)

---

## Verification

Each phase:

1. `npx nx run-many --target=build` — All packages build
2. `npx nx run-many --target=test` — All tests pass
3. UMD loaded in browser — Manual check

Final:

- `<script>` tag loads core from CDN
- Node.js imports work
- Playground demos functional

---

## Requirements Summary

| Requirement   | Specification                       |
| ------------- | ----------------------------------- |
| Node.js       | 18+                                 |
| Browsers      | Chrome 80+, Firefox 78+, Safari 13+ |
| Build outputs | ESM, CJS, UMD, .d.ts                |
| Versioning    | Independent (Changesets)            |
| Orchestration | Nx                                  |
| npm scope     | `@symphonyscript/*`                 |
| UMD global    | `SymphonyScript` (single, extended) |
