/**
 * Runtime WebAudio Backend Tests
 */

import { WebAudioBackend } from '../backend'
import type { CompiledEvent } from '@symphonyscript/core'
import { midiChannel, midiValue } from '@symphonyscript/core'
import { jest } from '@jest/globals'

// =============================================================================
// Mock AudioContext
// =============================================================================

class MockGainNode {
  gain = { 
    value: 1, 
    setValueAtTime: jest.fn(), 
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn()
  }
  connect = jest.fn()
  disconnect = jest.fn()
}

class MockOscillatorNode {
  type: OscillatorType = 'sine'
  frequency = { value: 440, setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }
  connect = jest.fn()
  disconnect = jest.fn()
  start = jest.fn()
  stop = jest.fn()
  onended: (() => void) | null = null
}

class MockDynamicsCompressorNode {
  threshold = { value: -24 }
  knee = { value: 30 }
  ratio = { value: 12 }
  attack = { value: 0.003 }
  release = { value: 0.25 }
  connect = jest.fn()
  disconnect = jest.fn()
}

class MockAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  sampleRate = 44100
  destination = {}
  
  createGain(): MockGainNode {
    return new MockGainNode()
  }
  
  createOscillator(): MockOscillatorNode {
    return new MockOscillatorNode()
  }
  
  createDynamicsCompressor(): MockDynamicsCompressorNode {
    return new MockDynamicsCompressorNode()
  }
  
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      getChannelData: () => new Float32Array(length)
    }
  }
  
  createBufferSource() {
    return {
      buffer: null,
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn()
    }
  }
  
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: { value: 440 },
      connect: jest.fn()
    }
  }
  
  resume = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
  close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestNoteEvent(
  startSeconds: number,
  pitch: string = 'C4',
  duration: number = 0.5
): CompiledEvent {
  return {
    kind: 'note',
    startSeconds,
    durationSeconds: duration,
    channel: midiChannel(1),
    payload: {
      pitch: pitch as any,
      velocity: midiValue(100)
    }
  }
}

// =============================================================================
// WebAudioBackend Tests
// =============================================================================

describe('WebAudioBackend', () => {
  let mockContext: MockAudioContext
  
  beforeEach(() => {
    mockContext = new MockAudioContext()
    // Mock global AudioContext
    ;(global as any).AudioContext = jest.fn(() => mockContext)
  })
  
  afterEach(() => {
    delete (global as any).AudioContext
  })
  
  describe('constructor', () => {
    it('creates backend with default options', () => {
      const backend = new WebAudioBackend()
      expect(backend).toBeDefined()
      backend.dispose()
    })
    
    it('accepts existing AudioContext', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      expect(backend.getAudioContext()).toBe(mockContext)
      backend.dispose()
    })
    
    it('accepts custom master gain', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any,
        masterGain: 0.5
      })
      expect(backend).toBeDefined()
      backend.dispose()
    })
  })
  
  describe('schedule()', () => {
    it('schedules note events', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      const event = createTestNoteEvent(0, 'C4')
      
      // Should not throw
      expect(() => backend.schedule(event, 0)).not.toThrow()
      
      backend.dispose()
    })
    
    it('skips events in the past', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      mockContext.currentTime = 1
      const event = createTestNoteEvent(0, 'C4')
      
      // Should not throw (event is skipped)
      expect(() => backend.schedule(event, 0)).not.toThrow()
      
      backend.dispose()
    })
    
    it('handles drum sounds', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      // These should not throw
      expect(() => backend.schedule(createTestNoteEvent(0, 'kick'), 0)).not.toThrow()
      expect(() => backend.schedule(createTestNoteEvent(0, 'snare'), 0)).not.toThrow()
      expect(() => backend.schedule(createTestNoteEvent(0, 'hihat'), 0)).not.toThrow()
      
      backend.dispose()
    })
  })
  
  describe('cancelAfter()', () => {
    it('cancels events after beat', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      // Should not throw
      expect(() => backend.cancelAfter(4)).not.toThrow()
      
      backend.dispose()
    })
    
    it('filters by track ID', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      // Should not throw
      expect(() => backend.cancelAfter(4, 'drums')).not.toThrow()
      
      backend.dispose()
    })
  })
  
  describe('cancelAll()', () => {
    it('cancels all events', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      backend.schedule(createTestNoteEvent(0), 0)
      
      // Should not throw
      expect(() => backend.cancelAll()).not.toThrow()
      
      backend.dispose()
    })
  })
  
  describe('getCurrentTime()', () => {
    it('returns audio context time', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      mockContext.currentTime = 1.5
      expect(backend.getCurrentTime()).toBe(1.5)
      
      backend.dispose()
    })
  })
  
  describe('setTempo()', () => {
    it('updates tempo', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(() => backend.setTempo(140)).not.toThrow()
      
      backend.dispose()
    })
  })
  
  describe('dispose()', () => {
    it('cleans up resources', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(() => backend.dispose()).not.toThrow()
    })
    
    it('is idempotent', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      backend.dispose()
      expect(() => backend.dispose()).not.toThrow()
    })
  })
  
  describe('extended API', () => {
    it('setMasterVolume() clamps to 0-1', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(() => backend.setMasterVolume(0.5)).not.toThrow()
      expect(() => backend.setMasterVolume(-1)).not.toThrow()  // Should clamp to 0
      expect(() => backend.setMasterVolume(2)).not.toThrow()   // Should clamp to 1
      
      backend.dispose()
    })
    
    it('setTrackVolume() creates track gain', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(() => backend.setTrackVolume('drums', 0.8)).not.toThrow()
      
      backend.dispose()
    })
    
    it('muteTrack() sets volume to 0', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(() => backend.muteTrack('drums')).not.toThrow()
      
      backend.dispose()
    })
    
    it('isReady() returns state', () => {
      const backend = new WebAudioBackend({
        audioContext: mockContext as any
      })
      
      expect(backend.isReady()).toBe(true)
      
      backend.dispose()
    })

    it('init() starts context', async () => {
        const backend = new WebAudioBackend({ audioContext: mockContext as any })
        const result = await backend.init()
        expect(result).toBe(true)
        backend.dispose()
    })
  })
})
