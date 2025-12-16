import { 
  importMidi, 
  importMidiAsClip, 
  importMusicXML, 
  importMusicXMLAsClip,
  parseMidiBuffer
} from '../import'
import { compile, session, Track, Instrument, Clip } from '../index'
import type { NoteOp, StackOp, TempoOp, TimeSignatureOp, RestOp } from '../clip/types'

// --- Test Fixtures ---

/**
 * Create a minimal valid MIDI file buffer.
 * Format 0, single track, 480 PPQ
 */
function createSimpleMidiBuffer(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64) // 'MThd'
  bytes.push(0x00, 0x00, 0x00, 0x06) // Header length = 6
  bytes.push(0x00, 0x00)             // Format 0
  bytes.push(0x00, 0x01)             // 1 track
  bytes.push(0x01, 0xE0)             // 480 PPQ

  // MTrk track chunk
  const trackData: number[] = []

  // Delta 0: Note On C4 (note 60), velocity 100
  trackData.push(0x00)              // Delta time = 0
  trackData.push(0x90, 60, 100)     // Note On, channel 0

  // Delta 480: Note Off C4 (1 beat = quarter note)
  trackData.push(0x83, 0x60)        // Delta time = 480 (VLQ)
  trackData.push(0x80, 60, 0)       // Note Off, channel 0

  // Delta 0: Note On E4 (note 64), velocity 80
  trackData.push(0x00)
  trackData.push(0x90, 64, 80)

  // Delta 480: Note Off E4
  trackData.push(0x83, 0x60)
  trackData.push(0x80, 64, 0)

  // Delta 0: End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  // MTrk header
  bytes.push(0x4D, 0x54, 0x72, 0x6B) // 'MTrk'
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

/**
 * Create a MIDI file with tempo and time signature.
 */
function createMidiWithTempo(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64) // 'MThd'
  bytes.push(0x00, 0x00, 0x00, 0x06) // Header length = 6
  bytes.push(0x00, 0x00)             // Format 0
  bytes.push(0x00, 0x01)             // 1 track
  bytes.push(0x01, 0xE0)             // 480 PPQ

  // MTrk track chunk
  const trackData: number[] = []

  // Delta 0: Time signature 4/4
  trackData.push(0x00)
  trackData.push(0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08)

  // Delta 0: Tempo = 500000 microseconds per beat = 120 BPM
  trackData.push(0x00)
  trackData.push(0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20)

  // Delta 0: Note On C4
  trackData.push(0x00)
  trackData.push(0x90, 60, 100)

  // Delta 480: Note Off C4
  trackData.push(0x83, 0x60)
  trackData.push(0x80, 60, 0)

  // Delta 0: End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  // MTrk header
  bytes.push(0x4D, 0x54, 0x72, 0x6B) // 'MTrk'
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

/**
 * Create a MIDI file with simultaneous notes (chord).
 */
function createMidiWithChord(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64)
  bytes.push(0x00, 0x00, 0x00, 0x06)
  bytes.push(0x00, 0x00)
  bytes.push(0x00, 0x01)
  bytes.push(0x01, 0xE0) // 480 PPQ

  const trackData: number[] = []

  // Delta 0: Note On C4, E4, G4 (C major chord)
  trackData.push(0x00)
  trackData.push(0x90, 60, 100) // C4
  trackData.push(0x00)
  trackData.push(0x90, 64, 100) // E4
  trackData.push(0x00)
  trackData.push(0x90, 67, 100) // G4

  // Delta 480: Note Off all
  trackData.push(0x83, 0x60)
  trackData.push(0x80, 60, 0)
  trackData.push(0x00)
  trackData.push(0x80, 64, 0)
  trackData.push(0x00)
  trackData.push(0x80, 67, 0)

  // End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  bytes.push(0x4D, 0x54, 0x72, 0x6B)
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

/**
 * Create a simple MusicXML string.
 */
function createSimpleMusicXML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <rest/>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`
}

/**
 * Create MusicXML with a chord.
 */
function createMusicXMLWithChord(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
      </note>
    </measure>
  </part>
</score-partwise>`
}

/**
 * Create a MIDI file with triplet note (eighth triplet = 320 ticks at 480 PPQ).
 */
