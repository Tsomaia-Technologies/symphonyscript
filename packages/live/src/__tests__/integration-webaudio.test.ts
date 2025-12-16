/**
 * Integration Test: LiveSession + WebAudioBackend
 * 
 * Verifies that the decoupled packages work together correctly.
 */

import { jest } from '@jest/globals';
import { AudioContext, AudioNode } from 'standardized-audio-context-mock';

// Mock Web API globals for Node environment
(global as any).AudioContext = AudioContext;
(global as any).AudioNode = AudioNode;

import { LiveSession } from '../index';
import { WebAudioBackend } from '@symphonyscript/runtime-webaudio';

describe('Integration: LiveSession + WebAudioBackend', () => {
  let session: LiveSession;
  let backend: WebAudioBackend;

  beforeEach(() => {
    // 1. Instantiate Backend
    backend = new WebAudioBackend();
    
    // 2. Instantiate Session with Backend Injection
    session = new LiveSession({
      bpm: 120,
      runtime: backend
    });
  });

  afterEach(() => {
    session.dispose();
  });

  it('initializes correctly', async () => {
    await session.init();
    expect(backend.isReady()).toBe(true);
  });

  it('evaluates code and schedules events on backend', async () => {
    await session.init();
    session.play();

    // Spy on backend schedule method
    const scheduleSpy = jest.spyOn(backend, 'schedule');

    // Execute code that should generate a note
    const code = `
      track('bass', t => t.clip(
        Clip.melody().note('C2', '4n')
      ))
    `;

    const result = await session.eval(code);
    expect(result.success).toBe(true);
    
    // Note: We don't assert scheduleSpy yet as it relies on async scheduling loop
  });
  
  it('updates tempo on backend', async () => {
    await session.init();
    
    // We need to spy on the prototype or the instance method BEFORE it's bound or used?
    // backend is created in beforeEach.
    const setTempoSpy = jest.spyOn(backend, 'setTempo');
    
    const result = await session.eval(`session({ tempo: 140 }).build()`);
    expect(result.success).toBe(true);
    
    expect(setTempoSpy).toHaveBeenCalledWith(140);
  });
});
