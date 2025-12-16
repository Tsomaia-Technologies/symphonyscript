import type { ChordDefinition } from './types'

export const CHORD_DEFINITIONS: ChordDefinition[] = [
  // Major
  {
    quality: 'maj',
    name: 'Major Triad',
    primaryCode: '',
    altCodes: ['maj', 'M'],
    intervals: [0, 4, 7]
  },
  {
    quality: 'maj7',
    name: 'Major Seventh',
    primaryCode: 'maj7',
    altCodes: ['M7', 'Δ', 'Δ7'],
    intervals: [0, 4, 7, 11]
  },
  {
    quality: '6',
    name: 'Major Sixth',
    primaryCode: '6',
    altCodes: ['M6'],
    intervals: [0, 4, 7, 9]
  },
  {
    quality: '6/9',
    name: 'Six-Nine',
    primaryCode: '6/9',
    altCodes: ['69', '6add9'],
    intervals: [0, 4, 7, 9, 14]
  },
  {
    quality: 'maj9',
    name: 'Major Ninth',
    primaryCode: 'maj9',
    altCodes: ['M9', 'Δ9'],
    intervals: [0, 4, 7, 11, 14]
  },
  {
    quality: 'maj11',
    name: 'Major Eleventh',
    primaryCode: 'maj11',
    altCodes: ['M11', 'Δ11'],
    intervals: [0, 4, 7, 11, 14, 17]
  },
  {
    quality: 'maj13',
    name: 'Major Thirteenth',
    primaryCode: 'maj13',
    altCodes: ['M13', 'Δ13'],
    intervals: [0, 4, 7, 11, 14, 17, 21]
  },
  {
    quality: 'add9',
    name: 'Add Nine',
    primaryCode: 'add9',
    altCodes: ['add2'],
    intervals: [0, 4, 7, 14]
  },
  // Minor
  {
    quality: 'm',
    name: 'Minor Triad',
    primaryCode: 'm',
    altCodes: ['-', 'min'],
    intervals: [0, 3, 7]
  },
  {
    quality: 'm7',
    name: 'Minor Seventh',
    primaryCode: 'm7',
    altCodes: ['-7', 'min7'],
    intervals: [0, 3, 7, 10]
  },
  {
    quality: 'm6',
    name: 'Minor Sixth',
    primaryCode: 'm6',
    altCodes: ['-6', 'min6'],
    intervals: [0, 3, 7, 9]
  },
  {
    quality: 'm9',
    name: 'Minor Ninth',
    primaryCode: 'm9',
    altCodes: ['-9', 'min9'],
    intervals: [0, 3, 7, 10, 14]
  },
  {
    quality: 'm11',
    name: 'Minor Eleventh',
    primaryCode: 'm11',
    altCodes: ['-11', 'min11'],
    intervals: [0, 3, 7, 10, 14, 17]
  },
  {
    quality: 'm13',
    name: 'Minor Thirteenth',
    primaryCode: 'm13',
    altCodes: ['-13', 'min13'],
    intervals: [0, 3, 7, 10, 14, 17, 21]
  },
  {
    quality: 'm(maj7)',
    name: 'Minor Major Seventh',
    primaryCode: 'm(maj7)',
    altCodes: ['-Δ7', 'min(maj7)'],
    intervals: [0, 3, 7, 11]
  },
  // Dominant
  {
    quality: '7',
    name: 'Dominant Seventh',
    primaryCode: '7',
    altCodes: ['dom7'],
    intervals: [0, 4, 7, 10]
  },
  {
    quality: '9',
    name: 'Dominant Ninth',
    primaryCode: '9',
    altCodes: ['dom9'],
    intervals: [0, 4, 7, 10, 14]
  },
  {
    quality: '11',
    name: 'Dominant Eleventh',
    primaryCode: '11',
    altCodes: ['dom11'],
    intervals: [0, 4, 7, 10, 14, 17]
  },
  {
    quality: '13',
    name: 'Dominant Thirteenth',
    primaryCode: '13',
    altCodes: ['dom13'],
    intervals: [0, 4, 7, 10, 14, 21]
  },
  {
    quality: '7sus4',
    name: 'Seven Sus Four',
    primaryCode: '7sus4',
    altCodes: ['7sus'],
    intervals: [0, 5, 7, 10]
  },
  {
    quality: '9sus4',
    name: 'Nine Sus Four',
    primaryCode: '9sus4',
    altCodes: ['9sus'],
    intervals: [0, 5, 7, 10, 14]
  },
  // Suspended
  {
    quality: 'sus4',
    name: 'Suspended Fourth',
    primaryCode: 'sus4',
    altCodes: ['sus'],
    intervals: [0, 5, 7]
  },
  {
    quality: 'sus2',
    name: 'Suspended Second',
    primaryCode: 'sus2',
    altCodes: ['2'],
    intervals: [0, 2, 7]
  },
  // Power
  {
    quality: '5',
    name: 'Power Chord',
    primaryCode: '5',
    altCodes: ['(no3)'],
    intervals: [0, 7]
  },
  // Diminished
  {
    quality: 'dim',
    name: 'Diminished Triad',
    primaryCode: 'dim',
    altCodes: ['°'],
    intervals: [0, 3, 6]
  },
  {
    quality: 'dim7',
    name: 'Diminished Seventh',
    primaryCode: 'dim7',
    altCodes: ['°7'],
    intervals: [0, 3, 6, 9]
  },
  {
    quality: 'm7b5',
    name: 'Half-Diminished 7th',
    primaryCode: 'm7b5',
    altCodes: ['ø', 'ø7'],
    intervals: [0, 3, 6, 10]
  },
  // Augmented
  {
    quality: 'aug',
    name: 'Augmented Triad',
    primaryCode: 'aug',
    altCodes: ['+'],
    intervals: [0, 4, 8]
  },
  {
    quality: 'aug7',
    name: 'Augmented Seventh',
    primaryCode: 'aug7',
    altCodes: ['+7', '7#5'],
    intervals: [0, 4, 8, 10]
  },
  {
    quality: 'maj7#5',
    name: 'Augmented Major 7th',
    primaryCode: 'maj7#5',
    altCodes: ['Δ+', 'Δ#5'],
    intervals: [0, 4, 8, 11]
  },
  // Altered
  {
    quality: '7b9',
    name: 'Seven Flat Nine',
    primaryCode: '7b9',
    altCodes: ['7-9'],
    intervals: [0, 4, 7, 10, 13]
  },
  {
    quality: '7#9',
    name: 'Seven Sharp Nine',
    primaryCode: '7#9',
    altCodes: ['7+9'],
    intervals: [0, 4, 7, 10, 15]
  },
  {
    quality: '7b5',
    name: 'Seven Flat Five',
    primaryCode: '7b5',
    altCodes: ['7-5'],
    intervals: [0, 4, 6, 10]
  },
  {
    quality: '7alt',
    name: 'Altered Dominant',
    primaryCode: '7alt',
    altCodes: [],
    intervals: [0, 4, 6, 10, 13, 15, 18, 20]
  }
]
