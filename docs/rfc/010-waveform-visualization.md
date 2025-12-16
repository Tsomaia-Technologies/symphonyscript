# RFC-008: Waveform Visualization System

## 1. Context

To visualize composition dynamics without slow audio rendering, we introduce a lightweight visualization pipeline.

## 2. Architecture

### 2.1 Core Types

```typescript
export interface WaveformSynthesizer {
  synthesize(events: CompiledEvent[], options: { resolution: number }): WaveformData
}

export interface WaveformRenderer<TOutput> {
  render(waveform: WaveformData): TOutput
}

export interface VisualizeOptions<TRenderer extends WaveformRenderer<any>> {
  synthesizer?: WaveformSynthesizer
  renderer: TRenderer
  resolution?: number
  window?: { start: number; end: number }
}

export interface WaveformData {
  samples: Float32Array
  sampleRate: number
  duration: number
  channels: 1 | 2
}
```

### 2.2 Main Entry Point

```typescript
export function visualize<T>(
  events: CompiledEvent[],
  options: VisualizeOptions<WaveformRenderer<T>>
): T {
  // 1. Calculate Duration (Max end time of events)
  const duration = Math.max(...events.map(e => e.startSeconds + (e.durationSeconds ?? 0)), 1)

  // 2. Synthesize & Defaulting
  const synth = options.synthesizer ?? new ApproximatedSynthesizer()
  
  // Default Resolution: Adaptive (100 * duration), Min 1000, Max 10000
  const defaultRes = Math.min(10000, Math.max(1000, Math.ceil(duration * 100)))
  
  const waveform = synth.synthesize(events, { 
    resolution: options.resolution ?? defaultRes 
  })

  // 3. Render
  return options.renderer.render(waveform)
}
```

## 3. The Synthesizers

Users can choose speed (Approximation) or accuracy (Real DSP).

### 3.1 ApproximatedSynthesizer (Default)
Generates **Envelopes** instead of audio.
-   **Model**: Sum of ADSR envelopes + **Soft Clipping** (`tanh`) to prevent digital limiting.
-   **Speed**: Ultralight (~1ms).
-   **Resolution**: Adaptive default ensures visual density matches clip length.

### 3.2 WebAudioSynthesizer (Future Scope)
Render the clip using the actual Web Audio API (OfflineAudioContext).
-   **Use Case**: Generating bit-perfect waveforms for export.

## 4. The Renderers

To support the Monorepo architecture (RFC-009), renderers are distributed as separate packages. The core package defines the *Interface*, but specific implementations live outside to prevent dependency bloat.

### 4.1 Official Renderers (Separate Packages)
-   **`@symphonyscript/renderer-terminal`**: ASCII output.
-   **`@symphonyscript/renderer-svg`**: SVG string output.
-   **`@symphonyscript/renderer-canvas`**: DOM/Canvas output.

## 5. Implementation Roadmap

### Phase 1: Core Definitions
-   Define `WaveformSynthesizer`, `WaveformRenderer`, `WaveformData` interfaces.
-   Implement `visualize()` entry point.

### Phase 2: Synthesis Engine
-   Implement `ApproximatedSynthesizer`.
-   Implement ADSR math.

### Phase 3: Renderers
-   Implement `packages/renderer-terminal`.
-   Implement `packages/renderer-svg`.
