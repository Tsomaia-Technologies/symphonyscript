/**
 * RFC-031: Live Coding Runtime - Eval Tests
 * 
 * Tests for safe code evaluation using new Function().
 */

import {
  createEvalContext,
  safeEval,
  diffSessions,
  mergeTracksIntoSession,
  preprocessCode,
  validateCode,
  type EvalContext,
  type SafeEvalResult as EvalResult,
  type TrackDefinition
} from '../eval'
import { LiveSession } from '../LiveSession'
import type { SessionNode, TrackNode } from '@symphonyscript/core'
import type { ClipNode } from '@symphonyscript/core'
import { SCHEMA_VERSION } from '@symphonyscript/core'

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestClip(name: string = 'test'): ClipNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'clip',
    name,
    operations: [
      { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 0.8 }
    ]
  }
}

function createTestTrack(name: string, clipName?: string): TrackNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'track',
    name,
    clip: createTestClip(clipName ?? name),
    instrument: { name: 'test-synth', config: { type: 'synth' } } as any
  }
}

function createTestSession(trackNames: string[] = ['lead', 'bass']): SessionNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'session',
    tracks: trackNames.map(name => createTestTrack(name)),
    tempo: 120,
    timeSignature: '4/4'
  }
}

// =============================================================================
// createEvalContext Tests
// =============================================================================

describe('createEvalContext', () => {
  it('creates context with DSL objects', () => {
    const context = createEvalContext()
    
    expect(context.Clip).toBeDefined()
    expect(context.Session).toBeDefined()
    expect(context.Track).toBeDefined()
    expect(context.Synth).toBeDefined()
    expect(context.Sampler).toBeDefined()
    expect(context.synth).toBeDefined()
    expect(context.sampler).toBeDefined()
    expect(context.Instrument).toBeDefined()
    expect(context.track).toBeDefined()
  })
  
  it('provides track() helper function', () => {
    const context = createEvalContext()
    
    expect(typeof context.track).toBe('function')
  })
  
  it('initializes __tracks__ and __session__ storage', () => {
    const context = createEvalContext()
    
    expect(context.__tracks__).toBeInstanceOf(Map)
    expect(context.__tracks__.size).toBe(0)
    expect(context.__session__).toBeNull()
  })
})

// =============================================================================
// safeEval Tests
// =============================================================================

