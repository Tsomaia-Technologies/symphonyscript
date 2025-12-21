// =============================================================================
// SymphonyScript - ClipBuilder (Base Builder for ClipNode)
// =============================================================================

import type { ClipNode, ClipOperation, ClipParams, HumanizeSettings, QuantizeSettings, OperationsSource, ScopeIsolation, TempoTransition } from './types'
import type { NoteDuration, TimeSignatureString } from '@symphonyscript/core/types/primitives'
import type { GrooveTemplate } from '@symphonyscript/core/groove/types'
import { OpChain } from './OpChain'
import { compileClip } from '../compiler/pipeline'
import { type BlockCompileOptions, compileBlock } from '../compiler/block'
import type { CompiledBlock } from '../compiler/block/types'

import { mergeParams, ParamUpdater } from './builder-types'
import { SCHEMA_VERSION } from '@symphonyscript/core/schema/version'
import { NoteCursor } from './cursors/NoteCursor'

/**
 * ClipBuilder is the base builder for creating musical clips.
 * Use .build() to get the final ClipNode data structure.
 *
 * @template P - Parameter type (extends ClipParams for specialized builders)
 */
export class ClipBuilder<P extends ClipParams = ClipParams> implements OperationsSource<ClipBuilder<P>> {
  protected readonly _params: Readonly<P>

  constructor(params: P) {
    this._params = Object.freeze({ ...params })
  }

  // --- Backward Compat Accessors (for subclasses) ---
  protected get _name() {
    return this._params.name
  }

  protected get _chain() {
    return this._params.chain
  }

  protected get _tempo() {
    return this._params.tempo
  }

  protected get _timeSignature() {
    return this._params.timeSignature
  }

  protected get _swing() {
    return this._params.swing
  }

  protected get _groove() {
    return this._params.groove
  }

  static create(name: string = 'Untitled Clip'): ClipBuilder {
    return new ClipBuilder({ name })
  }

  /** Build the final ClipNode data structure */
  build(): ClipNode {
    return {
      _version: SCHEMA_VERSION,
      kind: 'clip',
      name: this._params.name,
      operations: this._params.chain?.toArray() ?? [],
      tempo: this._params.tempo,
      timeSignature: this._params.timeSignature,
      swing: this._params.swing,
      groove: this._params.groove
    }
  }

  /** 
   * Returns operations as an array (OperationsSource interface).
   * Used by loop() and other methods that accept external content.
   */
  toOperations(): ClipOperation[] {
    return this._params.chain?.toArray() ?? []
  }

  /**
   * Preview clip as ASCII pattern in console.
   * @param bpm - Tempo for relative timing (default 120)
   */
  preview(bpm: number = 120): this {
    const clip = this.build()
    // Use default 4/4 time signature for preview if not specified
    const compiled = compileClip(clip, { bpm })
    compiled.print?.()
    return this
  }

  /**
   * Set default duration for subsequent notes/chords/rests.
   * Operations without explicit duration will use this value.
   */
  defaultDuration(duration: NoteDuration): this {
    return this._withParams({ defaultDuration: duration } as unknown as ParamUpdater<P>)
  }

  /** Rest (silence) - advances time without playing anything */
  rest(duration?: NoteDuration): this {
    const d = duration ?? this._params.defaultDuration ?? '4n'
    return this.addOp({ kind: 'rest', duration: d })
  }

  /** Add an operation or play another ClipBuilder or FrozenClip or ClipNode */
  play(item: ClipBuilder<any> | ClipOperation | FrozenClip | ClipNode): this {
    if (item instanceof FrozenClip) {
      return this.addOp({ kind: 'block', block: item.block })
    }
    if (item instanceof ClipBuilder) {
      return this.addOp({ kind: 'clip', clip: item.build() })
    }

    // Check for ClipNode (has 'operations' array and kind='clip')
    // We differentiate from ClipOp which has 'clip' property.
    if (item && typeof item === 'object' && item.kind === 'clip') {
      if ('operations' in item && Array.isArray(item.operations)) {
        return this.addOp({ kind: 'clip', clip: item as ClipNode })
      }
    }

    return this.addOp(item as ClipOperation)
  }

  // --- Core Operations ---

  /** Parallel execution - all operations in the builder start at the same time */
  stack(builderFn: (b: this) => this | NoteCursor<this>): this {
    const stackContext = this._createEmptyClone('StackContext')
    const result = builderFn(stackContext)
    const stackContent = (result instanceof NoteCursor) ? result.commit() : result

    return this.addOp({
      kind: 'stack',
      operations: stackContent._params.chain?.toArray() ?? []
    })
  }

  // --- Loop Overloads ---

  /**
   * Loop - repeat a sequence of operations using a builder function.
   * @param count - Number of repetitions
   * @param builderFn - Builder function that receives an empty context
   */
  loop(count: number, builderFn: (b: this) => ClipBuilder<any> | NoteCursor<any>): this

  /**
   * Loop - repeat operations from a compatible OperationsSource.
   * Only accepts builders/cursors of the same type (e.g., MelodyBuilder accepts MelodyBuilder/MelodyNoteCursor).
   * @param count - Number of repetitions
   * @param source - A compatible ClipBuilder or NoteCursor
   */
  loop(count: number, source: OperationsSource<this>): this

  /**
   * Loop - repeat operations from a ClipNode.
   * @param count - Number of repetitions
   * @param clip - A ClipNode data structure
   * @note ClipNode compatibility is not enforced at compile time
   */
  loop(count: number, clip: ClipNode): this

