// =============================================================================
// SymphonyScript - Compiler Utilities (Re-exports for backward compatibility)
// =============================================================================

// Re-export all utilities from the new locations
export {beatsToSeconds, parseTimeSignature, parseDuration} from '@symphonyscript/core/util/duration'
export {noteToMidi, midiToNote, transposeNote} from '@symphonyscript/core/util/midi'
export {getArticulationMultiplier} from '@symphonyscript/core/util/articulation'
