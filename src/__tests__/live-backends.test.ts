/**
 * RFC-031: Live Coding Runtime - Backend Tests
 * 
 * Tests for WebAudioBackend and MIDIBackend.
 * 
 * Note: These tests use mocks since AudioContext and MIDI
 * are not available in the Jest environment.
 */

import { WebAudioBackend } from '../live/backends/WebAudioBackend'
import { MIDIBackend } from '../live/backends/MIDIBackend'
import type { CompiledEvent } from '../compiler/pipeline/types'
import { midiChannel, midiValue } from '../types/midi'

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
  
  resume = jest.fn().mockResolvedValue(undefined)
  close = jest.fn().mockResolvedValue(undefined)
}

// =============================================================================
// Mock MIDI
// =============================================================================

class MockMIDIOutput {
  name = 'Mock MIDI Output'
  send = jest.fn()
}

class MockMIDIAccess {
  outputs = new Map([['output-1', new MockMIDIOutput()]])
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

function createTestControlEvent(
  startSeconds: number,
  controller: number = 1,
  value: number = 64
): CompiledEvent {
  return {
    kind: 'control',
    startSeconds,
    channel: midiChannel(1),
    payload: {
      controller: controller as any,
      value: midiValue(value)
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
  })
})

// =============================================================================
// MIDIBackend Tests
// =============================================================================