function createMidiWithTriplet(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64) // 'MThd'
  bytes.push(0x00, 0x00, 0x00, 0x06) // Header length = 6
  bytes.push(0x00, 0x00)             // Format 0
  bytes.push(0x00, 0x01)             // 1 track
  bytes.push(0x01, 0xE0)             // 480 PPQ

  const trackData: number[] = []

  // Delta 0: Note On C4
  trackData.push(0x00)
  trackData.push(0x90, 60, 100)

  // Delta 160: Note Off C4 (1/3 of quarter note = 8t = 160 ticks at 480 PPQ)
  trackData.push(0x81, 0x20)         // 160 in VLQ
  trackData.push(0x80, 60, 0)

  // End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  bytes.push(0x4D, 0x54, 0x72, 0x6B) // 'MTrk'
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

/**
 * Create a MIDI file with pitch bend before a note.
 */
function createMidiWithPitchBend(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64) // 'MThd'
  bytes.push(0x00, 0x00, 0x00, 0x06) // Header length = 6
  bytes.push(0x00, 0x00)             // Format 0
  bytes.push(0x00, 0x01)             // 1 track
  bytes.push(0x01, 0xE0)             // 480 PPQ

  const trackData: number[] = []

  // Delta 0: Pitch Bend +1 semitone (8192 + 4096 = 12288)
  // 12288 = 0x3000, LSB = 0x00, MSB = 0x60
  trackData.push(0x00)
  trackData.push(0xE0, 0x00, 0x60)   // Pitch bend channel 0

  // Delta 0: Note On C4
  trackData.push(0x00)
  trackData.push(0x90, 60, 100)

  // Delta 480: Note Off C4
  trackData.push(0x83, 0x60)
  trackData.push(0x80, 60, 0)

  // End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  bytes.push(0x4D, 0x54, 0x72, 0x6B) // 'MTrk'
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

/**
 * Create a MIDI file with program change.
 */
function createMidiWithProgramChange(): ArrayBuffer {
  const bytes: number[] = []

  // MThd header
  bytes.push(0x4D, 0x54, 0x68, 0x64) // 'MThd'
  bytes.push(0x00, 0x00, 0x00, 0x06) // Header length = 6
  bytes.push(0x00, 0x00)             // Format 0
  bytes.push(0x00, 0x01)             // 1 track
  bytes.push(0x01, 0xE0)             // 480 PPQ

  const trackData: number[] = []

  // Delta 0: Program Change to 5 (Electric Piano)
  trackData.push(0x00)
  trackData.push(0xC0, 0x05)         // Program change channel 0, program 5

  // Delta 0: Note On C4
  trackData.push(0x00)
  trackData.push(0x90, 60, 100)

  // Delta 480: Note Off C4
  trackData.push(0x83, 0x60)
  trackData.push(0x80, 60, 0)

  // End of Track
  trackData.push(0x00)
  trackData.push(0xFF, 0x2F, 0x00)

  bytes.push(0x4D, 0x54, 0x72, 0x6B) // 'MTrk'
  const trackLength = trackData.length
  bytes.push((trackLength >> 24) & 0xFF)
  bytes.push((trackLength >> 16) & 0xFF)
  bytes.push((trackLength >> 8) & 0xFF)
  bytes.push(trackLength & 0xFF)
  bytes.push(...trackData)

  return new Uint8Array(bytes).buffer
}

// --- MIDI Import Tests ---

