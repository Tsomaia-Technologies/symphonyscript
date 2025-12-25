import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tsconfigPaths from 'vite-tsconfig-paths';
import customTsConfig from 'vite-plugin-custom-tsconfig';

export default defineConfig({
  plugins: [
    wasm(), // Handles .wasm files nicely
    topLevelAwait(), // Critical for Wasm modules that use 'await' on startup
    tsconfigPaths(),
  ],
  server: {
    headers: {
      // ⚡ REQUIRED for SharedArrayBuffer / Atomics work
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    plugins: () => [
      wasm(),
      topLevelAwait()
    ]
  }
});
