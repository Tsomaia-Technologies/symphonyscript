/**
 * RFC-031: Live Coding Runtime - LiveSession Tests
 * 
 * Tests for the main LiveSession controller.
 */

import { LiveSession } from '../live/LiveSession'
import type { SessionNode, TrackNode } from '@symphonyscript/core'
import type { ClipNode } from '@symphonyscript/core'
import { SCHEMA_VERSION } from '@symphonyscript/core'

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
// Test Fixtures
// =============================================================================

function createTestClip(): ClipNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'clip',
    name: 'test-clip',
    operations: [
      { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 0.8 },
      { kind: 'note', note: 'E4' as any, duration: '4n', velocity: 0.8 },
      { kind: 'note', note: 'G4' as any, duration: '4n', velocity: 0.8 },
      { kind: 'rest', duration: '4n' }
    ]
  }
}

function createTestInstrument(): any {
  return {
    name: 'test-synth',
    config: {
      type: 'synth',
      midiChannel: 1
    }
  }
}

function createTestTrack(name: string): TrackNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'track',
    name,
    clip: createTestClip(),
    instrument: createTestInstrument()
  }
}

function createTestSession(): SessionNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'session',
    tracks: [
      createTestTrack('lead'),
      createTestTrack('bass')
    ],
    tempo: 120,
    timeSignature: '4/4'
  }
}

// =============================================================================
// Setup
// =============================================================================

let mockContext: MockAudioContext

beforeEach(() => {
  mockContext = new MockAudioContext()
  ;(global as any).AudioContext = jest.fn(() => mockContext)
  ;(global as any).navigator = {
    requestMIDIAccess: jest.fn().mockResolvedValue({
      outputs: new Map()
    })
  }
  ;(global as any).performance = {
    now: jest.fn(() => 0)
  }
  ;(global as any).crypto = {
    randomUUID: jest.fn(() => 'test-uuid-' + Math.random())
  }
})

afterEach(() => {
  delete (global as any).AudioContext
  delete (global as any).navigator
  delete (global as any).performance
  delete (global as any).crypto
  jest.clearAllTimers()
})

// =============================================================================
// Constructor Tests
// =============================================================================