describe('MIDI Import', () => {
  describe('parseMidiBuffer', () => {
    it('parses a valid MIDI file', () => {
      const buffer = createSimpleMidiBuffer()
      const midi = parseMidiBuffer(buffer)

      expect(midi.format).toBe(0)
      expect(midi.trackCount).toBe(1)
      expect(midi.ppq).toBe(480)
      expect(midi.tracks).toHaveLength(1)
    })

    it('extracts note events', () => {
      const buffer = createSimpleMidiBuffer()
      const midi = parseMidiBuffer(buffer)

      const noteOns = midi.tracks[0].events.filter(e => e.type === 'note_on')
      const noteOffs = midi.tracks[0].events.filter(e => e.type === 'note_off')

      expect(noteOns).toHaveLength(2)
      expect(noteOffs).toHaveLength(2)
    })

    it('throws on invalid MIDI header', () => {
      const invalidBuffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]).buffer
      expect(() => parseMidiBuffer(invalidBuffer)).toThrow(/Invalid MIDI file/)
    })
  })

  describe('importMidi', () => {
    it('converts MIDI to ClipNodes', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidi(buffer)

      expect(result.clips).toHaveLength(1)
      expect(result.names).toHaveLength(1)
      expect(result.warnings).toEqual([])
    })

    it('maps velocity 0-127 to 0-1', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidiAsClip(buffer)

      const noteOps = result.clip.operations.filter(op => op.kind === 'note') as NoteOp[]
      expect(noteOps).toHaveLength(2)

      // First note velocity 100/127 ≈ 0.787
      expect(noteOps[0].velocity).toBeCloseTo(100 / 127, 2)
      // Second note velocity 80/127 ≈ 0.630
      expect(noteOps[1].velocity).toBeCloseTo(80 / 127, 2)
    })

    it('preserves tempo meta events as TempoOp', () => {
      const buffer = createMidiWithTempo()
      const result = importMidiAsClip(buffer)

      const tempoOps = result.clip.operations.filter(op => op.kind === 'tempo') as TempoOp[]
      expect(tempoOps).toHaveLength(1)
      expect(tempoOps[0].bpm).toBe(120)
    })

    it('preserves time signature meta events', () => {
      const buffer = createMidiWithTempo()
      const result = importMidiAsClip(buffer)

      const timeSigOps = result.clip.operations.filter(op => op.kind === 'time_signature') as TimeSignatureOp[]
      expect(timeSigOps).toHaveLength(1)
      expect(timeSigOps[0].signature).toBe('4/4')
    })

    it('groups simultaneous notes into StackOp', () => {
      const buffer = createMidiWithChord()
      const result = importMidiAsClip(buffer)

      const stackOps = result.clip.operations.filter(op => op.kind === 'stack') as StackOp[]
      expect(stackOps).toHaveLength(1)
      expect(stackOps[0].operations).toHaveLength(3)
    })

    it('applies quantization when specified', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidiAsClip(buffer, { quantize: { grid: '4n' } })

      expect(result.clip.operations.length).toBeGreaterThan(0)
    })

    it('mergeAllTracks combines tracks', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidi(buffer, { mergeAllTracks: true })

      expect(result.clips).toHaveLength(1)
      expect(result.names[0]).toBe('Merged')
    })

    it('recognizes triplet durations', () => {
      const buffer = createMidiWithTriplet()
      const result = importMidiAsClip(buffer)

      const noteOps = result.clip.operations.filter(op => op.kind === 'note') as NoteOp[]
      expect(noteOps).toHaveLength(1)
      // 160 ticks at 480 PPQ = 1/3 beat = 8t (eighth triplet)
      expect(noteOps[0].duration).toBe('8t')
    })

    it('captures pitch bend at note onset as detune', () => {
      const buffer = createMidiWithPitchBend()
      const result = importMidiAsClip(buffer)

      const noteOps = result.clip.operations.filter(op => op.kind === 'note') as NoteOp[]
      expect(noteOps).toHaveLength(1)
      // Pitch bend +1 semitone = +100 cents
      // MIDI value 12288 = (12288 - 8192) / 8192 * 200 = 100 cents
      expect(noteOps[0].detune).toBeCloseTo(100, 0)
    })

    it('includes program change in track name', () => {
      const buffer = createMidiWithProgramChange()
      const result = importMidi(buffer)

      expect(result.names[0]).toContain('Program 5')
    })

    it('preserves exact timing when preserveExactTiming is enabled', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidiAsClip(buffer, { preserveExactTiming: true })

      const noteOps = result.clip.operations.filter(op => op.kind === 'note') as NoteOp[]
      // 480 ticks at 480 PPQ = exactly 1 beat
      expect(noteOps[0].duration).toBe(1)
    })
  })

  describe('importMidiAsClip', () => {
    it('returns a single merged clip', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidiAsClip(buffer)

      expect(result.clip).toBeDefined()
      expect(result.clip.kind).toBe('clip')
    })

    it('produces editable AST', () => {
      const buffer = createSimpleMidiBuffer()
      const result = importMidiAsClip(buffer)

      // Verify we can modify the operations
      const originalLength = result.clip.operations.length
      result.clip.operations.push({
        kind: 'rest',
        duration: '4n'
      })

      expect(result.clip.operations.length).toBe(originalLength + 1)
    })
  })
})

