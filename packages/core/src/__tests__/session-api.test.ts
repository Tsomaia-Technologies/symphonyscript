// =============================================================================
// SymphonyScript - Session & Track Fluent API Tests
// =============================================================================

import { session, Session } from '../session/Session'
import { Track } from '../session/Track'
import { Clip } from '../index'
import { Instrument } from '../instrument/Instrument'

describe('Session Fluent API', () => {
  it('should set tempo fluently', () => {
    const s = session().tempo(140)
    // Access internal property via build() or cast (since .tempo is now a method)
    expect(s.build().tempo).toBe(140)
  })

  it('should set timeSignature fluently', () => {
    const s = session().timeSignature('5/4')
    expect(s.build().timeSignature).toBe('5/4')
  })

  it('should set defaultDuration fluently', () => {
    const s = session().defaultDuration('8n')
    expect(s.build().defaultDuration).toBe('8n')
  })

  it('should chain multiple fluent calls', () => {
    const s = session()
      .tempo(120)
      .timeSignature('3/4')
      .defaultDuration('16n')
    
    const node = s.build()
    expect(node.tempo).toBe(120)
    expect(node.timeSignature).toBe('3/4')
    expect(node.defaultDuration).toBe('16n')
  })

  it('should preserve properties when adding tracks', () => {
    // Setup dummy track
    const clip = Clip.melody().note('C4').build()
    const inst = Instrument.synth('Test')
    const track = Track.from(clip, inst)
    
    const s = session()
      .tempo(120)
      .defaultDuration('8n')
      .add(track)
    
    const node = s.build()
    expect(node.tempo).toBe(120)
    expect(node.defaultDuration).toBe('8n')
    expect(node.tracks.length).toBe(1)
  })

  it('should remain immutable', () => {
    const s1 = session()
    const s2 = s1.tempo(120)
    
    expect(s1.build().tempo).toBeUndefined()
    expect(s2.build().tempo).toBe(120)
    expect(s1).not.toBe(s2)
  })

  it('should accept options in factory for backward compatibility', () => {
    const s = session({ tempo: 90, timeSignature: '6/8', defaultDuration: '2n' })
    const node = s.build()
    expect(node.tempo).toBe(90)
    expect(node.timeSignature).toBe('6/8')
    expect(node.defaultDuration).toBe('2n')
  })
})

describe('Track Fluent API', () => {
  // Common setup
  const clip = Clip.melody().note('C4').build()
  const inst = Instrument.synth('Test')

  it('should set tempo fluently', () => {
    const t = Track.from(clip, inst).tempo(140)
    expect(t.build().tempo).toBe(140)
  })

  it('should set timeSignature fluently', () => {
    const t = Track.from(clip, inst).timeSignature('7/8')
    expect(t.build().timeSignature).toBe('7/8')
  })

  it('should set defaultDuration fluently', () => {
    const t = Track.from(clip, inst).defaultDuration('2n')
    expect(t.build().defaultDuration).toBe('2n')
  })

  it('should chain multiple fluent calls', () => {
    const t = Track.from(clip, inst)
      .tempo(100)
      .timeSignature('6/8')
      .defaultDuration('8n')
    
    const node = t.build()
    expect(node.tempo).toBe(100)
    expect(node.timeSignature).toBe('6/8')
    expect(node.defaultDuration).toBe('8n')
  })

  it('should remain immutable', () => {
    const t1 = Track.from(clip, inst)
    const t2 = t1.tempo(120)
    
    expect(t1.build().tempo).toBeUndefined()
    expect(t2.build().tempo).toBe(120)
    expect(t1).not.toBe(t2)
  })

  it('should accept options in factory for backward compatibility', () => {
    const t = Track.from(clip, inst, { tempo: 130, timeSignature: '9/8', defaultDuration: '1n' })
    const node = t.build()
    expect(node.tempo).toBe(130)
    expect(node.timeSignature).toBe('9/8')
    expect(node.defaultDuration).toBe('1n')
  })
})
