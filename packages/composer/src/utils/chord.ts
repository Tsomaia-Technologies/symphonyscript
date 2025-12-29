/**
 * Simple chord parser and bitmask packer.
 * Zero-allocation for result structure (returns nothing, caller uses bitmask).
 * 
 * Defines common chord qualities for RFC-049 compliance.
 */

// Chord Definitions (Intervals)
const CHORD_MAP: Record<string, number[]> = {
    // Triads
    '': [0, 4, 7],         // Major
    'maj': [0, 4, 7],
    'm': [0, 3, 7],         // Minor
    'min': [0, 3, 7],
    'dim': [0, 3, 6],         // Diminished
    'aug': [0, 4, 8],         // Augmented

    // 7ths
    'maj7': [0, 4, 7, 11],     // Major 7
    'm7': [0, 3, 7, 10],     // Minor 7
    'min7': [0, 3, 7, 10],
    '7': [0, 4, 7, 10],     // Dominant 7
    'dim7': [0, 3, 6, 9],      // Diminished 7
    'm7b5': [0, 3, 6, 10],     // Half-diminished
    'sus4': [0, 5, 7],
    'sus2': [0, 2, 7],
};

// Pre-computed note offsets for pitch class (same as pitch.ts)
const NOTE_OFFSETS = [9, 11, 0, 2, 4, 5, 7]; // Maps A-G (charCode 65-71)

/**
 * Result container for parseChord (reusable to avoid allocations).
 */
export interface ChordResult {
    root: number;
    mask: number;
}

/**
 * Module-level reusable result object (zero-allocation for hot paths).
 */
const CHORD_RESULT: ChordResult = { root: 0, mask: 0 };

/**
 * Parses chord symbol and writes result to out-parameter.
 * @remarks Zero-allocation by reusing module-level result object.
 */
export function parseChord(symbol: string, out: ChordResult = CHORD_RESULT): ChordResult {
    // Zero-allocation root note extraction
    let i = 0;
    const len = symbol.length;

    if (len === 0) {
        throw new Error('Empty chord symbol');
    }

    // 1. Parse note letter [A-G]
    const noteChar = symbol.charCodeAt(i);
    if (noteChar < 65 || noteChar > 71) {
        throw new Error(`Invalid chord root note: ${symbol}`);
    }
    const noteBase = NOTE_OFFSETS[noteChar - 65];
    i++;

    // 2. Parse optional accidental [#b]
    let accidental = 0;
    if (i < len) {
        const acc = symbol.charCodeAt(i);
        if (acc === 35) { // '#'
            accidental = 1;
            i++;
        } else if (acc === 98) { // 'b'
            accidental = -1;
            i++;
        }
    }

    // Calculate root pitch (default to middle C octave range: C4 = 60)
    const pitchClass = (noteBase + accidental + 12) % 12;
    const rootPitch = 60 + pitchClass; // C4 = 60, G4 = 67, etc.

    // 3. Extract chord suffix (substring allocation acceptable for CHORD_MAP lookup)
    const suffix = symbol.slice(i);

    const intervals = CHORD_MAP[suffix];
    if (!intervals) {
        throw new Error(`Unknown chord quality: "${suffix}"`);
    }

    let mask = 0;
    for (let j = 0; j < intervals.length; j++) {
        mask |= (1 << intervals[j]);
    }

    out.root = rootPitch;
    out.mask = mask;
    return out;
}

/**
 * Returns packed mask from intervals.
 */
export function packIntervals(intervals: number[]): number {
    let mask = 0;
    for (let i = 0; i < intervals.length; i++) {
        mask |= (1 << intervals[i]);
    }
    return mask;
}