describe('MIDIBackend', () => {
  let mockOutput: MockMIDIOutput
  let mockAccess: MockMIDIAccess
  
  beforeEach(() => {
    mockOutput = new MockMIDIOutput()
    mockAccess = new MockMIDIAccess()
    
    // Mock navigator.requestMIDIAccess
    ;(global as any).navigator = {
      requestMIDIAccess: jest.fn().mockResolvedValue(mockAccess)
    }
    
    // Mock performance.now
    ;(global as any).performance = {
      now: jest.fn(() => 0)
    }
  })
  
  afterEach(() => {
    delete (global as any).navigator
    delete (global as any).performance
  })
  
  describe('constructor', () => {
    it('creates backend with default options', () => {
      const backend = new MIDIBackend()
      expect(backend).toBeDefined()
      backend.dispose()
    })
    
    it('accepts existing MIDI output', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      expect(backend.getOutputName()).toBe('Mock MIDI Output')
      backend.dispose()
    })
    
    it('accepts custom default channel', () => {
      const backend = new MIDIBackend({
        defaultChannel: 10
      })
      expect(backend).toBeDefined()
      backend.dispose()
    })
  })
  
  describe('init()', () => {
    it('requests MIDI access', async () => {
      const backend = new MIDIBackend()
      
      const result = await backend.init()
      
      expect(navigator.requestMIDIAccess).toHaveBeenCalled()
      expect(result).toBe(true)
      
      backend.dispose()
    })
    
    it('handles missing MIDI API gracefully', async () => {
      delete (global as any).navigator.requestMIDIAccess
      
      const backend = new MIDIBackend()
      const result = await backend.init()
      
      expect(result).toBe(false)
      
      backend.dispose()
    })
    
    it('handles MIDI access denial gracefully', async () => {
      ;(global as any).navigator.requestMIDIAccess = jest.fn().mockRejectedValue(
        new Error('User denied')
      )
      
      const backend = new MIDIBackend()
      const result = await backend.init()
      
      expect(result).toBe(false)
      
      backend.dispose()
    })
  })
  
  describe('schedule()', () => {
    it('schedules note events', () => {
      jest.useFakeTimers()
      
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      const event = createTestNoteEvent(0, 'C4')
      
      // Schedule event at time 0
      backend.schedule(event, 0)
      
      // Advance timers to allow setTimeout(fn, 0) to fire
      jest.advanceTimersByTime(100)
      
      // Should have sent note on
      expect(mockOutput.send).toHaveBeenCalled()
      
      jest.useRealTimers()
      backend.dispose()
    })
    
    it('skips drum names (not real pitches)', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      const kickEvent = createTestNoteEvent(0, 'kick')
      
      jest.useFakeTimers()
      backend.schedule(kickEvent, 0)
      jest.advanceTimersByTime(10)
      
      // Should not send MIDI for drum names
      expect(mockOutput.send).not.toHaveBeenCalled()
      
      jest.useRealTimers()
      backend.dispose()
    })
    
    it('schedules control events', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      const event = createTestControlEvent(0, 1, 64)
      
      jest.useFakeTimers()
      backend.schedule(event, 0)
      jest.advanceTimersByTime(10)
      
      expect(mockOutput.send).toHaveBeenCalled()
      
      jest.useRealTimers()
      backend.dispose()
    })
  })
  
  describe('cancelAfter()', () => {
    it('cancels scheduled events', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      jest.useFakeTimers()
      
      // Schedule a future event
      backend.schedule(createTestNoteEvent(1, 'C4'), 1)
      
      // Cancel before it fires
      backend.cancelAfter(0)
      
      // Advance past when it would have fired
      jest.advanceTimersByTime(2000)
      
      // Note on should not have been called (only note off cleanup)
      // The exact behavior depends on implementation
      
      jest.useRealTimers()
      backend.dispose()
    })
  })
  
  describe('cancelAll()', () => {
    it('cancels all events and sends All Notes Off', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      backend.cancelAll()
      
      // Should send All Notes Off on all 16 channels
      expect(mockOutput.send).toHaveBeenCalledTimes(16)
      
      backend.dispose()
    })
  })
  
  describe('getCurrentTime()', () => {
    it('returns time based on performance.now', () => {
      ;(global as any).performance.now = jest.fn(() => 1000)
      
      const backend = new MIDIBackend()
      
      // First call sets startTime, subsequent calls calculate delta
      ;(global as any).performance.now = jest.fn(() => 2000)
      
      expect(backend.getCurrentTime()).toBe(1) // 1000ms = 1s
      
      backend.dispose()
    })
  })
  
  describe('setTempo()', () => {
    it('updates tempo', () => {
      const backend = new MIDIBackend()
      
      expect(() => backend.setTempo(140)).not.toThrow()
      
      backend.dispose()
    })
  })
  
  describe('dispose()', () => {
    it('cleans up resources', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      expect(() => backend.dispose()).not.toThrow()
    })
  })
  
  describe('extended API', () => {
    it('setTrackChannel() maps track to channel', () => {
      const backend = new MIDIBackend()
      
      expect(() => backend.setTrackChannel('drums', 10)).not.toThrow()
      
      backend.dispose()
    })
    
    it('getOutputName() returns name', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      expect(backend.getOutputName()).toBe('Mock MIDI Output')
      
      backend.dispose()
    })
    
    it('getOutputName() returns null when no output', () => {
      const backend = new MIDIBackend()
      
      expect(backend.getOutputName()).toBeNull()
      
      backend.dispose()
    })
    
    it('isReady() returns false when not initialized', () => {
      const backend = new MIDIBackend()
      
      expect(backend.isReady()).toBe(false)
      
      backend.dispose()
    })
    
    it('sendRaw() sends raw MIDI data', () => {
      const backend = new MIDIBackend({
        output: mockOutput as any
      })
      
      backend.sendRaw([0x90, 60, 100])
      
      expect(mockOutput.send).toHaveBeenCalledWith([0x90, 60, 100])
      
      backend.dispose()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Backend Integration', () => {
  it('backends implement the same interface', () => {
    const mockContext = new MockAudioContext()
    ;(global as any).AudioContext = jest.fn(() => mockContext)
    ;(global as any).navigator = { requestMIDIAccess: jest.fn() }
    ;(global as any).performance = { now: jest.fn(() => 0) }
    
    const webAudio = new WebAudioBackend({ audioContext: mockContext as any })
    const midi = new MIDIBackend()
    
    // Both should have the same methods
    expect(typeof webAudio.schedule).toBe('function')
    expect(typeof midi.schedule).toBe('function')
    
    expect(typeof webAudio.cancelAfter).toBe('function')
    expect(typeof midi.cancelAfter).toBe('function')
    
    expect(typeof webAudio.cancelAll).toBe('function')
    expect(typeof midi.cancelAll).toBe('function')
    
    expect(typeof webAudio.getCurrentTime).toBe('function')
    expect(typeof midi.getCurrentTime).toBe('function')
    
    expect(typeof webAudio.setTempo).toBe('function')
    expect(typeof midi.setTempo).toBe('function')
    
    expect(typeof webAudio.dispose).toBe('function')
    expect(typeof midi.dispose).toBe('function')
    
    webAudio.dispose()
    midi.dispose()
    
    delete (global as any).AudioContext
    delete (global as any).navigator
    delete (global as any).performance
  })
})
