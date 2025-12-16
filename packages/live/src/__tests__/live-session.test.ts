/**
 * RFC-031: Live Coding Runtime - LiveSession Tests
 * 
 * Tests for the main LiveSession controller.
 */

import { LiveSession } from '../LiveSession'
import type { LiveSessionOptions } from '../types'
import { StreamingScheduler } from '../StreamingScheduler'
import { SCHEMA_VERSION } from '@symphonyscript/core'
import type { RuntimeBackend, CompiledEvent } from '@symphonyscript/core'

console.warn = jest.fn()

// =============================================================================
// Mock RuntimeBackend
// =============================================================================

class MockBackend implements RuntimeBackend {
  scheduledEvents: Array<{ event: CompiledEvent; time: number }> = []
  cancelledAfter: Array<{ beat: number; trackId?: string }> = []
  currentTime = 0
  disposed = false
  initialized = false
  bpm = 120

  async init(): Promise<boolean> {
    this.initialized = true
    return true
  }

  schedule(event: CompiledEvent, audioTime: number): void {
    this.scheduledEvents.push({ event, time: audioTime })
  }

  cancelAfter(beat: number, trackId?: string): void {
    this.cancelledAfter.push({ beat, trackId })
  }

  cancelAll(): void {
    this.scheduledEvents = []
  }

  getCurrentTime(): number {
    return this.currentTime
  }

  setTempo(bpm: number): void {
    this.bpm = bpm
  }

  dispose(): void {
    this.disposed = true
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

// Mock imports from core types (since they are just interfaces/types here)
// Real objects come from @symphonyscript/core if built, but we construct simple objects.

function createTestClip(): any {
  return {
    _version: SCHEMA_VERSION,
    kind: 'clip',
    name: 'test-clip',
    operations: [
      { kind: 'note', note: 'C4', duration: '4n', velocity: 0.8 },
      { kind: 'note', note: 'E4', duration: '4n', velocity: 0.8 },
      { kind: 'note', note: 'G4', duration: '4n', velocity: 0.8 },
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

function createTestTrack(name: string): any {
  return {
    _version: SCHEMA_VERSION,
    kind: 'track',
    name,
    clip: createTestClip(),
    instrument: createTestInstrument()
  }
}

function createTestSession(): any {
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

beforeEach(() => {
  jest.useFakeTimers()
  ;(global as any).performance = {
    now: jest.fn(() => 0)
  }
  ;(global as any).crypto = {
    randomUUID: jest.fn(() => 'test-uuid-' + Math.random())
  }
})

afterEach(() => {
  delete (global as any).performance
  delete (global as any).crypto
  jest.clearAllTimers()
  jest.useRealTimers()
})

// =============================================================================
// Constructor Tests
// =============================================================================

describe('LiveSession', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend()
  })

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
    it('initializes injected runtime', async () => {
      const session = new LiveSession({ bpm: 120, runtime: backend })
      await session.init()
      
      expect(session.isReady()).toBe(true)
      expect(backend.initialized).toBe(true)
      
      session.dispose()
    })
    
    it('throws if no runtime provided', async () => {
      const session = new LiveSession({ bpm: 120 }) // No runtime
      
      await expect(session.init()).rejects.toThrow('No runtime backend provided')
    })
    
    it('is idempotent', async () => {
      const session = new LiveSession({ bpm: 120, runtime: backend })
      await session.init()
      await session.init() // Should not throw
      
      expect(session.isReady()).toBe(true)
      
      session.dispose()
    })
  })
  
  describe('playback control', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120, runtime: backend })
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
      session = new LiveSession({ bpm: 120, runtime: backend })
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
      expect(backend.bpm).toBe(140)
    })
  })
  
  describe('quantize management', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120, runtime: backend })
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
      session = new LiveSession({ bpm: 120, runtime: backend })
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
      
      expect(() => session.load(builder as any)).not.toThrow()
      expect(session.getSession()).toEqual(sessionNode)
    })
  })
  
  describe('event handling', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120, runtime: backend })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('on("beat") subscribes to beat events', () => {
      const handler = jest.fn()
      session.on('beat', handler)
      
      session.play()
      // Advance mocked time
      backend.currentTime = 0.5 // 1 beat at 120 BPM
      jest.advanceTimersByTime(50)
      
      // Since live session relies on scheduler or raf/timeout loops that might use performance.now()
      // or backend.getCurrentTime()
      
      expect(handler).toHaveBeenCalled()
    })
    
    it('on("bar") subscribes to bar events', () => {
      const handler = jest.fn()
      session.on('bar', handler)
      
      session.play()
      backend.currentTime = 2 // 4 beats
      jest.advanceTimersByTime(50)
      
      expect(handler).toHaveBeenCalled()
    })
  })
  
  describe('position tracking', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120, runtime: backend })
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
      backend.currentTime = 0.5
      
      expect(session.getCurrentBeat()).toBeCloseTo(1, 1)
    })
    
    it('getCurrentBar() returns current bar number', () => {
      session.play()
      backend.currentTime = 2
      
      expect(session.getCurrentBar()).toBe(1)
    })
  })
  
  describe('eval()', () => {
    let session: LiveSession
    
    beforeEach(async () => {
      session = new LiveSession({ bpm: 120, runtime: backend })
      await session.init()
    })
    
    afterEach(() => {
      session.dispose()
    })
    
    it('returns success for valid code', async () => {
      // eval returns a Promise<EvalResult> now? 
      // LiveSession.eval signature: eval(code: string): Promise<EvalResult>
      // Checking implementation... 
      // It delegates to internal safeEval which is async.
      
      const result = await session.eval('const x = 1')
      
      expect(result.success).toBe(true)
    })
    
    it('returns error for forbidden code', async () => {
      const result = await session.eval('process.exit()')
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
  
  describe('dispose()', () => {
    it('cleans up resources', async () => {
      const session = new LiveSession({ bpm: 120, runtime: backend })
      await session.init()
      session.play()
      
      session.dispose()
      
      expect(session.isReady()).toBe(false)
      expect(backend.disposed).toBe(true)
    })
  })
  
  describe('Integration', () => {
    it('full playback workflow', async () => {
      const session = new LiveSession({ bpm: 120, quantize: 'bar', runtime: backend })
      await session.init()
      
      session.load(createTestSession())
      
      session.play()
      expect(session.isPlaying()).toBe(true)
      
      session.setTempo(140)
      expect(session.getTempo()).toBe(140)
      
      session.stop()
      expect(session.isPlaying()).toBe(false)
      
      session.dispose()
    })
  })
})