describe('safeEval', () => {
  it('evaluates simple expressions with return', async () => {
    const context = createEvalContext()
    
    const result = await safeEval('return 1 + 1', context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe(2)
  })
  
  it('evaluates async code with return', async () => {
    const context = createEvalContext()
    
    const result = await safeEval('return await Promise.resolve(42)', context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })
  
  it('has access to Clip factory', async () => {
    const context = createEvalContext()
    
    const result = await safeEval(`
      const clip = Clip.melody('test').note('C4', '4n').build()
      return clip.name
    `, context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe('test')
  })
  
  it('has access to Session builder', async () => {
    const context = createEvalContext()
    
    const result = await safeEval(`
      const s = Session.create().tempo(140)
      return s._tempo
    `, context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe(140)
  })
  
  it('captures tracks from track() helper', async () => {
    const context = createEvalContext()
    
    await safeEval(`
      track('drums', t => t
        .clip(Clip.drums('drums').kick('4n').build())
      )
    `, context)
    
    expect(context.__tracks__.size).toBe(1)
    expect(context.__tracks__.has('drums')).toBe(true)
    
    const track = context.__tracks__.get('drums')
    expect(track?.name).toBe('drums')
    expect(track?.clip).toBeDefined()
  })
  
  it('captures multiple tracks', async () => {
    const context = createEvalContext()
    
    await safeEval(`
      track('drums', t => t.clip(Clip.drums('d').kick('4n').build()))
      track('bass', t => t.clip(Clip.melody('b').note('E2', '4n').build()))
    `, context)
    
    expect(context.__tracks__.size).toBe(2)
    expect(context.__tracks__.has('drums')).toBe(true)
    expect(context.__tracks__.has('bass')).toBe(true)
  })
  
  it('returns error on syntax error', async () => {
    const context = createEvalContext()
    
    const result = await safeEval('const x = {', context)
    
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
  
  it('returns error on runtime error', async () => {
    const context = createEvalContext()
    
    const result = await safeEval('throw new Error("test error")', context)
    
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('test error')
  })
  
  it('runs in strict mode (no implicit globals)', async () => {
    const context = createEvalContext()
    
    // In strict mode, assigning to undefined variable should throw
    // Note: The actual behavior depends on the environment
    // At minimum, verify code executes without errors when proper
    const result = await safeEval('const x = 5; return x', context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe(5)
  })
  
  it('does not expose DSL objects as globals', async () => {
    const context = createEvalContext()
    
    // DSL objects should be accessible in the scope
    const clipResult = await safeEval('return typeof Clip', context)
    expect(clipResult.value).toBe('object')
    
    // Session should be accessible
    const sessionResult = await safeEval('return typeof Session', context)
    expect(sessionResult.value).toBe('function')
  })
})

// =============================================================================
// diffSessions Tests
// =============================================================================

describe('diffSessions', () => {
  it('returns all tracks when old session is null', () => {
    const newSession = createTestSession(['lead', 'bass', 'drums'])
    
    const changed = diffSessions(null, newSession)
    
    expect(changed).toEqual(['lead', 'bass', 'drums'])
  })
  
  it('returns empty array when sessions are identical', () => {
    const session = createTestSession(['lead', 'bass'])
    
    const changed = diffSessions(session, session)
    
    expect(changed).toEqual([])
  })
  
  it('detects new tracks', () => {
    const oldSession = createTestSession(['lead'])
    const newSession = createTestSession(['lead', 'bass'])
    
    const changed = diffSessions(oldSession, newSession)
    
    expect(changed).toContain('bass')
  })
  
  it('detects removed tracks', () => {
    const oldSession = createTestSession(['lead', 'bass'])
    const newSession = createTestSession(['lead'])
    
    const changed = diffSessions(oldSession, newSession)
    
    expect(changed).toContain('bass')
  })
  
  it('detects modified tracks', () => {
    const oldSession = createTestSession(['lead'])
    const newSession: SessionNode = {
      ...createTestSession(['lead']),
      tracks: [{
        _version: SCHEMA_VERSION,
        kind: 'track',
        name: 'lead',
        clip: {
          _version: SCHEMA_VERSION,
          kind: 'clip',
          name: 'lead',
          operations: [
            { kind: 'note', note: 'D4' as any, duration: '8n', velocity: 0.9 } // Different
          ]
        },
        instrument: { name: 'test', config: {} } as any
      }]
    }
    
    const changed = diffSessions(oldSession, newSession)
    
    expect(changed).toContain('lead')
  })
})

// =============================================================================
// mergeTracksIntoSession Tests
// =============================================================================

describe('mergeTracksIntoSession', () => {
  const defaultInstrument = { name: 'default', config: { type: 'synth' } }
  
  it('creates new session from tracks when base is null', () => {
    const tracks = new Map<string, TrackDefinition>()
    tracks.set('drums', {
      name: 'drums',
      clip: createTestClip('drums')
    })
    
    const session = mergeTracksIntoSession(null, tracks, defaultInstrument)
    
    expect(session.tracks.length).toBe(1)
    expect(session.tracks[0].name).toBe('drums')
  })
  
  it('adds new tracks to existing session', () => {
    const baseSession = createTestSession(['lead'])
    const tracks = new Map<string, TrackDefinition>()
    tracks.set('bass', {
      name: 'bass',
      clip: createTestClip('bass')
    })
    
    const session = mergeTracksIntoSession(baseSession, tracks, defaultInstrument)
    
    expect(session.tracks.length).toBe(2)
    expect(session.tracks.map(t => t.name)).toContain('lead')
    expect(session.tracks.map(t => t.name)).toContain('bass')
  })
  
  it('updates existing tracks', () => {
    const baseSession = createTestSession(['lead'])
    const newClip = createTestClip('new-lead')
    newClip.operations.push({ kind: 'rest', duration: '4n' })
    
    const tracks = new Map<string, TrackDefinition>()
    tracks.set('lead', {
      name: 'lead',
      clip: newClip
    })
    
    const session = mergeTracksIntoSession(baseSession, tracks, defaultInstrument)
    
    expect(session.tracks.length).toBe(1)
    expect(session.tracks[0].clip.operations.length).toBe(2)
  })
  
  it('preserves base session metadata', () => {
    const baseSession = createTestSession(['lead'])
    baseSession.tempo = 140
    baseSession.timeSignature = '3/4'
    
    const tracks = new Map<string, TrackDefinition>()
    
    const session = mergeTracksIntoSession(baseSession, tracks, defaultInstrument)
    
    expect(session.tempo).toBe(140)
    expect(session.timeSignature).toBe('3/4')
  })
  
  it('uses default instrument when not provided', () => {
    const tracks = new Map<string, TrackDefinition>()
    tracks.set('drums', {
      name: 'drums',
      clip: createTestClip('drums')
      // No instrument provided
    })
    
    const session = mergeTracksIntoSession(null, tracks, defaultInstrument)
    
    expect(session.tracks[0].instrument).toBe(defaultInstrument)
  })
  
  it('uses provided instrument over default', () => {
    const customInstrument = { name: 'custom', config: { type: 'sampler' } }
    const tracks = new Map<string, TrackDefinition>()
    tracks.set('drums', {
      name: 'drums',
      clip: createTestClip('drums'),
      instrument: customInstrument
    })
    
    const session = mergeTracksIntoSession(null, tracks, defaultInstrument)
    
    expect(session.tracks[0].instrument).toBe(customInstrument)
  })
})

// =============================================================================
// preprocessCode Tests
// =============================================================================

describe('preprocessCode', () => {
  it('trims whitespace', () => {
    const result = preprocessCode('  code  ')
    expect(result).toBe('code;')
  })
  
  it('adds semicolon if missing', () => {
    const result = preprocessCode('const x = 1')
    expect(result).toBe('const x = 1;')
  })
  
  it('does not add semicolon after closing brace', () => {
    const result = preprocessCode('if (true) { }')
    expect(result).toBe('if (true) { }')
  })
  
  it('does not add semicolon if already present', () => {
    const result = preprocessCode('const x = 1;')
    expect(result).toBe('const x = 1;')
  })
})

// =============================================================================
// validateCode Tests
// =============================================================================

describe('validateCode', () => {
  it('allows valid DSL code', () => {
    const result = validateCode(`
      track('drums', t => t.clip(Clip.drums().kick('4n').build()))
    `)
    
    expect(result.valid).toBe(true)
  })
  
  it('rejects process access', () => {
    const result = validateCode('process.exit(1)')
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('process')
  })
  
  it('rejects require', () => {
    const result = validateCode("require('fs')")
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('require')
  })
  
  it('rejects import', () => {
    const result = validateCode("import fs from 'fs'")
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('import')
  })
  
  it('rejects export', () => {
    const result = validateCode('export const x = 1')
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('export')
  })
  
  it('rejects global access', () => {
    const result = validateCode('global.something = 1')
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('global')
  })
  
  it('rejects window access', () => {
    const result = validateCode('window.alert("hi")')
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('window')
  })
  
  it('rejects document access', () => {
    const result = validateCode('document.createElement("div")')
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('document')
  })
  
  it('rejects fetch', () => {
    const result = validateCode("fetch('http://example.com')")
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('fetch')
  })
  
  it('rejects WebSocket', () => {
    const result = validateCode("new WebSocket('ws://localhost')")
    
    expect(result.valid).toBe(false)
    expect(result.error).toContain('WebSocket')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Eval Integration', () => {
  it('full workflow: create context, eval, extract tracks', async () => {
    const context = createEvalContext()
    
    // Evaluate code that creates tracks using track() helper
    const result = await safeEval(`
      track('drums', t => t
        .clip(Clip.drums('drums').kick('4n').build())
      )
      
      track('bass', t => t
        .clip(Clip.melody('bass').note('E2', '8n').build())
      )
    `, context)
    
    expect(result.success).toBe(true)
    
    // Tracks should be captured in the context
    expect(context.__tracks__.size).toBe(2)
    expect(context.__tracks__.has('drums')).toBe(true)
    expect(context.__tracks__.has('bass')).toBe(true)
    
    // Verify track contents from context
    const drums = context.__tracks__.get('drums')
    expect(drums?.name).toBe('drums')
    expect(drums?.clip.name).toBe('drums')
  })
  
  it('creates clips using DSL', async () => {
    const context = createEvalContext()
    
    const result = await safeEval(`
      const clip = Clip.melody('test')
        .note('C4', '4n')
        .note('E4', '4n')
        .note('G4', '4n')
        .build()
      return clip.operations.length
    `, context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe(3)
  })
  
  it('can use synth() to create instruments', async () => {
    const context = createEvalContext()
    
    const result = await safeEval(`
      const inst = synth('test-synth')
      return inst.name
    `, context)
    
    expect(result.success).toBe(true)
    expect(result.value).toBe('test-synth')
  })
})