// --- MusicXML Import Tests ---

// Check if XML parser is available (fast-xml-parser or @xmldom/xmldom in Node.js)
let xmlParserAvailable = false
try {
  require('fast-xml-parser')
  xmlParserAvailable = true
} catch {
  try {
    require('@xmldom/xmldom')
    xmlParserAvailable = true
  } catch {
    // No XML parser available
  }
}

const describeIfXml = xmlParserAvailable ? describe : describe.skip

describeIfXml('MusicXML Import', () => {
  describe('importMusicXML', () => {
    it('converts MusicXML to ClipNodes', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXML(xml)

      expect(result.clips).toHaveLength(1)
      expect(result.names).toContain('Piano')
    })

    it('extracts notes correctly', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXMLAsClip(xml)

      const noteOps = result.clip.operations.filter(op => op.kind === 'note') as NoteOp[]
      expect(noteOps).toHaveLength(3) // C4, E4, G4
      expect(noteOps[0].note).toBe('C4')
      expect(noteOps[1].note).toBe('E4')
      expect(noteOps[2].note).toBe('G4')
    })

    it('handles rests', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXMLAsClip(xml)

      const restOps = result.clip.operations.filter(op => op.kind === 'rest') as RestOp[]
      expect(restOps).toHaveLength(1)
    })

    it('groups chord notes into StackOp', () => {
      const xml = createMusicXMLWithChord()
      const result = importMusicXMLAsClip(xml)

      const stackOps = result.clip.operations.filter(op => op.kind === 'stack') as StackOp[]
      expect(stackOps).toHaveLength(1)
      expect(stackOps[0].operations).toHaveLength(3)
    })

    it('extracts part names', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXML(xml)

      expect(result.names[0]).toBe('Piano')
    })

    it('applies quantization when specified', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXMLAsClip(xml, { quantize: { grid: '8n' } })

      expect(result.clip.operations.length).toBeGreaterThan(0)
    })

    it('mergeAllParts combines parts', () => {
      const xml = createSimpleMusicXML()
      const result = importMusicXML(xml, { mergeAllParts: true })

      expect(result.clips).toHaveLength(1)
      expect(result.names[0]).toBe('Merged')
    })
  })
})

// --- Round-trip Tests ---

describe('Import Round-trip', () => {
  it('import → modify → compile works for MIDI', () => {
    const buffer = createSimpleMidiBuffer()
    const { clip } = importMidiAsClip(buffer)

    // Add a rest
    clip.operations.push({ kind: 'rest', duration: '4n' })

    // User provides instrument and creates session
    const s = session().add(Track.from(clip, Instrument.synth('Piano')))
    const { output } = compile(s)

    expect(output.timeline.length).toBeGreaterThan(0)
  })

  // Skip MusicXML round-trip if no parser available
  const itIfXml = xmlParserAvailable ? it : it.skip

  itIfXml('import → modify → compile works for MusicXML', () => {
    const xml = createSimpleMusicXML()
    const { clip } = importMusicXMLAsClip(xml)

    // Add a note
    clip.operations.push({
      kind: 'note',
      note: 'A4' as any,
      duration: '4n',
      velocity: 0.8
    })

    const s = session().add(Track.from(clip, Instrument.synth('Piano')))
    const { output } = compile(s)

    expect(output.timeline.length).toBeGreaterThan(0)
  })

  it('multi-track import with user instruments', () => {
    const buffer = createSimpleMidiBuffer()
    const { clips, names } = importMidi(buffer)

    // Should have at least one clip with operations
    expect(clips.length).toBeGreaterThan(0)
    expect(clips[0].operations.length).toBeGreaterThan(0)

    // User assigns instruments with valid IDs (no spaces)
    // Session.add returns a new session (immutable pattern), so we need to chain or reassign
    let s = session()
    for (let i = 0; i < clips.length; i++) {
      const sanitizedName = names[i].replace(/\s+/g, '_')
      s = s.add(Track.from(clips[i], Instrument.synth(sanitizedName)))
    }

    const { output } = compile(s)
    expect(output.timeline.length).toBeGreaterThan(0)
  })
})
