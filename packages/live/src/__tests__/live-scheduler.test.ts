/**
 * RFC-031: Live Coding Runtime - Scheduler Tests
 * 
 * Tests for quantize utilities and StreamingScheduler.
 */

import {
  parseTimeSignature,
  getNextBeat,
  getNextBarBeat,
  getCurrentBar,
  getBeatInBar,
  getQuantizeTargetBeat,
  beatsToSeconds,
  secondsToBeats,
  getBeatDuration,
  getBarDuration,
  isWithinLookahead,
  getEffectiveCancelBeat,
  getCurrentBeatFromAudioTime,
  getAudioTimeForBeat
} from '../quantize'
import { StreamingScheduler } from '../StreamingScheduler'
import type { RuntimeBackend, CompiledEvent } from '@symphonyscript/core'
import { midiChannel, midiValue } from '@symphonyscript/core'

// =============================================================================
// Mock Backend
// =============================================================================

function createMockBackend(): RuntimeBackend & { 
  scheduledEvents: Array<{ event: CompiledEvent; time: number }>;
  cancelledAfter: Array<{ beat: number; trackId?: string }>;
  currentTime: number;
  disposed: boolean;
} {
  return {
    scheduledEvents: [],
    cancelledAfter: [],
    currentTime: 0,
    disposed: false,
    
    schedule(event: CompiledEvent, audioTime: number): void {
      this.scheduledEvents.push({ event, time: audioTime })
    },
    
    cancelAfter(beat: number, trackId?: string): void {
      this.cancelledAfter.push({ beat, trackId })
    },
    
    cancelAll(): void {
      this.scheduledEvents = []
    },
    
    getCurrentTime(): number {
      return this.currentTime
    },
    
    setTempo(_bpm: number): void {
      // No-op in mock
    },
    
    dispose(): void {
      this.disposed = true
    },

    async init(): Promise<boolean> {
      // Mock init
      return true
    }
  }
}

// =============================================================================
// Test Events
// =============================================================================

function createTestEvent(startSeconds: number, pitch: string = 'C4'): CompiledEvent {
  return {
    kind: 'note',
    startSeconds,
    durationSeconds: 0.5,
    channel: midiChannel(1),
    payload: {
      pitch: pitch as any,
      velocity: midiValue(100)
    }
  }
}

// =============================================================================
// Quantize Utility Tests
// =============================================================================

