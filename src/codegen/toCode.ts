// =============================================================================
// SymphonyScript - Code Generator
// Converts ClipNode AST to TypeScript builder code
// =============================================================================

import type { ClipNode, ClipOperation, NoteOp, RestOp, StackOp, TempoOp, TimeSignatureOp, ControlOp, LoopOp, TransposeOp } from '../clip/types'

/**
 * Options for code generation.
 */
export interface CodeGenOptions {
  /** Include import statements (default: true) */
  includeImports?: boolean
  /** Indent size in spaces (default: 2) */
  indentSize?: number
  /** Use single quotes (default: true) */
  singleQuotes?: boolean
  /** Export the clips (default: true) */
  exportClips?: boolean
}

const DEFAULT_OPTIONS: Required<CodeGenOptions> = {
  includeImports: true,
  indentSize: 2,
  singleQuotes: true,
  exportClips: true
}

/**
 * Generate TypeScript code for a single ClipNode.
 * 
 * @param clip - The ClipNode to convert
 * @param name - Variable name for the clip (default: uses clip.name or 'clip')
 * @param options - Code generation options
 * @returns TypeScript code string
 */
export function clipToCode(
  clip: ClipNode,
  name?: string,
  options?: CodeGenOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const q = opts.singleQuotes ? "'" : '"'
  const varName = sanitizeVarName(name || clip.name || 'clip')

  const lines: string[] = []

  // Import statement
  if (opts.includeImports) {
    lines.push(`import { Clip } from ${q}symphonyscript${q}`)
    lines.push('')
  }

  // Clip builder
  const exportKeyword = opts.exportClips ? 'export ' : ''
  const clipNameStr = clip.name ? `${q}${escapeString(clip.name)}${q}` : ''
  
  lines.push(`${exportKeyword}const ${varName} = Clip.melody(${clipNameStr})`)

  // Add tempo if present
  if (clip.tempo) {
    lines.push(`${indent(opts)}.tempo(${clip.tempo})`)
  }

  // Add time signature if present
  if (clip.timeSignature) {
    lines.push(`${indent(opts)}.timeSignature(${q}${clip.timeSignature}${q})`)
  }

  // Add swing if present
  if (clip.swing) {
    lines.push(`${indent(opts)}.swing(${clip.swing})`)
  }

  // Add operations
  for (const op of clip.operations) {
    const opLines = operationToCode(op, opts, 1)
    lines.push(...opLines)
  }

  // Close with .build()
  lines.push(`${indent(opts)}.build()`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate TypeScript code for multiple ClipNodes.
 * 
 * @param clips - Array of ClipNodes to convert
 * @param names - Variable names for each clip (optional)
 * @param options - Code generation options
 * @returns TypeScript code string
 */
export function clipsToCode(
  clips: ClipNode[],
  names?: string[],
  options?: CodeGenOptions
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const q = opts.singleQuotes ? "'" : '"'

  const lines: string[] = []

  // Single import statement for all clips
  if (opts.includeImports) {
    lines.push(`import { Clip } from ${q}symphonyscript${q}`)
    lines.push('')
  }

  // Generate code for each clip (without individual imports)
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const name = names?.[i] || clip.name || `clip${i + 1}`
    const clipCode = clipToCode(clip, name, { ...opts, includeImports: false })
    lines.push(clipCode)
  }

  // Add comment showing how to use with instruments
  lines.push('// To use these clips with instruments:')
  lines.push('// import { session, Track, Instrument } from \'symphonyscript\'')
  lines.push('//')
  lines.push('// const song = session()')

  for (let i = 0; i < clips.length; i++) {
    const name = sanitizeVarName(names?.[i] || clips[i].name || `clip${i + 1}`)
    lines.push(`//   .add(Track.from(${name}, Instrument.synth('${name}')))`)
  }

  lines.push('')

  return lines.join('\n')
}

// --- Internal Functions ---

function operationToCode(op: ClipOperation, opts: Required<CodeGenOptions>, level: number): string[] {
  const q = opts.singleQuotes ? "'" : '"'
  const ind = indent(opts, level)

  switch (op.kind) {
    case 'note':
      return noteOpToCode(op, opts, level)

    case 'rest':
      return [`${ind}.rest(${q}${op.duration}${q})`]

    case 'stack':
      return stackOpToCode(op, opts, level)

    case 'tempo':
      return [`${ind}.tempo(${op.bpm}${op.transition ? `, ${q}${op.transition}${q}` : ''})`]

    case 'time_signature':
      return [`${ind}.timeSignature(${q}${op.signature}${q})`]

    case 'control':
      return [`${ind}.control(${op.controller}, ${op.value})`]

    case 'loop':
      return loopOpToCode(op, opts, level)

    case 'transpose':
      return transposeOpToCode(op, opts, level)

    case 'clip':
      // Nested clip - generate inline or reference
      return [`${ind}.play(/* nested clip: ${op.clip.name || 'unnamed'} */)`]

    case 'block':
      return [`${ind}.play(/* frozen block */)`]

    case 'dynamics':
      if (op.type === 'crescendo') {
        return [`${ind}.crescendo(${q}${op.duration}${q}${op.from !== undefined ? `, { from: ${op.from}, to: ${op.to ?? 1} }` : ''})`]
      } else if (op.type === 'decrescendo') {
        return [`${ind}.decrescendo(${q}${op.duration}${q}${op.to !== undefined ? `, { to: ${op.to} }` : ''})`]
      }
      return [`${ind}/* dynamics: ${op.type} */`]

    case 'vibrato':
      return [`${ind}.vibrato(${op.depth ?? 0.5}${op.rate ? `, ${op.rate}` : ''})`]

    case 'pitch_bend':
      return [`${ind}/* pitch_bend: ${op.semitones} semitones */`]

    case 'aftertouch':
      return [`${ind}.aftertouch(${op.value}${op.type === 'poly' && op.note ? `, { type: ${q}poly${q}, note: ${q}${op.note}${q} }` : ''})`]

    case 'scope':
      return [`${ind}/* scope isolation */`]

    default:
      return [`${ind}/* unknown operation: ${(op as any).kind} */`]
  }
}

function noteOpToCode(op: NoteOp, opts: Required<CodeGenOptions>, level: number): string[] {
  const q = opts.singleQuotes ? "'" : '"'
  const ind = indent(opts, level)

  let line = `${ind}.note(${q}${op.note}${q}, ${q}${op.duration}${q})`

  // Add modifiers
  if (op.velocity !== undefined && op.velocity !== 1) {
    line += `.velocity(${formatNumber(op.velocity)})`
  }

  if (op.articulation) {
    line += `.${op.articulation}()`
  }

  if (op.tie) {
    line += `.tie(${q}${op.tie}${q})`
  }

  if (op.humanize) {
    const parts: string[] = []
    if (op.humanize.timing) parts.push(`timing: ${op.humanize.timing}`)
    if (op.humanize.velocity) parts.push(`velocity: ${op.humanize.velocity}`)
    if (op.humanize.seed !== undefined) parts.push(`seed: ${op.humanize.seed}`)
    if (parts.length > 0) {
      line += `.humanize({ ${parts.join(', ')} })`
    }
  }

  if (op.humanize === null) {
    line += `.precise()`
  }

  if (op.quantize) {
    const parts: string[] = []
    parts.push(`grid: ${q}${op.quantize.grid}${q}`)
    if (op.quantize.strength !== undefined) parts.push(`strength: ${op.quantize.strength}`)
    if (op.quantize.duration) parts.push(`duration: true`)
    line += `.quantize({ ${parts.join(', ')} })`
  }

  if (op.detune) {
    line += `.detune(${op.detune})`
  }

  if (op.timbre !== undefined) {
    line += `.timbre(${op.timbre})`
  }

  if (op.pressure !== undefined) {
    line += `.pressure(${op.pressure})`
  }

  if (op.glide) {
    line += `.glide(${q}${op.glide.time}${q})`
  }

  return [line]
}

function stackOpToCode(op: StackOp, opts: Required<CodeGenOptions>, level: number): string[] {
  const q = opts.singleQuotes ? "'" : '"'
  const ind = indent(opts, level)

  // Check if all operations are simple notes (can use .chord shorthand)
  const allNotes = op.operations.every(o => o.kind === 'note')

  if (allNotes && op.operations.length > 0) {
    const notes = op.operations as NoteOp[]
    const pitches = notes.map(n => `${q}${n.note}${q}`).join(', ')
    const duration = notes[0].duration
    
    let line = `${ind}.chord([${pitches}], ${q}${duration}${q})`

    // Add shared modifiers from first note
    const firstNote = notes[0]
    if (firstNote.velocity !== undefined && firstNote.velocity !== 1) {
      line += `.velocity(${formatNumber(firstNote.velocity)})`
    }
    if (firstNote.articulation) {
      line += `.${firstNote.articulation}()`
    }

    return [line]
  }

  // Complex stack - use stack() builder
  const lines: string[] = []
  lines.push(`${ind}.stack(b => b`)
  
  for (const childOp of op.operations) {
    const childLines = operationToCode(childOp, opts, level + 1)
    lines.push(...childLines)
  }
  
  lines.push(`${ind})`)
  return lines
}

function loopOpToCode(op: LoopOp, opts: Required<CodeGenOptions>, level: number): string[] {
  const ind = indent(opts, level)
  const lines: string[] = []

  lines.push(`${ind}.loop(${op.count}, b => b`)
  
  for (const childOp of op.operations) {
    const childLines = operationToCode(childOp, opts, level + 1)
    lines.push(...childLines)
  }
  
  lines.push(`${ind})`)
  return lines
}

function transposeOpToCode(op: TransposeOp, opts: Required<CodeGenOptions>, level: number): string[] {
  const ind = indent(opts, level)
  const lines: string[] = []

  lines.push(`${ind}.transpose(${op.semitones})`)
  
  // The wrapped operation
  const childLines = operationToCode(op.operation, opts, level)
  lines.push(...childLines)

  return lines
}

// --- Utility Functions ---

function indent(opts: Required<CodeGenOptions>, level: number = 1): string {
  return ' '.repeat(opts.indentSize * level)
}

function sanitizeVarName(name: string): string {
  // Remove invalid characters, keeping spaces for word boundaries
  let cleaned = name.replace(/[^a-zA-Z0-9_$\s]/g, '')
  
  // Split into words
  const words = cleaned.trim().split(/\s+/).filter(w => w.length > 0)
  
  if (words.length === 0) {
    return 'clip'
  }
  
  // Convert to camelCase
  // First word: keep case but ensure first char is lowercase
  // Subsequent words: capitalize first letter
  let result = words
    .map((word, index) => {
      if (index === 0) {
        // First word: just lowercase the first character
        return word.charAt(0).toLowerCase() + word.slice(1)
      }
      // Subsequent words: capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join('')

  // Ensure it starts with a letter or underscore
  if (!/^[a-zA-Z_$]/.test(result)) {
    result = '_' + result
  }

  return result
}

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function formatNumber(num: number): string {
  // Format to reasonable precision
  if (Number.isInteger(num)) {
    return String(num)
  }
  // Round to 2 decimal places
  const rounded = Math.round(num * 100) / 100
  return String(rounded)
}
