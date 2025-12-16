// =============================================================================
// SymphonyScript - Clip Domain Exports
// =============================================================================

// Types
export * from './types'

// Core
export { OpChain } from './OpChain'
export { ClipBuilder, clip } from './ClipBuilder'
export * from './cursors'

// Specialized Builders
export { MelodyBuilder } from './MelodyBuilder'
export { KeyboardBuilder } from './KeyboardBuilder'
export { StringBuilder } from './StringBuilder'
export { WindBuilder } from './WindBuilder'
export { DrumBuilder } from './DrumBuilder'

// Actions
export * as Actions from './actions'

// Import builders for factory
import { ClipBuilder } from './ClipBuilder'
import { MelodyBuilder } from './MelodyBuilder'
import { KeyboardBuilder } from './KeyboardBuilder'
import { StringBuilder } from './StringBuilder'
import { WindBuilder } from './WindBuilder'
import { DrumBuilder } from './DrumBuilder'
import type { NoteName } from '../types/primitives'

// =============================================================================
// Clip Factory (Entry Point)
// =============================================================================

/** Factory for creating musical clips. Start here! */
export const ClipFactory = {
  /** Create a base clip (generic ops) */
  create: (name?: string) => new ClipBuilder({ name: name ?? 'Clip' }),

  /** Create a melody builder */
  melody: (name?: string) => new MelodyBuilder({ name: name ?? 'Melody', transposition: 0 }),

  /** Create a keyboard builder (with sustain pedal) */
  keys: (name?: string) => new KeyboardBuilder({ name: name ?? 'Keys', transposition: 0 }),

  /** Create a string builder (with bend, slide, vibrato) */
  strings: (name?: string) => new StringBuilder({ name: name ?? 'Strings', transposition: 0 }),

  /** Create a wind builder (with breath control) */
  wind: (name?: string) => new WindBuilder({ name: name ?? 'Wind', transposition: 0 }),

  /** Create a drum builder (optionally with custom mapping) */
  drums: (name?: string, mapping?: Record<string, NoteName>) =>
    new DrumBuilder({ name: name ?? 'Drums', drumMap: mapping })
}