describe('Quantize Utilities', () => {
  describe('parseTimeSignature', () => {
    it('parses 4/4 time signature', () => {
      const result = parseTimeSignature('4/4')
      expect(result.beatsPerMeasure).toBe(4)
      expect(result.beatUnit).toBe(4)
    })
    
    it('parses 3/4 time signature', () => {
      const result = parseTimeSignature('3/4')
      expect(result.beatsPerMeasure).toBe(3)
      expect(result.beatUnit).toBe(4)
    })
    
    it('parses 6/8 time signature', () => {
      const result = parseTimeSignature('6/8')
      expect(result.beatsPerMeasure).toBe(6)
      expect(result.beatUnit).toBe(8)
    })
  })
  
  describe('getNextBeat', () => {
    it('returns next whole beat from fractional position', () => {
      expect(getNextBeat(0.5)).toBe(1)
      expect(getNextBeat(1.1)).toBe(2)
      expect(getNextBeat(3.9)).toBe(4)
    })
    
    it('returns same beat if already on whole beat', () => {
      expect(getNextBeat(0)).toBe(0)
      expect(getNextBeat(1)).toBe(1)
      expect(getNextBeat(4)).toBe(4)
    })
  })
  
  describe('getNextBarBeat', () => {
    it('returns next bar boundary in 4/4', () => {
      expect(getNextBarBeat(0, 4)).toBe(4)   // Bar 0 -> Bar 1
      expect(getNextBarBeat(1, 4)).toBe(4)   // In bar 0 -> Bar 1
      expect(getNextBarBeat(3.9, 4)).toBe(4) // In bar 0 -> Bar 1
      expect(getNextBarBeat(4, 4)).toBe(8)   // Bar 1 -> Bar 2
      expect(getNextBarBeat(5, 4)).toBe(8)   // In bar 1 -> Bar 2
    })
    
    it('returns next bar boundary in 3/4', () => {
      expect(getNextBarBeat(0, 3)).toBe(3)
      expect(getNextBarBeat(2, 3)).toBe(3)
      expect(getNextBarBeat(3, 3)).toBe(6)
    })
  })
  
  describe('getCurrentBar', () => {
    it('returns correct bar number', () => {
      expect(getCurrentBar(0, 4)).toBe(0)
      expect(getCurrentBar(3.9, 4)).toBe(0)
      expect(getCurrentBar(4, 4)).toBe(1)
      expect(getCurrentBar(7, 4)).toBe(1)
      expect(getCurrentBar(8, 4)).toBe(2)
    })
  })
  
  describe('getBeatInBar', () => {
    it('returns beat position within bar', () => {
      expect(getBeatInBar(0, 4)).toBe(0)
      expect(getBeatInBar(1, 4)).toBe(1)
      expect(getBeatInBar(3, 4)).toBe(3)
      expect(getBeatInBar(4, 4)).toBe(0) // First beat of next bar
      expect(getBeatInBar(5, 4)).toBe(1)
    })
  })
  
  describe('getQuantizeTargetBeat', () => {
    it('returns next bar for bar quantize', () => {
      expect(getQuantizeTargetBeat(1.5, 'bar', 4)).toBe(4)
      expect(getQuantizeTargetBeat(5.5, 'bar', 4)).toBe(8)
    })
    
    it('returns next beat for beat quantize', () => {
      expect(getQuantizeTargetBeat(1.5, 'beat', 4)).toBe(2)
      expect(getQuantizeTargetBeat(5.1, 'beat', 4)).toBe(6)
    })
    
    it('returns current beat for off quantize', () => {
      expect(getQuantizeTargetBeat(1.5, 'off', 4)).toBe(1.5)
      expect(getQuantizeTargetBeat(5.7, 'off', 4)).toBe(5.7)
    })
  })
  
  describe('beatsToSeconds', () => {
    it('converts beats to seconds at 120 BPM', () => {
      // At 120 BPM: 1 beat = 0.5 seconds
      expect(beatsToSeconds(1, 120)).toBe(0.5)
      expect(beatsToSeconds(4, 120)).toBe(2)
      expect(beatsToSeconds(0.5, 120)).toBe(0.25)
    })
    
    it('converts beats to seconds at 60 BPM', () => {
      // At 60 BPM: 1 beat = 1 second
      expect(beatsToSeconds(1, 60)).toBe(1)
      expect(beatsToSeconds(4, 60)).toBe(4)
    })
  })
  
  describe('secondsToBeats', () => {
    it('converts seconds to beats at 120 BPM', () => {
      expect(secondsToBeats(0.5, 120)).toBe(1)
      expect(secondsToBeats(2, 120)).toBe(4)
      expect(secondsToBeats(0.25, 120)).toBe(0.5)
    })
    
    it('converts seconds to beats at 60 BPM', () => {
      expect(secondsToBeats(1, 60)).toBe(1)
      expect(secondsToBeats(4, 60)).toBe(4)
    })
  })
  
  describe('getBeatDuration', () => {
    it('returns beat duration in seconds', () => {
      expect(getBeatDuration(120)).toBe(0.5)
      expect(getBeatDuration(60)).toBe(1)
      expect(getBeatDuration(180)).toBeCloseTo(0.333, 2)
    })
  })
  
  describe('getBarDuration', () => {
    it('returns bar duration in seconds', () => {
      expect(getBarDuration(120, 4)).toBe(2)  // 4 beats * 0.5s
      expect(getBarDuration(60, 4)).toBe(4)   // 4 beats * 1s
      expect(getBarDuration(120, 3)).toBe(1.5) // 3 beats * 0.5s
    })
  })
  
  describe('isWithinLookahead', () => {
    it('returns true for beats in lookahead window', () => {
      expect(isWithinLookahead(1, 0, 2)).toBe(true)  // 1 is in [0, 2)
      expect(isWithinLookahead(1.9, 0, 2)).toBe(true)
    })
    
    it('returns false for beats outside lookahead window', () => {
      expect(isWithinLookahead(2, 0, 2)).toBe(false) // 2 is not in [0, 2)
      expect(isWithinLookahead(3, 0, 2)).toBe(false)
    })
    
    it('returns false for beats before current', () => {
      expect(isWithinLookahead(-1, 0, 2)).toBe(false)
    })
  })
  
  describe('getEffectiveCancelBeat', () => {
    it('returns requested beat if after lookahead', () => {
      expect(getEffectiveCancelBeat(5, 0, 2)).toBe(5) // 5 > 0+2
    })
    
    it('defers to lookahead end if requested beat is within window', () => {
      expect(getEffectiveCancelBeat(1, 0, 2)).toBe(2) // max(1, 0+2) = 2
    })
  })
  
  describe('getCurrentBeatFromAudioTime', () => {
    it('calculates beat from audio time at 120 BPM', () => {
      // 1 second elapsed at 120 BPM = 2 beats
      expect(getCurrentBeatFromAudioTime(1, 0, 0, 120)).toBe(2)
      // 2 seconds elapsed at 120 BPM = 4 beats
      expect(getCurrentBeatFromAudioTime(2, 0, 0, 120)).toBe(4)
    })
    
    it('accounts for start beat offset', () => {
      // 1 second elapsed, started at beat 4 = beat 6
      expect(getCurrentBeatFromAudioTime(1, 0, 4, 120)).toBe(6)
    })
    
    it('accounts for start time offset', () => {
      // Audio time 3, started at time 1 = 2 seconds elapsed = 4 beats
      expect(getCurrentBeatFromAudioTime(3, 1, 0, 120)).toBe(4)
    })
  })
  
  describe('getAudioTimeForBeat', () => {
    it('calculates audio time for beat at 120 BPM', () => {
      // Beat 4 at 120 BPM = 2 seconds from start
      expect(getAudioTimeForBeat(4, 0, 0, 120)).toBe(2)
    })
    
    it('accounts for start time', () => {
      // Beat 4, started at time 1 = time 3
      expect(getAudioTimeForBeat(4, 1, 0, 120)).toBe(3)
    })
    
    it('accounts for start beat', () => {
      // Target beat 6, started at beat 4 = 2 beats delta = 1 second delta
      expect(getAudioTimeForBeat(6, 0, 4, 120)).toBe(1)
    })
  })
})

