import { Clip } from '..'
import { applyKeySignature, isValidKey, getKeyAccidentals } from '../theory/keys'
import { parseRomanNumeral, degreeToRoot, romanToChord, progressionToChords, PROGRESSION_PRESETS } from '../theory/progressions'
import { voiceLeadChords, voiceMovementDistance } from '../theory/voiceleading'

// Helper to get first note from a clip
function firstNote(clip: any): string | undefined {
  const notes = clip.operations.filter((o: any) => o.kind === 'note')
  return notes[0]?.note
}

// Helper to get all notes from a clip
function allNotes(clip: any): string[] {
  return clip.operations
    .filter((o: any) => o.kind === 'note')
    .map((o: any) => o.note)
}

// Helper to get all chords (stacks) from a clip
function allChords(clip: any): string[][] {
  return clip.operations
    .filter((o: any) => o.kind === 'stack')
    .map((stack: any) => 
      stack.operations
        .filter((o: any) => o.kind === 'note')
        .map((o: any) => o.note)
    )
}

describe('Key Signatures', () => {
  describe('applyKeySignature', () => {
    it('applies sharps in G major', () => {
      expect(applyKeySignature('F4', { root: 'G', mode: 'major' })).toBe('F#4')
    })

    it('applies sharps in D major (F# and C#)', () => {
      expect(applyKeySignature('F4', { root: 'D', mode: 'major' })).toBe('F#4')
      expect(applyKeySignature('C4', { root: 'D', mode: 'major' })).toBe('C#4')
      expect(applyKeySignature('G4', { root: 'D', mode: 'major' })).toBe('G4')
    })

    it('applies flats in F major', () => {
      expect(applyKeySignature('B4', { root: 'F', mode: 'major' })).toBe('Bb4')
    })

    it('applies flats in Bb major', () => {
      expect(applyKeySignature('B4', { root: 'Bb', mode: 'major' })).toBe('Bb4')
      expect(applyKeySignature('E4', { root: 'Bb', mode: 'major' })).toBe('Eb4')
    })

    it('respects override accidental - natural', () => {
      expect(applyKeySignature('F4', { root: 'G', mode: 'major' }, 'natural')).toBe('F4')
    })

    it('respects override accidental - sharp', () => {
      expect(applyKeySignature('C4', undefined, 'sharp')).toBe('C#4')
    })

    it('respects override accidental - flat', () => {
      expect(applyKeySignature('D4', undefined, 'flat')).toBe('Db4')
    })

    it('does not override notes with existing accidentals', () => {
      expect(applyKeySignature('F#4', { root: 'C', mode: 'major' })).toBe('F#4')
      expect(applyKeySignature('Bb4', { root: 'G', mode: 'major' })).toBe('Bb4')
    })

    it('handles minor keys', () => {
      // A minor = no accidentals
      expect(applyKeySignature('F4', { root: 'A', mode: 'minor' })).toBe('F4')
      // E minor = F#
      expect(applyKeySignature('F4', { root: 'E', mode: 'minor' })).toBe('F#4')
      // D minor = Bb
      expect(applyKeySignature('B4', { root: 'D', mode: 'minor' })).toBe('Bb4')
    })
  })

  describe('MelodyBuilder.key()', () => {
    it('applies key signature to notes', () => {
      const clip = Clip.melody()
        .key('G', 'major')
        .note('F4')
        .build()
      
      expect(firstNote(clip)).toBe('F#4')
    })

    it('applies multiple accidentals', () => {
      const clip = Clip.melody()
        .key('D', 'major')
        .note('F4')
        .note('C4')
        .note('G4')
        .build()
      
      expect(allNotes(clip)).toEqual(['F#4', 'C#4', 'G4'])
    })

    it('respects explicit accidentals via accidental()', () => {
      const clip = Clip.melody()
        .key('G', 'major')
        .accidental('natural')
        .note('F4')
        .note('F4')  // Should be F# again
        .build()
      
      expect(allNotes(clip)).toEqual(['F4', 'F#4'])
    })

    it('natural() cursor modifier overrides key', () => {
      const clip = Clip.melody()
        .key('G', 'major')
        .note('F4').natural()
        .note('F4')
        .build()
      
      expect(allNotes(clip)).toEqual(['F4', 'F#4'])
    })
  })

  describe('validation', () => {
    it('isValidKey returns true for valid keys', () => {
      expect(isValidKey('C', 'major')).toBe(true)
      expect(isValidKey('G', 'major')).toBe(true)
      expect(isValidKey('F#', 'major')).toBe(true)
      expect(isValidKey('A', 'minor')).toBe(true)
    })

    it('isValidKey returns false for invalid keys', () => {
      expect(isValidKey('H', 'major')).toBe(false)
      expect(isValidKey('C', 'dorian' as any)).toBe(false)
    })

    it('getKeyAccidentals returns correct accidentals', () => {
      expect(getKeyAccidentals({ root: 'G', mode: 'major' })).toEqual({ F: 'sharp' })
      expect(getKeyAccidentals({ root: 'F', mode: 'major' })).toEqual({ B: 'flat' })
    })
  })
})

