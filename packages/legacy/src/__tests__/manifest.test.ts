import { clip } from '../clip/ClipBuilder'
import { MelodyBuilder } from '../clip/MelodyBuilder'
import { compileClip } from '../compiler/pipeline'
import { CC } from '@symphonyscript/core/types/midi'
import { InstrumentId, unsafeInstrumentId } from '@symphonyscript/core/types/primitives'

describe('Phase 1: Manifest & Contracts', () => {

  it('should generate an empty manifest for a rest clip', () => {
    const c = clip('Empty').rest('1n')
    const compiled = compileClip(c.build(), { bpm: 120 })

    expect(compiled.manifest).toBeDefined()
    expect(compiled.manifest?.pitchBendRange).toBe(2)
    expect(compiled.manifest?.controllersUsed).toEqual([])
    // keys might be empty or present depending on logic (rest usually doesn't emit note events but might exist in a channel)
  })

  it('should detect controllers used', () => {
    const m = new MelodyBuilder({ name: 'ControlTest' })
      .note('C4').commit() // Commit note to apply timeline effects next
      .pan(0.5) // CC 10 - Timeline op
      .volume(0.8) // CC 7 - Timeline op

    const compiled = compileClip(m.build(), { bpm: 120 })
    const manifest = compiled.manifest!

    expect(manifest.controllersUsed).toContain(CC.Pan)
    expect(manifest.controllersUsed).toContain(CC.Volume)
    expect(manifest.controllersUsed).toHaveLength(2)
  })

  it('should detect pitch bend necessity', () => {
    // Detune > 200 cents
    const m = new MelodyBuilder({ name: 'BendTest' })
      .note('C4').detune(500) // 5 semitones

    const compiled = compileClip(m.build(), { bpm: 120 })
    const manifest = compiled.manifest!

    // Logic: 500 / 100 = 5 semitones. Manifest logic bumps max(2, ceil(5)) = 5?
    // Let's check logic: maxPitchBend = Math.max(maxPitchBend, Math.ceil(absDetune / 100))
    // ceil(500/100) = 5.
    expect(manifest.pitchBendRange).toBe(5)
  })

  it('should detect polyphony', () => {
    // C4 duration 4n. E4 starts at 0.
    // Stack creates simultaneous notes.
    const m = new MelodyBuilder({ name: 'PolyTest' })
      .stack(s => s
        .note('C4', '1n')
        .note('E4', '1n')
        .note('G4', '1n')
      )

    const compiled = compileClip(m.build(), { bpm: 120 })
    const manifest = compiled.manifest!

    // Channel 1 instrument
    const instReq = manifest.instruments[unsafeInstrumentId('channel_1')]
    expect(instReq).toBeDefined()
    expect(instReq.polyphony).toBeGreaterThanOrEqual(3)
  })

  it('should detect features (MPE, Sustain)', () => {
    const m = new MelodyBuilder({ name: 'FeatureTest' })
      .note('C4').timbre(0.5) // MPE
      .control(64, 127) // Sustain

    const compiled = compileClip(m.build(), { bpm: 120 })
    const manifest = compiled.manifest!
    const inst = manifest.instruments[unsafeInstrumentId('channel_1')]

    expect(inst.features).toContain('mpe')
    expect(inst.features).toContain('sustain')
  })
})
