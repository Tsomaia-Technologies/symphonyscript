/**
 * RFC-031: Live Coding Runtime - Beat-Grid Synchronization Tests
 * 
 * Tests for Phase 5: quantize modes, lookahead handling, and beat/bar events.
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
  isAtQuantizeBoundary,
  getTimeUntilNextQuantize,
  getQuantizeTargetWithLookahead,
  getBeatGridInfo
} from '../live/quantize'

// =============================================================================
// Time Signature Parsing Tests
// =============================================================================

describe('Time Signature Parsing', () => {
  it('parses 4/4 time', () => {
    const result = parseTimeSignature('4/4')
    expect(result.beatsPerMeasure).toBe(4)
    expect(result.beatUnit).toBe(4)
  })
  
  it('parses 3/4 time', () => {
    const result = parseTimeSignature('3/4')
    expect(result.beatsPerMeasure).toBe(3)
    expect(result.beatUnit).toBe(4)
  })
  
  it('parses 6/8 time', () => {
    const result = parseTimeSignature('6/8')
    expect(result.beatsPerMeasure).toBe(6)
    expect(result.beatUnit).toBe(8)
  })
  
  it('parses 5/4 time', () => {
    const result = parseTimeSignature('5/4')
    expect(result.beatsPerMeasure).toBe(5)
    expect(result.beatUnit).toBe(4)
  })
})

// =============================================================================
// Beat Calculation Tests
// =============================================================================

describe('Beat Calculations', () => {
  describe('getNextBeat', () => {
    it('returns next whole beat from fractional', () => {
      expect(getNextBeat(0.5)).toBe(1)
      expect(getNextBeat(1.3)).toBe(2)
      expect(getNextBeat(3.9)).toBe(4)
    })
    
    it('returns next beat from whole beat', () => {
      expect(getNextBeat(0)).toBe(0)
      expect(getNextBeat(1)).toBe(1)
      expect(getNextBeat(4)).toBe(4)
    })
  })
  
  describe('getNextBarBeat', () => {
    it('returns start of next bar in 4/4', () => {
      expect(getNextBarBeat(0, 4)).toBe(4)
      expect(getNextBarBeat(1, 4)).toBe(4)
      expect(getNextBarBeat(3.9, 4)).toBe(4)
      expect(getNextBarBeat(4, 4)).toBe(8)
    })
    
    it('returns start of next bar in 3/4', () => {
      expect(getNextBarBeat(0, 3)).toBe(3)
      expect(getNextBarBeat(1.5, 3)).toBe(3)
      expect(getNextBarBeat(3, 3)).toBe(6)
    })
  })
  
  describe('getCurrentBar', () => {
    it('returns 0-indexed bar number', () => {
      expect(getCurrentBar(0, 4)).toBe(0)
      expect(getCurrentBar(3, 4)).toBe(0)
      expect(getCurrentBar(4, 4)).toBe(1)
      expect(getCurrentBar(7, 4)).toBe(1)
      expect(getCurrentBar(8, 4)).toBe(2)
    })
  })
  
  describe('getBeatInBar', () => {
    it('returns beat position within bar', () => {
      expect(getBeatInBar(0, 4)).toBe(0)
      expect(getBeatInBar(1, 4)).toBe(1)
      expect(getBeatInBar(4, 4)).toBe(0)
      expect(getBeatInBar(5, 4)).toBe(1)
      expect(getBeatInBar(6.5, 4)).toBe(2.5)
    })
  })
})

// =============================================================================
// Quantize Target Tests
// =============================================================================

describe('Quantize Target Calculation', () => {
  describe('getQuantizeTargetBeat', () => {
    it('returns next bar for bar quantize', () => {
      expect(getQuantizeTargetBeat(0, 'bar', 4)).toBe(4)
      expect(getQuantizeTargetBeat(2.5, 'bar', 4)).toBe(4)
      expect(getQuantizeTargetBeat(4.5, 'bar', 4)).toBe(8)
    })
    
    it('returns next beat for beat quantize', () => {
      expect(getQuantizeTargetBeat(0, 'beat', 4)).toBe(0)
      expect(getQuantizeTargetBeat(0.5, 'beat', 4)).toBe(1)
      expect(getQuantizeTargetBeat(3.7, 'beat', 4)).toBe(4)
    })
    
    it('returns current beat for off mode', () => {
      expect(getQuantizeTargetBeat(0, 'off', 4)).toBe(0)
      expect(getQuantizeTargetBeat(2.5, 'off', 4)).toBe(2.5)
      expect(getQuantizeTargetBeat(7.3, 'off', 4)).toBe(7.3)
    })
  })
})

// =============================================================================
// Time Conversion Tests
// =============================================================================

describe('Time Conversions', () => {
  describe('beatsToSeconds', () => {
    it('converts at 120 BPM (0.5s per beat)', () => {
      expect(beatsToSeconds(1, 120)).toBe(0.5)
      expect(beatsToSeconds(2, 120)).toBe(1)
      expect(beatsToSeconds(4, 120)).toBe(2)
    })
    
    it('converts at 60 BPM (1s per beat)', () => {
      expect(beatsToSeconds(1, 60)).toBe(1)
      expect(beatsToSeconds(4, 60)).toBe(4)
    })
    
    it('converts fractional beats', () => {
      expect(beatsToSeconds(0.5, 120)).toBe(0.25)
    })
  })
  
  describe('secondsToBeats', () => {
    it('converts at 120 BPM', () => {
      expect(secondsToBeats(0.5, 120)).toBe(1)
      expect(secondsToBeats(1, 120)).toBe(2)
      expect(secondsToBeats(2, 120)).toBe(4)
    })
    
    it('converts at 60 BPM', () => {
      expect(secondsToBeats(1, 60)).toBe(1)
      expect(secondsToBeats(4, 60)).toBe(4)
    })
  })
  
  describe('getBeatDuration', () => {
    it('returns correct duration for different tempos', () => {
      expect(getBeatDuration(120)).toBe(0.5)
      expect(getBeatDuration(60)).toBe(1)
      expect(getBeatDuration(180)).toBeCloseTo(0.333, 2)
    })
  })
  
  describe('getBarDuration', () => {
    it('returns correct bar duration', () => {
      expect(getBarDuration(120, 4)).toBe(2)   // 4 beats * 0.5s = 2s
      expect(getBarDuration(60, 4)).toBe(4)    // 4 beats * 1s = 4s
      expect(getBarDuration(120, 3)).toBe(1.5) // 3 beats * 0.5s = 1.5s
    })
  })
})

// =============================================================================
// Lookahead Tests
// =============================================================================

describe('Lookahead Handling', () => {
  describe('isWithinLookahead', () => {
    it('returns true for beats in lookahead window', () => {
      expect(isWithinLookahead(4, 4, 1)).toBe(true)  // exactly at current
      expect(isWithinLookahead(4.5, 4, 1)).toBe(true) // within window
      expect(isWithinLookahead(4.99, 4, 1)).toBe(true) // at edge
    })
    
    it('returns false for beats outside lookahead', () => {
      expect(isWithinLookahead(5, 4, 1)).toBe(false)  // at window end
      expect(isWithinLookahead(6, 4, 1)).toBe(false)  // beyond window
      expect(isWithinLookahead(3, 4, 1)).toBe(false)  // before current
    })
  })
  
  describe('getEffectiveCancelBeat', () => {
    it('defers to end of lookahead if within window', () => {
      // Request at beat 4, current is 4, lookahead is 1 beat
      // Effective should be 5 (end of lookahead)
      expect(getEffectiveCancelBeat(4, 4, 1)).toBe(5)
      
      // Request at beat 4.5, should still defer to 5
      expect(getEffectiveCancelBeat(4.5, 4, 1)).toBe(5)
    })
    
    it('uses requested beat if after lookahead', () => {
      // Request at beat 6, current is 4, lookahead is 1 beat
      // Effective should be 6 (requested)
      expect(getEffectiveCancelBeat(6, 4, 1)).toBe(6)
    })
    
    it('handles larger lookahead windows', () => {
      expect(getEffectiveCancelBeat(4, 4, 2)).toBe(6) // 4 + 2 = 6
      expect(getEffectiveCancelBeat(5, 4, 2)).toBe(6) // still within window
    })
  })
})

// =============================================================================
// Phase 5: Beat-Grid Synchronization Tests
// =============================================================================

describe('Phase 5: Beat-Grid Synchronization', () => {
  describe('isAtQuantizeBoundary', () => {
    it('detects bar boundaries', () => {
      expect(isAtQuantizeBoundary(0, 'bar', 4)).toBe(true)
      expect(isAtQuantizeBoundary(4, 'bar', 4)).toBe(true)
      expect(isAtQuantizeBoundary(8, 'bar', 4)).toBe(true)
      expect(isAtQuantizeBoundary(2, 'bar', 4)).toBe(false)
      expect(isAtQuantizeBoundary(3.5, 'bar', 4)).toBe(false)
    })
    
    it('detects beat boundaries', () => {
      expect(isAtQuantizeBoundary(0, 'beat', 4)).toBe(true)
      expect(isAtQuantizeBoundary(1, 'beat', 4)).toBe(true)
      expect(isAtQuantizeBoundary(5, 'beat', 4)).toBe(true)
      expect(isAtQuantizeBoundary(1.5, 'beat', 4)).toBe(false)
      expect(isAtQuantizeBoundary(3.7, 'beat', 4)).toBe(false)
    })
    
    it('always returns true for off mode', () => {
      expect(isAtQuantizeBoundary(0, 'off', 4)).toBe(true)
      expect(isAtQuantizeBoundary(1.5, 'off', 4)).toBe(true)
      expect(isAtQuantizeBoundary(3.7, 'off', 4)).toBe(true)
    })
    
    it('respects tolerance for floating point', () => {
      expect(isAtQuantizeBoundary(3.9999, 'bar', 4)).toBe(true)
      expect(isAtQuantizeBoundary(4.0001, 'bar', 4)).toBe(true)
      expect(isAtQuantizeBoundary(0.9998, 'beat', 4)).toBe(true)
    })
  })
  
  describe('getTimeUntilNextQuantize', () => {
    it('calculates time to next bar at 120 BPM', () => {
      // At beat 0, next bar is beat 4, which is 2 seconds away at 120 BPM
      const time = getTimeUntilNextQuantize(0, 'bar', 4, 120)
      expect(time).toBe(2)
    })
    
    it('calculates time to next beat at 120 BPM', () => {
      // At beat 0.5, next beat is 1, which is 0.25 seconds away
      const time = getTimeUntilNextQuantize(0.5, 'beat', 4, 120)
      expect(time).toBe(0.25)
    })
    
    it('returns 0 for off mode', () => {
      expect(getTimeUntilNextQuantize(0, 'off', 4, 120)).toBe(0)
      expect(getTimeUntilNextQuantize(2.5, 'off', 4, 120)).toBe(0)
    })
    
    it('handles different time signatures', () => {
      // At beat 1, next bar in 3/4 is beat 3, which is 1 second away at 120 BPM
      const time = getTimeUntilNextQuantize(1, 'bar', 3, 120)
      expect(time).toBe(1)
    })
  })
  
  describe('getQuantizeTargetWithLookahead', () => {
    it('skips to next boundary if within lookahead', () => {
      // Current beat 3.5, bar quantize (next bar at 4), lookahead 1 beat
      // 4 is within lookahead (3.5 + 1 = 4.5), so skip to bar 8
      const target = getQuantizeTargetWithLookahead(3.5, 'bar', 4, 1)
      expect(target).toBe(8)
    })
    
    it('uses regular boundary if outside lookahead', () => {
      // Current beat 2, bar quantize (next bar at 4), lookahead 1 beat
      // 4 is outside lookahead (2 + 1 = 3), so use bar 4
      const target = getQuantizeTargetWithLookahead(2, 'bar', 4, 1)
      expect(target).toBe(4)
    })
    
    it('handles beat quantize with lookahead', () => {
      // Current beat 0.8, beat quantize (next beat at 1), lookahead 0.5 beats
      // 1 is within lookahead (0.8 + 0.5 = 1.3), so skip to beat 2
      const target = getQuantizeTargetWithLookahead(0.8, 'beat', 4, 0.5)
      expect(target).toBe(2)
    })
    
    it('respects lookahead even in off mode', () => {
      // Off mode but with lookahead of 1 beat
      const target = getQuantizeTargetWithLookahead(2.5, 'off', 4, 1)
      expect(target).toBe(3.5) // currentBeat + lookahead
    })
  })
  
  describe('getBeatGridInfo', () => {
    it('returns correct info at bar start', () => {
      const info = getBeatGridInfo(0, 4)
      expect(info.bar).toBe(0)
      expect(info.beatInBar).toBe(0)
      expect(info.isOnBeat).toBe(true)
      expect(info.isOnBar).toBe(true)
      expect(info.beatsUntilNextBar).toBe(4)
    })
    
    it('returns correct info mid-bar', () => {
      const info = getBeatGridInfo(2.5, 4)
      expect(info.bar).toBe(0)
      expect(info.beatInBar).toBe(2)
      expect(info.fractionalBeat).toBeCloseTo(0.5)
      expect(info.isOnBeat).toBe(false)
      expect(info.isOnBar).toBe(false)
      expect(info.beatsUntilNextBar).toBe(1.5)
    })
    
    it('returns correct info at second bar', () => {
      const info = getBeatGridInfo(5, 4)
      expect(info.bar).toBe(1)
      expect(info.beatInBar).toBe(1)
      expect(info.isOnBeat).toBe(true)
      expect(info.isOnBar).toBe(false)
    })
    
    it('handles 3/4 time', () => {
      const info = getBeatGridInfo(4, 3)
      expect(info.bar).toBe(1)
      expect(info.beatInBar).toBe(1)
      expect(info.beatsUntilNextBar).toBe(2)
    })
  })
})

// =============================================================================
// Integration: Quantize + Lookahead
// =============================================================================

describe('Quantize + Lookahead Integration', () => {
  it('seamless transition scenario: bar quantize with 100ms lookahead at 120 BPM', () => {
    // 120 BPM = 0.5s per beat = 500ms per beat
    // 100ms lookahead = 0.2 beats
    const lookaheadBeats = secondsToBeats(0.1, 120) // 0.2 beats
    
    // User triggers update at beat 3.9
    const currentBeat = 3.9
    const targetBeat = getQuantizeTargetWithLookahead(currentBeat, 'bar', 4, lookaheadBeats)
    
    // Next bar is beat 4, which is only 0.1 beats away
    // Since 4 is within lookahead (3.9 + 0.2 = 4.1), skip to bar 8
    expect(targetBeat).toBe(8)
  })
  
  it('immediate transition scenario: bar quantize with small lookahead', () => {
    const lookaheadBeats = 0.1 // Very small lookahead
    
    // User triggers update at beat 2
    const currentBeat = 2
    const targetBeat = getQuantizeTargetWithLookahead(currentBeat, 'bar', 4, lookaheadBeats)
    
    // Next bar is beat 4, which is 2 beats away
    // 4 is outside lookahead (2 + 0.1 = 2.1), so use bar 4
    expect(targetBeat).toBe(4)
  })
  
  it('handles fast tempo (180 BPM)', () => {
    // 180 BPM = 0.333s per beat
    // 100ms lookahead = 0.3 beats
    const lookaheadBeats = secondsToBeats(0.1, 180) // ~0.3 beats
    
    const currentBeat = 3.8
    const targetBeat = getQuantizeTargetWithLookahead(currentBeat, 'bar', 4, lookaheadBeats)
    
    // 4 is within lookahead (3.8 + 0.3 = 4.1), skip to bar 8
    expect(targetBeat).toBe(8)
  })
  
  it('handles slow tempo (60 BPM)', () => {
    // 60 BPM = 1s per beat
    // 100ms lookahead = 0.1 beats
    const lookaheadBeats = secondsToBeats(0.1, 60) // 0.1 beats
    
    const currentBeat = 3.5
    const targetBeat = getQuantizeTargetWithLookahead(currentBeat, 'bar', 4, lookaheadBeats)
    
    // 4 is outside lookahead (3.5 + 0.1 = 3.6), use bar 4
    expect(targetBeat).toBe(4)
  })
})