describe('LiveSession', () => {
  describe('constructor', () => {
    it('creates session with default options', () => {
      const session = new LiveSession({ bpm: 120 })
      expect(session).toBeDefined()
      expect(session.getTempo()).toBe(120)
    })
    
    it('accepts custom options', () => {
      const session = new LiveSession({
        bpm: 140,
        quantize: 'beat',
        timeSignature: '3/4',
        lookahead: 0.2
      })
      expect(session.getTempo()).toBe(140)
      expect(session.getQuantize()).toBe('beat')
    })
    
    it('defaults to bar quantize', () => {
      const session = new LiveSession({ bpm: 120 })
      expect(session.getQuantize()).toBe('bar')
    })
  })
  
  describe('init()', () => {
    it('initializes WebAudio backend by default', async () => {
      const session = new LiveSession({ bpm: 120 })
      await session.init()
      
      expect(session.isReady()).toBe(true)
      
      session.dispose()
    })
    
    it('initializes MIDI backend when requested', async () => {
      const session = new LiveSession({ bpm: 120, backend: 'midi' })
      await session.init()
      
      expect(session.isReady()).toBe(true)
      
      session.dispose()
    })
    
    it('initializes both backends when requested', async () => {
      const session = new LiveSession({ bpm: 120, backend: 'both' })
      await session.init()
      
      expect(session.isReady()).toBe(true)
      
      session.dispose()
    })
    
    it('is idempotent', async () => {
      const session = new LiveSession({ bpm: 120 })
      await session.init()
      await session.init() // Should not throw
      
      expect(session.isReady()).toBe(true)
      
      session.dispose()
    })
  })
  
  describe('playback control', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('play() starts playback', () => {
      session.play()
      expect(session.isPlaying()).toBe(true)
    })
    
    it('pause() pauses playback', () => {
      session.play()
      session.pause()
      expect(session.isPlaying()).toBe(false)
    })
    
    it('resume() resumes playback', () => {
      session.play()
      session.pause()
      session.resume()
      expect(session.isPlaying()).toBe(true)
    })
    
    it('stop() stops playback', () => {
      session.play()
      session.stop()
      expect(session.isPlaying()).toBe(false)
    })
    
    it('throws if play() called before init()', () => {
      const uninitSession = new LiveSession({ bpm: 120 })
      expect(() => uninitSession.play()).toThrow('not initialized')
    })
  })
  
  describe('tempo management', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('getTempo() returns current tempo', () => {
      expect(session.getTempo()).toBe(120)
    })
    
    it('setTempo() updates tempo', () => {
      session.setTempo(140)
      expect(session.getTempo()).toBe(140)
    })
  })
  
  describe('quantize management', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('getQuantize() returns current mode', () => {
      expect(session.getQuantize()).toBe('bar')
    })
    
    it('setQuantize() changes mode', () => {
      session.setQuantize('beat')
      expect(session.getQuantize()).toBe('beat')
      
      session.setQuantize('off')
      expect(session.getQuantize()).toBe('off')
    })
  })
  
  describe('session loading', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('load() accepts SessionNode', () => {
      const sessionNode = createTestSession()
      
      expect(() => session.load(sessionNode)).not.toThrow()
      expect(session.getSession()).toBe(sessionNode)
    })
    
    it('load() updates tempo from session', () => {
      const sessionNode = createTestSession()
      sessionNode.tempo = 140
      
      session.load(sessionNode)
      
      expect(session.getTempo()).toBe(140)
    })
    
    it('load() accepts builder with build() method', () => {
      const sessionNode = createTestSession()
      const builder = {
        build: () => sessionNode
      }
      
      expect(() => session.load(builder)).not.toThrow()
      expect(session.getSession()).toEqual(sessionNode)
    })
  })
  
  describe('event handling', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      jest.useFakeTimers()
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
      jest.useRealTimers()
    })
    
    it('on("beat") subscribes to beat events', () => {
      const handler = jest.fn()
      session.on('beat', handler)
      
      // Start playback and advance time
      session.play()
      mockContext.currentTime = 0.5 // 1 beat at 120 BPM
      jest.advanceTimersByTime(50)
      
      // Handler should be called
      expect(handler).toHaveBeenCalled()
    })
    
    it('on("bar") subscribes to bar events', () => {
      const handler = jest.fn()
      session.on('bar', handler)
      
      session.play()
      mockContext.currentTime = 2 // 4 beats = 1 bar at 120 BPM in 4/4
      jest.advanceTimersByTime(50)
      
      expect(handler).toHaveBeenCalled()
    })
    
    it('on("error") subscribes to error events', () => {
      const handler = jest.fn()
      session.on('error', handler)
      
      // Trigger an error by calling eval with forbidden code
      session.eval('process.exit()')
      
      expect(handler).toHaveBeenCalled()
    })
    
    it('on() returns unsubscribe function', () => {
      const handler = jest.fn()
      const unsubscribe = session.on('beat', handler)
      
      session.play()
      mockContext.currentTime = 0.5
      jest.advanceTimersByTime(50)
      
      const callsBefore = handler.mock.calls.length
      
      unsubscribe()
      
      mockContext.currentTime = 1
      jest.advanceTimersByTime(50)
      
      // Should not have more calls after unsubscribe
      expect(handler.mock.calls.length).toBe(callsBefore)
    })
    
    it('off() removes all handlers for event type', () => {
      const handler1 = jest.fn()
      const handler2 = jest.fn()
      
      session.on('beat', handler1)
      session.on('beat', handler2)
      
      session.off('beat')
      
      session.play()
      mockContext.currentTime = 0.5
      jest.advanceTimersByTime(50)
      
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })
  })
  
  describe('position tracking', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('getCurrentBeat() returns 0 before play', () => {
      expect(session.getCurrentBeat()).toBe(0)
    })
    
    it('getCurrentBeat() returns current beat position', () => {
      session.play()
      mockContext.currentTime = 0.5 // 1 beat at 120 BPM
      
      expect(session.getCurrentBeat()).toBeCloseTo(1, 1)
    })
    
    it('getCurrentBar() returns current bar number', () => {
      session.play()
      mockContext.currentTime = 2 // 4 beats = 1 bar
      
      expect(session.getCurrentBar()).toBe(1)
    })
  })
  
  describe('eval()', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('returns success for valid code', () => {
      const result = session.eval('const x = 1')
      
      expect(result.success).toBe(true)
    })
    
    it('returns error for forbidden code', () => {
      const result = session.eval('process.exit()')
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
    
    it('creates tracks from track() helper', () => {
      session.play()
      
      const result = session.eval(`
        track('drums', t => t.clip(Clip.drums('drums').kick('4n').build()))
      `)
      
      expect(result.success).toBe(true)
    })
  })
  
  describe('dispose()', () => {
    it('cleans up resources', async () => {
      const session = new LiveSession({ bpm: 120 })
      await session.init()
      session.play()
      
      session.dispose()
      
      expect(session.isReady()).toBe(false)
    })
    
    it('is idempotent', async () => {
      const session = new LiveSession({ bpm: 120 })
      await session.init()
      
      session.dispose()
      expect(() => session.dispose()).not.toThrow()
    })
    
    it('throws if play() called after dispose', async () => {
      const session = new LiveSession({ bpm: 120 })
      await session.init()
      session.dispose()
      
      expect(() => session.play()).toThrow('disposed')
    })
  })
  
  describe('track management', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120 })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('muteTrack() mutes a track', () => {
      session.load(createTestSession())
      
      expect(() => session.muteTrack('lead')).not.toThrow()
    })
    
    it('unmuteTrack() unmutes a track', () => {
      session.load(createTestSession())
      session.muteTrack('lead')
      
      expect(() => session.unmuteTrack('lead')).not.toThrow()
    })
    
    it('stop(trackName) stops specific track', () => {
      session.load(createTestSession())
      session.play()
      
      expect(() => session.stop('lead')).not.toThrow()
      expect(session.isPlaying()).toBe(true) // Session still playing
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('LiveSession Integration', () => {
  it('full playback workflow', async () => {
    const session = new LiveSession({ bpm: 120, quantize: 'bar' })
    await session.init()
    
    // Load session
    session.load(createTestSession())
    
    // Subscribe to events
    const beatHandler = jest.fn()
    const barHandler = jest.fn()
    session.on('beat', beatHandler)
    session.on('bar', barHandler)
    
    // Start playback
    session.play()
    expect(session.isPlaying()).toBe(true)
    
    // Change tempo
    session.setTempo(140)
    expect(session.getTempo()).toBe(140)
    
    // Change quantize
    session.setQuantize('beat')
    expect(session.getQuantize()).toBe('beat')
    
    // Stop
    session.stop()
    expect(session.isPlaying()).toBe(false)
    
    // Clean up
    session.dispose()
  })
})
