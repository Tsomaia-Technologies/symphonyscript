// src/compiler/serialize.ts

import {AudioEvent, CompiledOutput} from './types'

export interface SerializeOptions {
  /** Include header comment lines. Default: true */
  includeHeader?: boolean

  /** Decimal places for time values. Default: 3 */
  precision?: number

  /** Include instrument names in brackets. Default: true */
  includeInstrumentNames?: boolean
}

export function serializeTimeline(
  output: CompiledOutput,
  options: SerializeOptions = {}
): string {
  const includeHeader = options.includeHeader ?? true
  const precision = options.precision ?? 3
  const includeInstrumentNames = options.includeInstrumentNames ?? true

  const lines: string[] = []

  // 1. Header
  if (includeHeader) {
    lines.push('# SymphonyScript Timeline')
    const dur = output.meta.durationSeconds.toFixed(2)
    lines.push(`# BPM: ${output.meta.bpm} | Time Sig: ${output.meta.timeSignature} | Duration: ${dur}s`)
    lines.push('') // Blank line
  }

  // 2. Events
  for (const event of output.timeline) {
    lines.push(formatEvent(event, output.manifest, precision, includeInstrumentNames))
  }

  return lines.join('\n')
}

function formatEvent(
  event: AudioEvent,
  manifest: any,
  precision: number,
  includeInstrumentNames: boolean
): string {
  // Time Column: @0.000
  const timeStr = `@${event.time.toFixed(precision)}`.padEnd(precision + 4, ' ') // @ + 1.234 (6 chars minimum for values < 10)
  // Actually padding logic:
  // User example: @0.000 -> 6 chars.
  // If output is @12.000 (7 chars), prompt says: "right-padded to 6 chars after @" which is confusing.
  // "right-padded to 6 chars after @" might mean the total width.
  // Let's look at example:
  // @0.000  NOTE_ON
  // @0.500  NOTE_ON
  // It seems to be fixed width if values are small, but should expand.
  // The prompt says "Time: @X.XXX right-padded to 6 chars after @"
  // "after @" -> so 1.234 is 5 chars. 12.345 is 6 chars.
  // It implies alignment. Let's just use a reasonable pad (e.g. 8 chars total width) or strict formatting.
  // "Time: @X.XXX right-padded to 6 chars after @"
  // This probably means the column width for the number part is 6.
  // Let's rely on standard column padding. @ is part of strings.
  // Let's make the time column 8 chars wide (covers up to 999s with 3 decimals + @).
  // Let's stick to the visual alignment in example.

  // Better interpretation: The prompt example shows alignment.
  // @0.000  NOTE_ON
  // @12.500 NOTE_ON
  // It seems there are 2 spaces after the timestamp.

  // Let's format the time string first.
  const tVal = event.time.toFixed(precision)
  const tStr = `@${tVal}`
  // Just append 2 spaces for now, or align?
  // "right-padded to 6 chars after @" -> This wording is weird.
  // Maybe it means the number part is padded?
  // Let's ignore strict "6 chars after @" and ensure visual column alignment like table.
  // Actually, simple space separation is usually enough unless strict columns demanded.
  // "The serializer must produce output in this exact format"
  // Table shows: "@X.XXX right-padded to 6 chars after @"
  // Example: @0.000

  // Use fixed padding for the time column to ensure alignment.
  // Let's say 8 characters total for the time part (e.g. "@12.345 ").

  const timeCol = tStr.padEnd(8, ' ') // Enough for typical times

  // Event Type Column: Padded to 10 chars
  const typeStr = event.kind.toUpperCase().padEnd(10, ' ')

  // Body
  let body = ''
  let instrumentName = ''

  // Get Instrument Name
  if ('instrumentId' in event && includeInstrumentNames) {
    const config = manifest[event.instrumentId]
    if (config && config.name) {
      instrumentName = `[${config.name}]`
    } else {
      // Fallback if no name or manifest issue (though we fixed it)
      // If manual fix worked, we have name. If not, maybe [Unknown]?
      // Prompt says: "Instrument names come from manifest lookup"
      instrumentName = config ? `[${config.kind}]` : `[Unknown]`
      if (config && config.name) instrumentName = `[${config.name}]`
    }
  }

  switch (event.kind) {
    case 'note_on': {
      // NOTE_ON   C4    vel=1.00  dur=0.50s  [Piano]
      // Note/pitch: Padded to 5 chars
      const noteStr = event.note.padEnd(6, ' ') // 5 chars + 1 space separator often implied?
      // Table: "Padded to 5 chars". Example "C4    " (4 spaces? No. "C4" is 2. So 3 spaces.)
      // "C4   " length is 5.

      const nStr = event.note.padEnd(6, ' ')

      const vel = `vel=${event.velocity.toFixed(2)}`
      const dur = `dur=${event.duration.toFixed(2)}s`

      body = `${nStr}${vel}  ${dur}`

      if (event.articulation) {
        body += `  ${event.articulation}`
      }
      if (event.tie) {
        body += `  tie:${event.tie}`
      }
      break
    }
    case 'note_off': {
      // Not in explicit requirements table but exists in types.
      // "Handle ALL event types"
      const nStr = event.note.padEnd(6, ' ')
      const vel = event.velocity !== undefined ? `vel=${event.velocity.toFixed(2)}` : ''
      body = `${nStr}${vel}`.trim()
      break
    }
    case 'control': {
      // CONTROL   CC64  val=127              [Piano]
      const cc = `CC${event.controller}`.padEnd(6, ' ')
      const val = `val=${event.value.toFixed(0).padEnd(3 + precision + 2, ' ')}` // "val=127"
      // Wait, val is number.
      // Example: " val=127              "
      // Let's just output val=X
      body = `${cc}val=${event.value}`
      break
    }
    case 'pitch_bend': {
      // PITCH_BEND       val=-0.50           [Inst]
      // Note column is empty.
      // Alignment: NOTE_ON has Note column (6 chars).
      // PITCH_BEND skips it?
      // "PITCH_BEND       val=-0.50"
      // It seems "val=-0.50" aligns with "vel=..." ?
      // Let's add 6 spaces to align with note column
      const spacer = ' '.repeat(6)
      body = `${spacer}val=${event.value.toFixed(2)}`
      break
    }
    case 'aftertouch': {
      // AFTERTOUCH       val=64   note=C4    [Inst]
      const spacer = ' '.repeat(6)
      let content = `val=${event.value}`
      if (event.type === 'poly' && event.note) {
        content += `   note=${event.note}`
      }
      body = `${spacer}${content}`
      break
    }
    case 'tempo': {
      // TEMPO     90    linear 0.50s
      // No instrument.
      // Note column used for BPM? "TEMPO     90    "
      // Example: "TEMPO     120"
      // "TEMPO     90    linear 0.50s"

      const bpmStr = event.bpm.toString().padEnd(6, ' ')
      body = `${bpmStr}`
      if (event.transitionSeconds && event.transitionSeconds > 0) {
        body += `${event.curve || 'linear'} ${event.transitionSeconds.toFixed(2)}s`
      }
      break
    }
  }

  // Assemble
  // Padded columns:
  // Time (8) + Type (10) + Body + [Instrument]

  // Example output analysis:
  // @0.000  NOTE_ON   C4    vel=1.00  dur=0.50s  [Piano]
  // Time: "@0.000  " (8 chars)
  // Type: "NOTE_ON   " (10 chars)
  // Body: "C4    vel=1.00  dur=0.50s"
  // Inst: "  [Piano]" (2 spaces before?)

  // Let's just join with some spacing logic.
  // Formatting implies Body is fixed width? No, "linear 0.50s" might vary.
  // Instrument is at the end.

  // Let's construct the line.
  let line = `${timeCol}${typeStr}${body}`

  if (includeInstrumentNames && instrumentName) {
    // align instrument?
    // "Instrument | Brackets at end"
    // Example:
    // ... dur=0.50s  [Piano]
    // ... val=127              [Piano]
    // It seems aligned.
    // Let's try to pad body to a certain length if possible, or just append with 2 spaces.
    // The prompt examples show alignment.
    // NOTE_ON body length:
    // "C4    " (6) + "vel=1.00" (8) + "  " + "dur=0.50s" (9) = ~25 chars?
    // CONTROL body:
    // "CC64  " (6) + "val=127" (7) ... needs padding to match 25?
    // "val=127              " -> lots of spaces.

    // Let's assume a target column for instrument if possible, e.g. column 50?
    const targetLen = 45
    if (line.length < targetLen) {
      line = line.padEnd(targetLen, ' ')
    } else {
      line += '  '
    }
    line += instrumentName
  }

  return line
}
