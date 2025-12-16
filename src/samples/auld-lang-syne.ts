// =============================================================================
// SymphonyScript Sample: Auld Lang Syne (New Year's Eve Classic)
// =============================================================================
// Traditional Scottish song, commonly sung at New Year's Eve celebrations
// Key: G major, 4/4 time, moderate tempo

import { Clip, session, Track, Instrument } from '../index'

/**
 * Main melody of "Auld Lang Syne"
 * 
 * Lyrics reference (first verse):
 * "Should auld acquaintance be forgot, and never brought to mind?
 *  Should auld acquaintance be forgot, and auld lang syne?"
 */
export const auldLangSyneMelody = Clip.melody('Auld Lang Syne - Melody')
  .tempo(84)
  .key('G', 'major')
  .timeSignature('4/4')
  
  // Pickup: "Should"
  .note('D4', '4n')
  
  // Bar 1: "auld ac-quain-tance"
  .note('G4', '4n.')
  .note('G4', '8n')
  .note('B4', '4n')
  .note('G4', '4n')
  
  // Bar 2: "be for-got, and"
  .note('B4', '4n.')
  .note('A4', '8n')
  .note('B4', '4n')
  .note('D5', '4n')
  
  // Bar 3: "nev-er brought to"
  .note('E5', '4n.')
  .note('D5', '8n')
  .note('B4', '4n')
  .note('G4', '4n')
  
  // Bar 4: "mind? Should"
  .note('B4', '4n.')
  .note('A4', '8n')
  .note('D4', '2n')
  
  // Bar 5: "auld ac-quain-tance"
  .note('G4', '4n.')
  .note('G4', '8n')
  .note('B4', '4n')
  .note('G4', '4n')
  
  // Bar 6: "be for-got, and"
  .note('B4', '4n.')
  .note('A4', '8n')
  .note('B4', '2n')
  
  // Bar 7: "auld lang"
  .note('D5', '4n')
  .note('E5', '4n.')
  .note('D5', '8n')
  .note('B4', '4n')
  
  // Bar 8: "syne?"
  .note('G4', '2n.')
  .rest('4n')
  
  .build()

/**
 * Chord accompaniment for "Auld Lang Syne"
 * Simple I-IV-V-I progression in G major
 */
export const auldLangSyneChords = Clip.melody('Auld Lang Syne - Chords')
  .tempo(84)
  .key('G', 'major')
  .timeSignature('4/4')
  
  // Pickup bar - rest
  .rest('4n')
  
  // Bar 1-2: G - G
  .chord(['G3', 'B3', 'D4'], '1n')
  .chord(['G3', 'B3', 'D4'], '1n')
  
  // Bar 3-4: Em - D
  .chord(['E3', 'G3', 'B3'], '1n')
  .chord(['D3', 'F#3', 'A3'], '1n')
  
  // Bar 5-6: G - G
  .chord(['G3', 'B3', 'D4'], '1n')
  .chord(['G3', 'B3', 'D4'], '1n')
  
  // Bar 7-8: C - D - G
  .chord(['C3', 'E3', 'G3'], '2n')
  .chord(['D3', 'F#3', 'A3'], '2n')
  .chord(['G3', 'B3', 'D4'], '1n')
  
  .build()

/**
 * Simple bass line for "Auld Lang Syne"
 */
export const auldLangSyneBass = Clip.melody('Auld Lang Syne - Bass')
  .tempo(84)
  .key('G', 'major')
  .timeSignature('4/4')
  
  // Pickup bar
  .rest('4n')
  
  // Bar 1-2: G
  .note('G2', '2n')
  .note('D2', '2n')
  .note('G2', '2n')
  .note('B2', '2n')
  
  // Bar 3-4: Em - D
  .note('E2', '2n')
  .note('B2', '2n')
  .note('D2', '2n')
  .note('A2', '2n')
  
  // Bar 5-6: G
  .note('G2', '2n')
  .note('D2', '2n')
  .note('G2', '2n')
  .note('B2', '2n')
  
  // Bar 7-8: C - D - G
  .note('C2', '2n')
  .note('D2', '2n')
  .note('G2', '1n')
  
  .build()

/**
 * Full arrangement with all parts
 * 
 * Usage:
 * ```typescript
 * import { auldLangSyneSession } from 'symphonyscript/samples/auld-lang-syne'
 * const { output } = compile(auldLangSyneSession)
 * ```
 */
export const auldLangSyneSession = session()
  .tempo(84)
  .timeSignature('4/4')
  .add(
    Track.from(auldLangSyneMelody, Instrument.synth('Lead'))
  )
  .add(
    Track.from(auldLangSyneChords, Instrument.synth('Pad'))
  )
  .add(
    Track.from(auldLangSyneBass, Instrument.synth('Bass'))
  )
  .build()

// Default export for convenience
export default auldLangSyneSession
