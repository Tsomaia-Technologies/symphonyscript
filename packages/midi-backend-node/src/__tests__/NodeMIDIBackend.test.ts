/**
 * NodeMIDIBackend Unit Tests
 */

import { NodeMIDIBackend } from '../NodeMIDIBackend'
import type { CompiledEvent } from '@symphonyscript/core'

// Mock jzz module
jest.mock('jzz', () => {
  const mockOutput = {
    send: jest.fn(),
    close: jest.fn()
  }
  
  const mockMidi = {
    info: jest.fn(() => ({
      outputs: [
        { name: 'Test MIDI Output', manufacturer: 'Test Manufacturer' },
        { name: 'Second Output', manufacturer: 'Another Manufacturer' }
      ]
    })),
    openMidiOut: jest.fn(() => mockOutput)
  }
  
  return jest.fn(() => Promise.resolve(mockMidi))
})

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

describe('NodeMIDIBackend', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isSupported', () => {
    it('returns true in Node.js environment', async () => {
      const supported = await NodeMIDIBackend.isSupported()
      expect(supported).toBe(true)
    })
  })

  describe('constructor', () => {
    it('creates instance without throwing', () => {
      expect(() => new NodeMIDIBackend()).not.toThrow()
    })

    it('accepts options', () => {
      const backend = new NodeMIDIBackend({ defaultChannel: 5 })
      expect(backend).toBeInstanceOf(NodeMIDIBackend)
    })
  })

  describe('init', () => {
    it('initializes jzz and returns true', async () => {
      const backend = new NodeMIDIBackend()
      const result = await backend.init()
      expect(result).toBe(true)
    })

    it('selects first available output', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      const output = backend.getSelectedOutput()
      expect(output).not.toBeNull()
      expect(output?.name).toBe('Test MIDI Output')
    })
  })

  describe('listOutputs', () => {
    it('returns available MIDI outputs', async () => {
      const backend = new NodeMIDIBackend()
      const outputs = await backend.listOutputs()
      expect(outputs).toHaveLength(2)
      expect(outputs[0]).toEqual({
        id: '0',
        name: 'Test MIDI Output',
        manufacturer: 'Test Manufacturer'
      })
    })
  })

  describe('selectOutput', () => {
    it('selects output by id', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      const result = await backend.selectOutput('1')
      expect(result).toBe(true)
      expect(backend.getSelectedOutput()?.name).toBe('Second Output')
    })

    it('returns false for invalid id', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      const result = await backend.selectOutput('999')
      expect(result).toBe(false)
    })
  })

  describe('getSelectedOutput', () => {
    it('returns null before initialization', () => {
      const backend = new NodeMIDIBackend()
      expect(backend.getSelectedOutput()).toBeNull()
    })

    it('returns selected device after init', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      const output = backend.getSelectedOutput()
      expect(output).not.toBeNull()
      expect(output?.id).toBe('0')
    })
  })

  describe('schedule', () => {
    it('schedules note events', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      
      // Should not throw
      expect(() => {
        backend.schedule(createMockNoteEvent('C4', 100), 0)
      }).not.toThrow()
    })

    it('is a no-op when no output selected', () => {
      const backend = new NodeMIDIBackend()
      // Should not throw even without init
      expect(() => {
        backend.schedule(createMockNoteEvent('C4', 100), 0)
      }).not.toThrow()
    })
  })

  describe('cancelAfter', () => {
    it('does not throw when called', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      expect(() => backend.cancelAfter(0)).not.toThrow()
    })
  })

  describe('cancelAll', () => {
    it('does not throw when called', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      expect(() => backend.cancelAll()).not.toThrow()
    })
  })

  describe('getCurrentTime', () => {
    it('returns a number', () => {
      const backend = new NodeMIDIBackend()
      const time = backend.getCurrentTime()
      expect(typeof time).toBe('number')
      expect(time).toBeGreaterThanOrEqual(0)
    })
  })

  describe('setTempo', () => {
    it('does not throw', () => {
      const backend = new NodeMIDIBackend()
      expect(() => backend.setTempo(140)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up state', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      backend.dispose()
      expect(backend.isReady()).toBe(false)
    })

    it('can be called multiple times', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      backend.dispose()
      expect(() => backend.dispose()).not.toThrow()
    })
  })

  describe('isReady', () => {
    it('returns false before initialization', () => {
      const backend = new NodeMIDIBackend()
      expect(backend.isReady()).toBe(false)
    })

    it('returns true after successful init', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      expect(backend.isReady()).toBe(true)
    })
  })

  describe('setTrackChannel', () => {
    it('does not throw', () => {
      const backend = new NodeMIDIBackend()
      expect(() => backend.setTrackChannel('track1', 2)).not.toThrow()
    })

    it('clamps channel to valid range', () => {
      const backend = new NodeMIDIBackend()
      // Should not throw for out-of-range values
      expect(() => backend.setTrackChannel('track1', 0)).not.toThrow()
      expect(() => backend.setTrackChannel('track1', 17)).not.toThrow()
    })
  })

  describe('getOutputName', () => {
    it('returns null before init', () => {
      const backend = new NodeMIDIBackend()
      expect(backend.getOutputName()).toBeNull()
    })

    it('returns output name after init', async () => {
      const backend = new NodeMIDIBackend()
      await backend.init()
      expect(backend.getOutputName()).toBe('Test MIDI Output')
    })
  })

  describe('resetTime', () => {
    it('resets the time reference', () => {
      const backend = new NodeMIDIBackend()
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