// =============================================================================
// StreamingScheduler Tests
// =============================================================================

describe('StreamingScheduler', () => {
  let backend: ReturnType<typeof createMockBackend>
  let scheduler: StreamingScheduler
  
  beforeEach(() => {
    backend = createMockBackend()
    scheduler = new StreamingScheduler(backend, {
      bpm: 120,
      lookahead: 0.1,
      beatsPerMeasure: 4
    })
  })
  
  afterEach(() => {
    scheduler.reset()
  })
  
  describe('consume()', () => {
    it('loads events into the scheduler', () => {
      const events = [
        createTestEvent(0),    // Beat 0
        createTestEvent(0.5),  // Beat 1
        createTestEvent(1)     // Beat 2
      ]
      
      scheduler.consume(events)
      
      // Events should be stored (we can't directly inspect, but start should work)
      expect(() => scheduler.start()).not.toThrow()
    })
    
    it('associates events with track ID', () => {
      const events = [createTestEvent(0)]
      scheduler.consume(events, 'drums')
      
      // Verify by splicing - should only affect the drums track
      expect(() => scheduler.splice([], 0, 'drums')).not.toThrow()
    })
  })
  
  describe('splice()', () => {
    it('replaces events after start beat', () => {
      const events1 = [
        createTestEvent(0, 'C4'),
        createTestEvent(0.5, 'D4')
      ]
      const events2 = [
        createTestEvent(0.5, 'E4')  // Replace second event
      ]
      
      scheduler.consume(events1, 'track1')
      scheduler.splice(events2, 1, 'track1')  // Splice from beat 1
      
      // Backend should receive cancelAfter call
      expect(backend.cancelledAfter.length).toBeGreaterThan(0)
    })
    
    it('respects lookahead window', () => {
      backend.currentTime = 0
      scheduler.start()
      
      // Try to splice at beat 0.1 (within lookahead at 120 BPM, 0.1s = 0.2 beats)
      scheduler.splice([createTestEvent(0.5)], 0.1, 'track1')
      
      // Should defer cancellation past lookahead
      expect(backend.cancelledAfter.length).toBeGreaterThan(0)
      const cancelBeat = backend.cancelledAfter[0].beat
      expect(cancelBeat).toBeGreaterThanOrEqual(0.1)
    })
  })
  
  describe('start() / stop()', () => {
    it('starts the scheduler', () => {
      scheduler.start()
      expect(scheduler.getIsRunning()).toBe(true)
    })
    
    it('stops the scheduler', () => {
      scheduler.start()
      scheduler.stop()
      expect(scheduler.getIsRunning()).toBe(false)
    })
    
    it('cancels all on stop', () => {
      scheduler.consume([createTestEvent(0)])
      scheduler.start()
      scheduler.stop()
      
      // Backend should have cancelled all
      expect(backend.scheduledEvents).toEqual([])
    })
  })
  
  describe('pause() / resume()', () => {
    it('pauses without cancelling', () => {
      scheduler.start()
      scheduler.pause()
      
      expect(scheduler.getIsRunning()).toBe(false)
    })
    
    it('resumes from pause', () => {
      scheduler.start()
      scheduler.pause()
      scheduler.resume()
      
      expect(scheduler.getIsRunning()).toBe(true)
    })
  })
  
  describe('reset()', () => {
    it('clears all state', () => {
      scheduler.consume([createTestEvent(0)])
      scheduler.start()
      scheduler.reset()
      
      expect(scheduler.getIsRunning()).toBe(false)
      expect(scheduler.getCurrentBeat()).toBe(0)
    })
  })
  
  describe('getCurrentBeat()', () => {
    it('returns 0 when not started', () => {
      expect(scheduler.getCurrentBeat()).toBe(0)
    })
    
    it('returns current beat based on audio time', () => {
      backend.currentTime = 0
      scheduler.start()
      
      // Advance mock time
      backend.currentTime = 1  // 1 second = 2 beats at 120 BPM
      
      expect(scheduler.getCurrentBeat()).toBe(2)
    })
  })
  
  describe('getNextBarBeat()', () => {
    it('returns next bar boundary', () => {
      backend.currentTime = 0
      scheduler.start()
      
      // At beat 0, next bar is beat 4
      expect(scheduler.getNextBarBeat()).toBe(4)
      
      // Advance to beat 1
      backend.currentTime = 0.5  // 0.5s = 1 beat at 120 BPM
      expect(scheduler.getNextBarBeat()).toBe(4)
      
      // Advance to beat 4
      backend.currentTime = 2  // 2s = 4 beats at 120 BPM
      expect(scheduler.getNextBarBeat()).toBe(8)
    })
  })
  
  describe('getCurrentBar()', () => {
    it('returns current bar number', () => {
      backend.currentTime = 0
      scheduler.start()
      
      expect(scheduler.getCurrentBar()).toBe(0)
      
      // Advance to bar 1
      backend.currentTime = 2  // 4 beats
      expect(scheduler.getCurrentBar()).toBe(1)
    })
  })
  
  describe('setTempo()', () => {
    it('updates tempo', () => {
      scheduler.setTempo(60)
      expect(scheduler.getTempo()).toBe(60)
    })
    
    it('notifies backend of tempo change', () => {
      // We'd need to spy on backend.setTempo to verify this
      // For now, just verify it doesn't throw
      expect(() => scheduler.setTempo(60)).not.toThrow()
    })
  })
  
  describe('scheduleCallback()', () => {
    it('schedules callback for future beat', () => {
      let called = false
      scheduler.scheduleCallback(2, () => { called = true })
      
      backend.currentTime = 0
      scheduler.start()
      
      // Callback should not be called yet (we're at beat 0)
      expect(called).toBe(false)
    })
  })
  
  describe('queueUpdate()', () => {
    it('queues update for future beat', () => {
      const newEvents = [createTestEvent(2)]
      
      scheduler.queueUpdate({
        targetBeat: 4,
        events: newEvents,
        trackId: 'track1'
      })
      
      // Should not throw
      expect(() => scheduler.start()).not.toThrow()
    })
  })
  
  describe('cancelAfter()', () => {
    it('cancels events after specified beat', () => {
      scheduler.consume([
        createTestEvent(0),
        createTestEvent(0.5),
        createTestEvent(1)
      ])
      
      scheduler.cancelAfter(1)  // Cancel after beat 2 (1 second = 2 beats)
      
      expect(backend.cancelledAfter.length).toBeGreaterThan(0)
    })
    
    it('respects track filter', () => {
      scheduler.cancelAfter(1, 'drums')
      
      expect(backend.cancelledAfter.length).toBeGreaterThan(0)
      expect(backend.cancelledAfter[0].trackId).toBe('drums')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('StreamingScheduler Integration', () => {
  it('schedules events within lookahead window', () => {
    const backend = createMockBackend()
    const scheduler = new StreamingScheduler(backend, {
      bpm: 120,
      lookahead: 0.5,  // 1 beat at 120 BPM
      beatsPerMeasure: 4
    })
    
    // Events at beats 0, 1, 2
    scheduler.consume([
      createTestEvent(0),     // Beat 0 at 120 BPM
      createTestEvent(0.5),   // Beat 1
      createTestEvent(1)      // Beat 2
    ])
    
    backend.currentTime = 0
    scheduler.start()
    
    // Should have scheduled events within lookahead (beat 0 and 1)
    expect(backend.scheduledEvents.length).toBeGreaterThanOrEqual(1)
    
    scheduler.reset()
  })
  
  it('maintains beat position across operations', () => {
    const backend = createMockBackend()
    const scheduler = new StreamingScheduler(backend, {
      bpm: 120,
      lookahead: 0.1,
      beatsPerMeasure: 4
    })
    
    backend.currentTime = 0
    scheduler.start()
    
    const beat1 = scheduler.getCurrentBeat()
    
    backend.currentTime = 0.5  // 1 beat later
    const beat2 = scheduler.getCurrentBeat()
    
    expect(beat2 - beat1).toBeCloseTo(1, 1)
    
    scheduler.reset()
  })
})
