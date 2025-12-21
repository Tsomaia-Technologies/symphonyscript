# RFC-007: Timeline Visualizers

## 1. Context

Code is abstract. A list of 50 `.note()` calls is difficult to mentally parse into a rhythm. Users currently rely on "Compilation → Playback → Listen" to verify their composition. This loop is slow (seconds/minutes).

To achieve "S-Tier" usability, users need an **immediate** feedback loop where they can "see" the structure of their music as they type.

## 2. Goals

1.  **Immediate Feedback**: Show the rhythmic structure instantly.
2.  **Structural Verification**: Visually confirm loops, stacks, and polyphony.
3.  **accessible Debugging**: Allow debugging without audio hardware (on CI/CD or silent environments).

## 3. Levels of Visualization

### Level 1: ASCII Debugger (CLI)
**Target**: Debugging, CI/CD, Quick checks.
**Implementation**: Phase 8 (In Progress).

Renders the timeline in the terminal using text characters.

```text
Track 1 (Melody)
  [x---][x---][x---][x---]  (4/4 Pulse)
  C4....E4....G4....C5....
Track 2 (Drums)
  K...S...K...S...
```

### Level 2: Web-Based Inspector (GUI)
**Target**: The "Playground" and Local Dev Server.
**Implementation**: A React/Canvas component consuming `CompiledClip`.

-   **Piano Roll**: Standard DAW visualization. Note pitch on Y-axis, time on X-axis.
-   **Timeline View**: Blocks representing Clips, Loops, and Stacks to see high-level arrangement.
-   **Automation Lanes**: Graphical curves for volume, pan, and tempo changes.

### Level 3: Real-Time IDE Integration (The "Dream")
**Target**: VS Code Webview Panel.

Embed the Level 2 GUI directly inside VS Code.
-   **Split View**: Code on Left, Piano Roll on Right.
-   **Bi-directional**: Clicking a note in the GUI highlights the code that generated it.

## 4. Implementation Strategy

### 4.1 Data Source: `CompiledClip`
All visualizers will consume the **same** data source: the JSON output from the Compiler.
-   This decouples visualization from the DSL logic.
-   Visualizers don't need to know about "Builders" or "Cursors," only "Events."

### 4.2 The Transformation Layer
We need a `View Adapter` that transforms linear events into a 2D grid:
`Events[]` → `Grid { rows: Row[] }`

### 4.3 Phase 1 Roadmap (ASCII)
1.  Quantize time to grid slots (e.g., 16th notes).
2.  Map Pitch/Instrument ID to Rows.
3.  Render to string buffer.

### 4.4 Phase 2 Roadmap (GUI)
1.  Create a separate package `@symphonyscript/visualizer`.
2.  Implement a Canvas-based renderer for performance (DOM is too slow for thousands of notes).
3.  Implement a generic "Playground" web app that accepts code input + audio engine + visualizer.

## 5. Value Proposition

Visualizers bridge the gap between "Programmer" and "Musician." They allow the user to reason about their code spatially, catching structural errors (like a generic loop set to the wrong length) that are invisible in text but obvious in a grid.