describe('Chord Progressions', () => {
  describe('parseRomanNumeral', () => {
    it('parses basic numerals', () => {
      expect(parseRomanNumeral('I', 'major').degree).toBe(1)
      expect(parseRomanNumeral('ii', 'major').degree).toBe(2)
      expect(parseRomanNumeral('V', 'major').degree).toBe(5)
    })

    it('parses seventh chords', () => {
      expect(parseRomanNumeral('V7', 'major').quality).toBe('7')
      expect(parseRomanNumeral('ii7', 'major').quality).toBe('m7')
    })

    it('parses diminished', () => {
      expect(parseRomanNumeral('viidim', 'major').quality).toBe('dim')
    })
  })

  describe('degreeToRoot', () => {
    it('returns correct root for C major', () => {
      const key = { root: 'C' as const, mode: 'major' as const }
      expect(degreeToRoot(1, key)).toBe('C')
      expect(degreeToRoot(4, key)).toBe('F')
      expect(degreeToRoot(5, key)).toBe('G')
    })

    it('returns correct root for G major', () => {
      const key = { root: 'G' as const, mode: 'major' as const }
      expect(degreeToRoot(1, key)).toBe('G')
      expect(degreeToRoot(4, key)).toBe('C')
      expect(degreeToRoot(5, key)).toBe('D')
    })
  })

  describe('romanToChord', () => {
    it('converts to chord code in C major', () => {
      const key = { root: 'C' as const, mode: 'major' as const }
      expect(romanToChord('I', key)).toBe('C')
      expect(romanToChord('ii', key)).toBe('Dm')
      expect(romanToChord('V7', key)).toBe('G7')
    })

    it('converts to chord code in G major', () => {
      const key = { root: 'G' as const, mode: 'major' as const }
      expect(romanToChord('I', key)).toBe('G')
      expect(romanToChord('IV', key)).toBe('C')
      expect(romanToChord('V', key)).toBe('D')
    })
  })

  describe('progressionToChords', () => {
    it('converts I-IV-V-I in C major', () => {
      const key = { root: 'C' as const, mode: 'major' as const }
      expect(progressionToChords(['I', 'IV', 'V', 'I'], key))
        .toEqual(['C', 'F', 'G', 'C'])
    })
  })

  describe('presets', () => {
    it('has common presets', () => {
      expect(PROGRESSION_PRESETS['pop']).toBeDefined()
      expect(PROGRESSION_PRESETS['blues']).toBeDefined()
      expect(PROGRESSION_PRESETS['jazz-ii-V-I']).toBeDefined()
    })
  })

  describe('MelodyBuilder.progression()', () => {
    it('emits chords for I-IV-V', () => {
      const clip = Clip.melody()
        .key('C', 'major')
        .progression('I', 'IV', 'V')
        .build()

      const chords = allChords(clip)
      expect(chords).toHaveLength(3)
    })

    it('throws without key context', () => {
      expect(() => {
        Clip.melody().progression('I', 'IV', 'V').build()
      }).toThrow('key()')
    })
  })
})

