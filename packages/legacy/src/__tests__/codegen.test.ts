import { clipToCode, clipsToCode } from '../codegen'
import { Clip } from '@symphonyscript/core'
import type { ClipNode, NoteOp, RestOp, StackOp, TempoOp, TimeSignatureOp } from '../clip/types'
import { SCHEMA_VERSION } from '@symphonyscript/core/schema/version'

// --- Test Helpers ---

function createTestClip(name: string, operations: ClipNode['operations']): ClipNode {
  return {
    _version: SCHEMA_VERSION,
    kind: 'clip',
    name,
    operations
  }
}

// --- clipToCode Tests ---

describe('Code Generator', () => {
  describe('clipToCode', () => {
    it('generates import statement by default', () => {
      const clip = createTestClip('test', [])
      const code = clipToCode(clip)

      expect(code).toContain("import { Clip } from 'symphonyscript'")
    })

    it('omits import when includeImports is false', () => {
      const clip = createTestClip('test', [])
      const code = clipToCode(clip, 'test', { includeImports: false })

      expect(code).not.toContain('import')
    })

    it('generates correct clip name', () => {
      const clip = createTestClip('MyMelody', [])
      const code = clipToCode(clip, 'myMelody')

      expect(code).toContain("Clip.melody('MyMelody')")
      expect(code).toContain('const myMelody = ')
    })

    it('exports clips by default', () => {
      const clip = createTestClip('test', [])
      const code = clipToCode(clip)

      expect(code).toContain('export const')
    })

    it('generates note with pitch and duration', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }
      ])
      const code = clipToCode(clip)

      expect(code).toContain(".note('C4', '4n')")
    })

    it('generates note with velocity modifier', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 0.8 }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.velocity(0.8)')
    })

    it('generates note with articulation', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1, articulation: 'staccato' }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.staccato()')
    })

    it('generates rest', () => {
      const clip = createTestClip('test', [
        { kind: 'rest', duration: '4n' }
      ])
      const code = clipToCode(clip)

      expect(code).toContain(".rest('4n')")
    })

    it('generates tempo', () => {
      const clip = createTestClip('test', [
        { kind: 'tempo', bpm: 120 }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.tempo(120)')
    })

    it('generates time signature', () => {
      const clip = createTestClip('test', [
        { kind: 'time_signature', signature: '3/4' as any }
      ])
      const code = clipToCode(clip)

      expect(code).toContain(".timeSignature('3/4')")
    })

    it('generates chord (StackOp) as .chord()', () => {
      const clip = createTestClip('test', [
        {
          kind: 'stack',
          operations: [
            { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 },
            { kind: 'note', note: 'E4' as any, duration: '4n', velocity: 1 },
            { kind: 'note', note: 'G4' as any, duration: '4n', velocity: 1 }
          ]
        }
      ])
      const code = clipToCode(clip)

      expect(code).toContain(".chord(['C4', 'E4', 'G4'], '4n')")
    })

    it('generates control change', () => {
      const clip = createTestClip('test', [
        { kind: 'control', controller: 64, value: 127 }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.control(64, 127)')
    })

    it('generates loop', () => {
      const clip = createTestClip('test', [
        {
          kind: 'loop',
          count: 4,
          operations: [
            { kind: 'note', note: 'C4' as any, duration: '8n', velocity: 1 }
          ]
        }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.loop(4, b => b')
      expect(code).toContain(".note('C4', '8n')")
    })

    it('generates transpose', () => {
      const clip = createTestClip('test', [
        {
          kind: 'transpose',
          semitones: 2,
          operation: { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }
        }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.transpose(2)')
    })

    it('generates tie modifier', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1, tie: 'start' }
      ])
      const code = clipToCode(clip)

      expect(code).toContain(".tie('start')")
    })

    it('generates humanize modifier', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1, humanize: { timing: 10, velocity: 0.05 } }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.humanize({ timing: 10, velocity: 0.05 })')
    })

    it('generates precise() for null humanize', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1, humanize: null }
      ])
      const code = clipToCode(clip)

      expect(code).toContain('.precise()')
    })

    it('ends with .build()', () => {
      const clip = createTestClip('test', [])
      const code = clipToCode(clip)

      expect(code).toContain('.build()')
    })

    it('uses single quotes by default', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }
      ])
      const code = clipToCode(clip)

      expect(code).toContain("'C4'")
      expect(code).not.toContain('"C4"')
    })

    it('uses double quotes when singleQuotes is false', () => {
      const clip = createTestClip('test', [
        { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }
      ])
      const code = clipToCode(clip, 'test', { singleQuotes: false })

      expect(code).toContain('"C4"')
    })

    it('includes clip-level tempo', () => {
      const clip: ClipNode = {
        ...createTestClip('test', []),
        tempo: 140
      }
      const code = clipToCode(clip)

      expect(code).toContain('.tempo(140)')
    })

    it('includes clip-level time signature', () => {
      const clip: ClipNode = {
        ...createTestClip('test', []),
        timeSignature: '6/8' as any
      }
      const code = clipToCode(clip)

      expect(code).toContain(".timeSignature('6/8')")
    })

    it('sanitizes variable names', () => {
      const clip = createTestClip('My Melody!@#', [])
      const code = clipToCode(clip, 'My Melody!@#')

      // Should be converted to a valid JS identifier
      expect(code).toContain('const myMelody')
    })
  })

  describe('clipsToCode', () => {
    it('generates code for multiple clips', () => {
      const clips = [
        createTestClip('Melody', [
          { kind: 'note', note: 'C4' as any, duration: '4n', velocity: 1 }
        ]),
        createTestClip('Bass', [
          { kind: 'note', note: 'C2' as any, duration: '2n', velocity: 1 }
        ])
      ]
      const code = clipsToCode(clips, ['melody', 'bass'])

      expect(code).toContain('const melody = ')
      expect(code).toContain('const bass = ')
      expect(code).toContain("'C4'")
      expect(code).toContain("'C2'")
    })

    it('includes single import statement', () => {
      const clips = [
        createTestClip('A', []),
        createTestClip('B', [])
      ]
      const code = clipsToCode(clips)

      // Should only have one active import (not counting comments)
      // Count lines that start with 'import' (not '// import')
      const activeImports = code.split('\n').filter(line => 
        line.trim().startsWith('import') && !line.trim().startsWith('//')
      )
      expect(activeImports).toHaveLength(1)
    })

    it('includes usage comment', () => {
      const clips = [createTestClip('test', [])]
      const code = clipsToCode(clips, ['test'])

      expect(code).toContain('// To use these clips with instruments:')
      expect(code).toContain('Track.from(test')
    })

    it('generates default names if not provided', () => {
      const clips = [
        createTestClip('First', []),
        createTestClip('Second', [])
      ]
      const code = clipsToCode(clips)

      // Should use clip names
      expect(code).toContain('const first')
      expect(code).toContain('const second')
    })
  })

  describe('Generated Code Validity', () => {
    it('generates syntactically valid TypeScript', () => {
      // Build a complex clip
      const clip = Clip.melody('Complex')
        .tempo(120)
        .timeSignature('4/4')
        .note('C4', '4n').velocity(0.8).staccato()
        .note('E4', '4n').accent()
        .rest('4n')
        .chord(['C4', 'E4', 'G4'] as any, '2n')
        .build()

      const code = clipToCode(clip, 'complex')

      // This tests that the code at least looks reasonable
      expect(code).toContain('Clip.melody')
      expect(code).toContain('.tempo(120)')
      expect(code).toContain(".timeSignature('4/4')")
      expect(code).toContain('.build()')

      // Should not have any obvious syntax errors
      expect(code).not.toContain('undefined')
      expect(code).not.toContain('NaN')
    })

    it('handles empty clips', () => {
      const clip = createTestClip('Empty', [])
      const code = clipToCode(clip)

      expect(code).toContain('Clip.melody')
      expect(code).toContain('.build()')
    })

    it('handles special characters in clip names', () => {
      const clip = createTestClip("It's a \"test\" clip\\n", [])
      const code = clipToCode(clip)

      // Escaped properly
      expect(code).not.toContain("It's")
      expect(code).toContain("\\'")
    })
  })
})
