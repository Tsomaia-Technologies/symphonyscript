# @symphonyscript/playground

Interactive demos and examples for SymphonyScript.

## Demos

- **Basic Playback** (`demos/basic.html`) — Session/Track/Clip API with WebAudio
- **Live Coding** (`demos/live.html`) — Real-time code evaluation with LiveSession
- **MIDI Output** (`demos/midi.html`) — Web MIDI API integration

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Requirements

- Modern browser (Chrome/Firefox/Safari)
- For MIDI demo: Chrome/Edge/Opera + MIDI device or virtual MIDI driver

## Package Dependencies

This playground uses:
- `@symphonyscript/core` — DSL and compiler
- `@symphonyscript/live` — Live coding runtime
- `@symphonyscript/runtime-webaudio` — WebAudio playback
- `@symphonyscript/midi-backend-web` — Web MIDI output

## Notes

This package is marked `"private": true` and is not published to npm.
It exists only for development and demonstration purposes.