describe('Voice Leading', () => {
  describe('voiceLeadChords', () => {
    it('minimizes voice movement', () => {
      const chords = [
        ['C4', 'E4', 'G4', 'C5'],     // C major
        ['D4', 'F4', 'A4', 'D5'],     // D minor
        ['G3', 'B3', 'D4', 'G4']      // G major
      ] as any

      const voiced = voiceLeadChords(chords)
      
      // Should have 3 chords
      expect(voiced).toHaveLength(3)
      
      // Voice movement should be relatively small
      if (voiced.length >= 2) {
        const movement = voiceMovementDistance(voiced[0], voiced[1])
        expect(movement).toBeLessThan(24) // Less than 2 octaves of movement
      }
    })
  })

  describe('voiceMovementDistance', () => {
    it('calculates total semitone movement', () => {
      const from = ['C4', 'E4', 'G4', 'C5'] as any
      const to = ['C4', 'F4', 'A4', 'C5'] as any
      
      const distance = voiceMovementDistance(from, to)
      // E4 -> F4 = 1, G4 -> A4 = 2
      expect(distance).toBeGreaterThan(0)
    })
  })

  describe('MelodyBuilder.voiceLead()', () => {
    it('emits voice-led chords', () => {
      const clip = Clip.melody()
        .key('C', 'major')
        .voiceLead(['ii', 'V', 'I'])
        .build()

      const chords = allChords(clip)
      expect(chords).toHaveLength(3)
    })

    it('throws without key context', () => {
      expect(() => {
        Clip.melody().voiceLead(['I', 'IV', 'V']).build()
      }).toThrow('key()')
    })
  })
})

describe('Edge Cases (RFC-027.1)', () => {
  describe('Modal Interchange', () => {
    it('handles bVII in C major', () => {
      expect(romanToChord('bVII', { root: 'C', mode: 'major' })).toBe('Bb')
    })

    it('handles bIII in C major', () => {
      expect(romanToChord('bIII', { root: 'C', mode: 'major' })).toBe('Eb')
    })

    it('handles bVI in C major', () => {
      expect(romanToChord('bVI', { root: 'C', mode: 'major' })).toBe('Ab')
    })

    it('handles #IV in C major', () => {
      expect(romanToChord('#IV', { root: 'C', mode: 'major' })).toBe('F#')
    })

    it('parses accidental in ParsedRomanNumeral', () => {
      const parsed = parseRomanNumeral('bVII', 'major')
      expect(parsed.accidental).toBe('b')
      expect(parsed.degree).toBe(7)
    })
  })

  describe('Secondary Dominants', () => {
    it('handles V/V in C major (D major)', () => {
      expect(romanToChord('V/V', { root: 'C', mode: 'major' })).toBe('D')
    })

    it('handles V7/ii in C major (A7)', () => {
      expect(romanToChord('V7/ii', { root: 'C', mode: 'major' })).toBe('A7')
    })

    it('handles V/vi in C major (E major)', () => {
      expect(romanToChord('V/vi', { root: 'C', mode: 'major' })).toBe('E')
    })

    it('handles V7/V in G major (A7)', () => {
      expect(romanToChord('V7/V', { root: 'G', mode: 'major' })).toBe('A7')
    })

    it('parses secondaryTarget in ParsedRomanNumeral', () => {
      const parsed = parseRomanNumeral('V/V', 'major')
      expect(parsed.secondaryTarget).toBe(5)
      expect(parsed.degree).toBe(5)
    })
  })

  describe('Inversions (still work)', () => {
    it('parses I/3 as bass degree 3', () => {
      const parsed = parseRomanNumeral('I/3', 'major')
      expect(parsed.bass).toBe(3)
      expect(parsed.secondaryTarget).toBeUndefined()
    })

    it('parses I/5 as bass degree 5', () => {
      const parsed = parseRomanNumeral('I/5', 'major')
      expect(parsed.bass).toBe(5)
    })
  })

  describe('Enharmonic Notes (already preserved)', () => {
    it('preserves Gb4 in G major (does not change to F#4)', () => {
      expect(applyKeySignature('Gb4', { root: 'G', mode: 'major' })).toBe('Gb4')
    })

    it('preserves F#4 in C major', () => {
      expect(applyKeySignature('F#4', { root: 'C', mode: 'major' })).toBe('F#4')
    })

    it('applies key signature to unaccidentaled notes', () => {
      expect(applyKeySignature('F4', { root: 'G', mode: 'major' })).toBe('F#4')
    })
  })
})
