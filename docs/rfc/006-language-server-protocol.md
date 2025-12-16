# RFC-006: Language Server Protocol (LSP) Support

## 1. Context

While SymphonyScript benefits heavily from TypeScript's built-in type safety, standard TS tooling cannot understand musical semantics. It sees `.note('C4', '5/4')` as a valid function call, even if `5/4` breaks the measure structure or if `C4` is out of the instrument's range.

To achieve an "S-Tier" developer experience, the editor must understand the *music*, not just the *code*.

## 2. Goals

1.  **Music-Aware Diagnostics**: improved error reporting based on musical rules (e.g., "Measure 4 has 5 beats in 4/4 time").
2.  **Rich Hover Information**: Show frequency, MIDI number, or duration in seconds when hovering over note definitions.
3.  **Contextual Autocomplete**: Suggest only valid scales, instruments, or keys based on the current track configuration.
4.  **Inline Visualization**: (Ambitions) Render tiny staff previews or color swatches for notes directly in the editor gutter.

## 3. Implementation Strategy

### 3.1 Architecture

The implementation will follow the standard **LSP Architecture**:

-   **Client**: VS Code Extension (lightweight wrapper).
-   **Server**: Node.js process running `vscode-languageserver`.
-   **Shared**: The SymphonyScript compiler core (reused to parse the AST).

### 3.2 Features

#### A. Diagnostics (Validations)
The server will run a lightweight compile of the current file in the background.
-   **Rhythm Validation**: calculate total beats per measure and warn on under/overflow.
-   **Range Checks**: Warn if a bass line uses notes above `C4` or a melody uses notes below `C2`.
-   **Complexity Analysis**: Warn if a loop generates >10,000 notes (`ExpansionError` preview).

#### B. Hover Support
When hovering over:
-   `'C4'`: Show `MIDI: 60`, `Freq: 261.63Hz`.
-   `'4n'`: Show `1 Beat` or `0.5s @ 120BPM`.
-   `instrument('piano')`: Show the instrument's range and active capabilities.

#### C. Completions
-   Provide a palette of available instruments defined in the `InstrumentRegistry`.
-   Suggest scales for `.scale(...)`.

## 4. Technical Roadmap

### Phase 1: The LSP Skeleton
-   Set up `server` and `client` packages.
-   Connect simple text document synchronization.
-   Implement the first diagnostic: basic compiler error reporting in the "Problems" tab.

### Phase 2: Static Analysis
-   Implement an AST walker (using `typescript` compiler API or simple regex for MVP).
-   Extract `Measure` and `Note` data without running the full code.
-   Calculate rhythm totals.

### Phase 3: Hover & Rich Info
-   Integrate `src/util/midi.ts` and `src/util/duration.ts` into the server.
-   Implement `onHover` handlers to format this data.

## 5. Value Proposition

This transforms SymphonyScript from a "library you import" into a "language you write." It drastically reduces the feedback loop by catching musical errors before compilation or playback.
