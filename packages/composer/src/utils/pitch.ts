/**
 * Simple pitch parser for Synaptic components.
 * Zero-allocation for common inputs (numbers).
 * @remarks Cold-path operation—called once per note symbol, not per audio frame.
 */

// Pre-computed note offsets: A=9, B=11, C=0, D=2, E=4, F=5, G=7
const NOTE_OFFSETS = [9, 11, 0, 2, 4, 5, 7]; // Maps A-G (charCode 65-71)

export function parsePitch(input: string | number): number {
    if (typeof input === 'number') {
        return input;
    }

    // Zero-allocation character scanner
    let i = 0;
    const len = input.length;

    // 1. Parse note letter [A-G]
    const noteChar = input.charCodeAt(i);
    if (noteChar < 65 || noteChar > 71) {
        throw new Error(`Invalid note letter in pitch: ${input}`);
    }
    const noteBase = NOTE_OFFSETS[noteChar - 65]; // A=65 -> index 0 -> offset 9
    i++;

    // 2. Parse optional accidental [#b]
    let accidental = 0;
    if (i < len) {
        const acc = input.charCodeAt(i);
        if (acc === 35) { // '#'
            accidental = 1;
            i++;
        } else if (acc === 98) { // 'b'
            accidental = -1;
            i++;
        }
    }

    // 3. Parse octave (negative allowed)
    if (i >= len) {
        throw new Error(`Missing octave in pitch: ${input}`);
    }

    let negative = false;
    if (input.charCodeAt(i) === 45) { // '-'
        negative = true;
        i++;
    }

    let octave = 0;
    while (i < len) {
        const d = input.charCodeAt(i) - 48; // '0' = 48
        if (d < 0 || d > 9) {
            throw new Error(`Invalid octave digit in pitch: ${input}`);
        }
        octave = octave * 10 + d;
        i++;
    }
    if (negative) octave = -octave;

    return (octave + 1) * 12 + noteBase + accidental;
}

