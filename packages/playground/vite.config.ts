import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        basic: resolve(__dirname, 'demos/basic.html'),
        live: resolve(__dirname, 'demos/live.html'),
        midi: resolve(__dirname, 'demos/midi.html')
      }
    }
  },
  server: {
    open: true
  }
})