  /** Implementation */
  loop(
    count: number,
    content: ((b: this) => ClipBuilder<any> | NoteCursor<any>) | OperationsSource<any> | ClipNode
  ): this {
    let operations: ClipOperation[]

    if (!content) {
      throw new Error(`loop() expects a content argument (Builder, Function, or Clip), but got ${content}.`)
    }

    if (typeof content === 'function') {
      // Case 1: Builder function
      const loopContext = this._createEmptyClone('LoopContext')
      const result = content(loopContext)
      const loopContent = (result instanceof NoteCursor) ? result.commit() : result
      operations = loopContent?._params?.chain?.toArray() ?? []
    } else if ('toOperations' in content && typeof content.toOperations === 'function') {
      // Case 2: OperationsSource (ClipBuilder or NoteCursor)
      operations = content.toOperations()
    } else if ('operations' in content && Array.isArray(content.operations)) {
      // Case 3: ClipNode
      operations = content.operations
    } else {
      throw new Error('loop() requires a builder function, OperationsSource, or ClipNode')
    }

    return this.addOp({
      kind: 'loop',
      count,
      operations
    })
  }

  /**
   * Set tempo (BPM) for subsequent operations.
   */
  tempo(bpm: number, transition?: NoteDuration | TempoTransition): this {
    let normalizedTransition: NoteDuration | TempoTransition | undefined

    if (transition === undefined) {
      normalizedTransition = undefined
    } else if (typeof transition === 'object' && 'duration' in transition) {
      normalizedTransition = { ...transition }
    } else {
      normalizedTransition = transition
    }

    return this.addOp({ kind: 'tempo', bpm, transition: normalizedTransition })
  }

  /** Set time signature for subsequent operations */
  timeSignature(signature: TimeSignatureString): this {
    return this.addOp({ kind: 'time_signature', signature })
  }

  // --- Tempo, Time Signature & Swing ---

  /**
   * Set swing amount for the clip.
   */
  swing(amount: number): this {
    return this._withParams({ swing: amount } as unknown as ParamUpdater<P>)
  }

  /**
   * Set groove template for the clip.
   * Overrides generic swing.
   */
  groove(template: GrooveTemplate): this {
    return this._withParams({ groove: template } as unknown as ParamUpdater<P>)
  }

  /**
   * Set humanization context for subsequent notes.
   * Notes will have natural timing and velocity variations.
   */
  defaultHumanize(settings: HumanizeSettings): this {
    return this._withParams({ humanize: settings } as unknown as ParamUpdater<P>)
  }

  /**
   * Set quantization context for subsequent notes.
   * Notes will be snapped to the specified grid.
   * 
   * Pipeline order: Quantize → Groove → Humanize
   * - Quantize = Correction ("Fix my bad timing")
   * - Groove = Style ("Make it swing")
   * - Humanize = Randomization ("Make it feel real")
   * 
   * @param grid - Grid division to snap to ('4n', '8n', '16n', etc.)
   * @param options - Optional strength (0-1) and duration quantization
   */
  quantize(grid: NoteDuration, options?: { strength?: number; duration?: boolean }): this {
    return this._withParams({
      quantize: { grid, ...options }
    } as unknown as ParamUpdater<P>)
  }

  /**
   * Send MIDI Control Change (CC) message.
   */
  control(controller: number, value: number): this {
    return this.addOp({ kind: 'control', controller, value })
  }

  /**
   * Compile this clip into a frozen block for incremental compilation.
   * Frozen blocks are cached and not re-expanded when used.
   */
  freeze(options: BlockCompileOptions): FrozenClip {
    const clipNode = this.build()
    const block = compileBlock(clipNode, options)
    return new FrozenClip(block, clipNode)
  }

  /** Create a new instance with updated parameters (preserving subclass type) */
  protected _withParams(updates: ParamUpdater<P>): this {
    const Constructor = this.constructor as new (params: P) => this
    return new Constructor(mergeParams(this._params, updates))
  }

  // --- Helpers ---

  /** Create a fresh empty builder of the same type (for nesting) */
  protected _createEmptyClone(name: string): this {
    // Reset chain to undefined, keep context (tempo, swing, etc)
    const updates: ParamUpdater<P> = {
      name,
      chain: undefined
    } as any

    return this._withParams(updates)
  }

  protected addOp(op: ClipOperation): this {
    const newChain = new OpChain(op, this._params.chain)
    return this._withParams({ chain: newChain } as unknown as ParamUpdater<P>)
  }

  /**
   * Wrap content in an isolated scope.
   * Specified contexts are restored to parent's value on exit.
   * 
   * @param options - What to isolate (e.g. { tempo: true })
   * @param builderFn - Builder function for the inner scope
   */
  isolate(
    options: ScopeIsolation,
    builderFn: (b: this) => this | NoteCursor<this>
  ): this {
    const innerContext = this._createEmptyClone('IsolateContext')
    const result = builderFn(innerContext)
    const innerContent = (result instanceof NoteCursor) ? result.commit() : result
    const operations = innerContent._params.chain?.toArray() ?? []

    // Wrap content in a nested clip structure to separate it conceptually,
    // then wrap that in a ScopeOp.
    const innerClip: ClipOperation = {
      kind: 'clip',
      clip: {
        _version: SCHEMA_VERSION,
        kind: 'clip',
        name: 'IsolatedScope',
        operations
      }
    }

    return this.addOp({
      kind: 'scope',
      isolate: options,
      operation: innerClip
    })
  }
}

/**
 * Wrapper around a pre-compiled block for use in builders.
 */
export class FrozenClip {
  constructor(
    public readonly block: CompiledBlock,
    public readonly sourceClip: ClipNode
  ) {
  }
}

// --- Factory Function (Backward Compatibility) ---

export function clip(name?: string): ClipBuilder {
  return ClipBuilder.create(name)
}
