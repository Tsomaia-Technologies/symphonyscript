/**
 * RFC-031: Live Coding Runtime
 * 
 * Public API for the live coding module.
 */

// Main entry point
export { LiveSession } from './LiveSession'

// Core types
export type {
  QuantizeMode,
  LiveSessionOptions,
  EvalResult,
  BeatCallback,
  BarCallback,
  ErrorCallback,
  LiveSessionEvent,
  Unsubscribe,
  ScheduledEvent,
  PendingUpdate,
  StreamingSchedulerConfig,
  TrackState,
  LiveSessionState,
  ScheduledCallback
} from './types'

// Backend types and implementations
export type {
  AudioBackend,
  WebAudioBackendOptions,
  MIDIBackendOptions,
  TrackInstrumentMap,
  BackendInstrumentConfig,
  ScheduledNodeInfo,
  BackendState
} from './backends/types'

export { WebAudioBackend } from '@symphonyscript/runtime-webaudio'
export { MIDIBackend } from './backends/MIDIBackend'

// Quantize utilities
export {
  parseTimeSignature,
  getNextBeat,
  getNextBarBeat,
  getCurrentBar,
  getBeatInBar,
  getQuantizeTargetBeat,
  beatsToSeconds,
  secondsToBeats,
  getBeatDuration,
  getBarDuration,
  isWithinLookahead,
  getEffectiveCancelBeat,
  getCurrentBeatFromAudioTime,
  getAudioTimeForBeat,
  // Phase 5: Beat-grid synchronization
  isAtQuantizeBoundary,
  getTimeUntilNextQuantize,
  getQuantizeTargetWithLookahead,
  getBeatGridInfo
} from './quantize'

// Streaming scheduler
export {
  StreamingScheduler,
  DEFAULT_LOOKAHEAD,
  DEFAULT_SCHEDULE_INTERVAL
} from './StreamingScheduler'

// Eval utilities (for advanced usage)
export {
  createEvalContext,
  safeEval,
  diffSessions,
  mergeTracksIntoSession,
  preprocessCode,
  validateCode
} from './eval'
export type {
  SafeEvalResult,
  TrackDefinition,
  EvalContext,
  TrackBuilder
} from './eval'

// File watcher (Phase 6)
export {
  createFileWatcher,
  NodeFileWatcher,
  ChokidarWatcher,
  isChokidarAvailable
} from './watcher'
export type {
  FileWatcher,
  WatcherOptions,
  FileChangeEvent,
  FileChangeHandler
} from './watcher'
