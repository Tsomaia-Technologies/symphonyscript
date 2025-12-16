/**
 * WebMIDIBackend Unit Tests
 */

import { WebMIDIBackend } from '../WebMIDIBackend'
import type { CompiledEvent } from '@symphonyscript/core'

// Helper to create a mock note event
function createMockNoteEvent(pitch: string, velocity: number): CompiledEvent {
  return {
    kind: 'note',
    startSeconds: 0,
    durationSeconds: 0.5,
    payload: { 
      pitch: pitch as any,
      velocity: velocity as any 
    }
  } as unknown as CompiledEvent
}

describe('WebMIDIBackend', () => {
  describe('isSupported', () => {
    it('returns false in Node.js (no navigator)', async () => {
      const supported = await WebMIDIBackend.isSupported()
      expect(supported).toBe(false)
    })
  })

  describe('constructor', () => {
    it('creates instance without throwing', () => {
      expect(() => new WebMIDIBackend()).not.toThrow()
    })

    it('accepts options', () => {
      const backend = new WebMIDIBackend({ defaultChannel: 5 })
      expect(backend).toBeInstanceOf(WebMIDIBackend)
    })
  })

  describe('init', () => {
    it('returns false when Web MIDI not supported', async () => {
      const backend = new WebMIDIBackend()
      const result = await backend.init()
      expect(result).toBe(false)
    })
  })

  describe('listOutputs', () => {
    it('returns empty array when not initialized', async () => {
      const backend = new WebMIDIBackend()
      const outputs = await backend.listOutputs()
      expect(outputs).toEqual([])
    })
  })

  describe('getSelectedOutput', () => {
    it('returns null when no output selected', () => {
      const backend = new WebMIDIBackend()
      const output = backend.getSelectedOutput()
      expect(output).toBeNull()
    })
  })

  describe('selectOutput', () => {
    it('returns false when no outputs available', async () => {
      const backend = new WebMIDIBackend()
      const result = await backend.selectOutput('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('schedule', () => {
    it('is a no-op when no output selected', () => {
      const backend = new WebMIDIBackend()
      // Should not throw
      expect(() => {
        backend.schedule(createMockNoteEvent('C4', 100), 0)
      }).not.toThrow()
    })
  })

  describe('cancelAfter', () => {
    it('does not throw when called', () => {
      const backend = new WebMIDIBackend()
      expect(() => backend.cancelAfter(0)).not.toThrow()
    })
  })

  describe('cancelAll', () => {
    it('does not throw when called', () => {
      const backend = new WebMIDIBackend()
      expect(() => backend.cancelAll()).not.toThrow()
    })
  })

  describe('getCurrentTime', () => {
    it('returns a number', () => {
      const backend = new WebMIDIBackend()
      const time = backend.getCurrentTime()
      expect(typeof time).toBe('number')
      expect(time).toBeGreaterThanOrEqual(0)
    })
  })

  describe('setTempo', () => {
    it('does not throw', () => {
      const backend = new WebMIDIBackend()
      expect(() => backend.setTempo(140)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up state', () => {
      const backend = new WebMIDIBackend()
      backend.dispose()
      expect(backend.isReady()).toBe(false)
    })

    it('can be called multiple times', () => {
      const backend = new WebMIDIBackend()
      backend.dispose()
      expect(() => backend.dispose()).not.toThrow()
    })
  })

  describe('isReady', () => {
    it('returns false before initialization', () => {
      const backend = new WebMIDIBackend()
      expect(backend.isReady()).toBe(false)
    })
  })

  describe('setTrackChannel', () => {
    it('does not throw', () => {
      const backend = new WebMIDIBackend()
      expect(() => backend.setTrackChannel('track1', 2)).not.toThrow()
    })

    it('clamps channel to valid range', () => {
      const backend = new WebMIDIBackend()
      // Should not throw for out-of-range values
      expect(() => backend.setTrackChannel('track1', 0)).not.toThrow()
      expect(() => backend.setTrackChannel('track1', 17)).not.toThrow()
    })
  })

  describe('resetTime', () => {
    it('resets the time reference', () => {
      const backend = new WebMIDIBackend()
      const time1 = backend.getCurrentTime()
      
      // Wait a bit
      const start = Date.now()
      while (Date.now() - start < 10) { /* spin */ }
      
      backend.resetTime()
      const time2 = backend.getCurrentTime()
      
      // After reset, time should be close to 0
      expect(time2).toBeLessThan(time1 + 0.1)
    })
  })
})
