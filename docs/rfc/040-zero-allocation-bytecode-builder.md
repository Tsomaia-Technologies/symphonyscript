# RFC-040: Zero-Allocation Direct Bytecode Builder

**Status**: Draft  
**Target**: `packages/core`  
**Driver**: Zero-Allocation Fluent API, Direct Bytecode Emission  
**Dependencies**: [RFC-038 Symphony Bytecode Standard](./038-symphony-bytecode-standard.md)

---

## 1. Abstract

This RFC refactors `ClipBuilder` to emit bytecode directly during fluent chain construction, eliminating the intermediate AST representation. The builder uses a mutable `number[]` buffer and a recycled cursor pattern, achieving **zero allocations per musical operation**.

**Goals:**
- **Zero Allocation**: No objects created during `.note().velocity().note()` chains
- **Direct Bytecode**: Write raw opcodes to `number[]`
- **Full Transform Support**: Humanize, Quantize, and Groove via bytecode
- **Hybrid Transform API**: Block-scoped (callback) AND atomic (modifier) with smart overloading
- **API Preservation**: Fluent surface syntax unchanged
- **RFC-038 Integration**: Output directly compatible with unified memory VM

---

## 2. Dual Bytecode Format

This RFC introduces a **two-phase bytecode model**:

1. **Builder Bytecode** — Absolute ticks, transform context markers, note modifiers
2. **VM Bytecode** — Relative ticks (RFC-038 format)

The `build()` method compiles Builder Bytecode → VM Bytecode.

---

## 3. Hybrid Transform API with Smart Overloading

Transforms (humanize, quantize, groove) are supported in **two ways**, unified through **smart overloading** that detects intent based on arguments.

### 3.1 The Fluent Interface Ambiguity Problem

Without smart overloading, this chain is ambiguous:

```typescript
Clip.melody()
  .note('C4').humanize({ timing: 0.1 })  // Returns NoteCursor
  .humanize({ timing: 0.5 }, b => ...)   // Which object is this called on?
```

### 3.2 The Solution: Polymorphic Return Type

The `NoteCursor` detects intent based on whether a callback is provided:

| Arguments | Mode | Returns | Bytecode |
|-----------|------|---------|----------|
| `humanize(settings)` | Modifier | `NoteCursor` | `NOTE_MOD_HUMANIZE` |
| `humanize(settings, body)` | Block | `ClipBuilder` | `HUMANIZE_PUSH/POP` |

### 3.3 TypeScript Overload Signatures

```typescript
class NoteCursor {
  // Overload 1: Modifier mode (stays on cursor)
  humanize(settings: HumanizeSettings): this;
  
  // Overload 2: Block mode (escapes to builder)
  humanize(settings: HumanizeSettings, body: (b: ClipBuilder) => void): ClipBuilder;
  
  // Implementation
  humanize(
    settings: HumanizeSettings,
    body?: (b: ClipBuilder) => void
  ): this | ClipBuilder {
    if (body) {
      // Block mode: delegate to builder, return builder
      return this.builder.humanize(settings, body);
    }
    // Modifier mode: append NOTE_MOD_HUMANIZE, return cursor
    const timingPpt = Math.round((settings.timing ?? 0) * 1000);
    const velocityPpt = Math.round((settings.velocity ?? 0) * 1000);
    this.builder.buf.push(NOTE_MOD_HUMANIZE, timingPpt, velocityPpt);
    return this;
  }
}
```

### 3.4 The Resulting Developer Experience

The API "just works" based on what you type:

```typescript
Clip.melody()
  .note('C4').humanize({ timing: 0.1 })  // 1. Modifier → returns NoteCursor
  .velocity(0.8)                          // 2. Cursor method → still on C4
  .humanize({ timing: 0.5 }, b => {       // 3. Block detected! → returns ClipBuilder
     b.note('D4')                         //    Inside block context
  })
  .note('E4')                             // 4. Back on ClipBuilder
```

**No `.commit()` needed. No `.builder()` escape hatch. It just works.**

### 3.5 Priority: Atomic Overrides Block

When a note has both block context AND atomic modifier, **atomic wins**:

```typescript
Clip.melody()
  .humanize({ timing: 0.1 }, b => {
    b.note('C4')                           // timing=0.1 (from block)
    b.note('D4').humanize({ timing: 0.5 }) // timing=0.5 (atomic overrides!)
    b.note('E4')                           // timing=0.1 (from block)
  })
```

---

## 4. Builder Bytecode Format (Absolute Ticks)

During chain construction, events are stored with **absolute tick** values.

### 4.1 Event Opcodes

| Opcode | Hex | Args | Layout |
|--------|-----|------|--------|
| NOTE | 0x01 | tick, pitch, vel, dur | `[0x01, tick, pitch, velocity, duration]` |
| REST | 0x02 | tick, dur | `[0x02, tick, duration]` |
| TEMPO | 0x20 | tick, bpm | `[0x20, tick, bpm]` |
| CC | 0x21 | tick, ctrl, val | `[0x21, tick, controller, value]` |
| BEND | 0x22 | tick, val | `[0x22, tick, value]` |

### 4.2 Structural Opcodes

| Opcode | Hex | Args | Layout |
|--------|-----|------|--------|
| STACK_START | 0x40 | tick, count | `[0x40, tick, branchCount]` |
| STACK_END | 0x41 | - | `[0x41]` |
| LOOP_START | 0x42 | tick, count | `[0x42, tick, iterationCount]` |
| LOOP_END | 0x43 | - | `[0x43]` |
| BRANCH_START | 0x46 | - | `[0x46]` |
| BRANCH_END | 0x47 | - | `[0x47]` |

### 4.3 Transform Context Opcodes (Block-Scoped)

These mark regions where transforms apply. Processed at `build()` time.

| Opcode | Hex | Args | Layout |
|--------|-----|------|--------|
| HUMANIZE_PUSH | 0x60 | timing, velocity | `[0x60, timing_ppt, velocity_ppt]` |
| HUMANIZE_POP | 0x61 | - | `[0x61]` |
| QUANTIZE_PUSH | 0x62 | grid, strength | `[0x62, grid_ticks, strength_pct]` |
| QUANTIZE_POP | 0x63 | - | `[0x63]` |
| GROOVE_PUSH | 0x64 | len, ...offsets | `[0x64, length, offset0, offset1, ...]` |
| GROOVE_POP | 0x65 | - | `[0x65]` |

### 4.4 Note Modifier Opcodes (Atomic)

These follow a NOTE opcode to apply transforms to that specific note.

| Opcode | Hex | Args | Layout |
|--------|-----|------|--------|
| NOTE_MOD_HUMANIZE | 0x70 | timing, velocity | `[0x70, timing_ppt, velocity_ppt]` |
| NOTE_MOD_QUANTIZE | 0x71 | grid, strength | `[0x71, grid_ticks, strength_pct]` |
| NOTE_MOD_GROOVE | 0x72 | groove_idx | `[0x72, groove_index]` |

**Parameter encoding:**
- `timing_ppt`: Timing variation in parts-per-thousand of PPQ (e.g., 50 = 5% of quarter note)
- `velocity_ppt`: Velocity variation in parts-per-thousand of 127 (e.g., 100 = 10%)
- `grid_ticks`: Quantize grid in ticks (e.g., 96 for quarter note)
- `strength_pct`: Quantize strength 0-100 (100 = full snap)
- `offsets`: Groove template offsets in ticks (signed)
- `groove_index`: Index into registered groove templates

---

## 5. VM Bytecode Format (Relative Ticks)

The VM bytecode uses RFC-038 format with **relative timing** (tick advances by duration).

| Opcode | Hex | Args | Layout |
|--------|-----|------|--------|
| NOTE | 0x01 | pitch, vel, dur | `[0x01, pitch, velocity, duration]` |
| REST | 0x02 | dur | `[0x02, duration]` |
| TEMPO | 0x20 | bpm | `[0x20, bpm]` |
| CC | 0x21 | ctrl, val | `[0x21, controller, value]` |
| BEND | 0x22 | val | `[0x22, value]` |
| STACK_START | 0x40 | count | `[0x40, branchCount]` |
| STACK_END | 0x41 | - | `[0x41]` |
| LOOP_START | 0x42 | count | `[0x42, iterationCount]` |
| LOOP_END | 0x43 | - | `[0x43]` |
| BRANCH_START | 0x46 | - | `[0x46]` |
| BRANCH_END | 0x47 | - | `[0x47]` |
| EOF | 0xFF | - | `[0xFF]` |

---

## 6. Core Components

### 6.1 ClipBuilder (Mutable)

```typescript
export class ClipBuilder {
  // Raw bytecode buffer - just integers (Builder format)
  protected buf: number[] = []
  
  // Current state
  protected vel: number = 100        // 0-127
  protected trans: number = 0        // Semitones offset
  protected tick: number = 0         // Current position in ticks
  protected ppq: number = 96         // Pulses per quarter
  
  // Registered groove templates (for atomic groove modifier)
  protected grooveTemplates: number[][] = []
  
  // Recycled cursor instance
  protected cursor: NoteCursor
  
  constructor() {
    this.cursor = new NoteCursor(this)
  }
  
  // Block-scoped transform (always takes callback)
  humanize(
    settings: HumanizeSettings,
    body: (b: this) => void
  ): this {
    const timingPpt = Math.round((settings.timing ?? 0) * 1000);
    const velocityPpt = Math.round((settings.velocity ?? 0) * 1000);
    
    this.buf.push(HUMANIZE_PUSH, timingPpt, velocityPpt);
    body(this);
    this.buf.push(HUMANIZE_POP);
    
    return this;
  }
}
```

### 6.2 NoteCursor (Smart Overloading)

```typescript
export class NoteCursor {
  opIndex: number = -1;
  
  constructor(private builder: ClipBuilder) {}
  
  // --- Smart Overloaded Transforms ---
  
  // Overload 1: Modifier (stays on cursor)
  humanize(settings: HumanizeSettings): this;
  // Overload 2: Block (escapes to builder)
  humanize(settings: HumanizeSettings, body: (b: ClipBuilder) => void): ClipBuilder;
  // Implementation
  humanize(
    settings: HumanizeSettings,
    body?: (b: ClipBuilder) => void
  ): this | ClipBuilder {
    if (body) {
      // Block mode: delegate to builder
      return this.builder.humanize(settings, body);
    }
    // Modifier mode: append NOTE_MOD_HUMANIZE
    const timingPpt = Math.round((settings.timing ?? 0) * 1000);
    const velocityPpt = Math.round((settings.velocity ?? 0) * 1000);
    this.builder.buf.push(NOTE_MOD_HUMANIZE, timingPpt, velocityPpt);
    return this;
  }
  
  // Overload 1: Modifier (stays on cursor)
  quantize(grid: NoteDuration, options?: QuantizeOptions): this;
  // Overload 2: Block (escapes to builder)
  quantize(grid: NoteDuration, options: QuantizeOptions | undefined, body: (b: ClipBuilder) => void): ClipBuilder;
  // Implementation
  quantize(
    grid: NoteDuration,
    optionsOrBody?: QuantizeOptions | ((b: ClipBuilder) => void),
    body?: (b: ClipBuilder) => void
  ): this | ClipBuilder {
    // Detect if second arg is callback or options
    const hasCallback = typeof optionsOrBody === 'function' || typeof body === 'function';
    
    if (hasCallback) {
      const options = typeof optionsOrBody === 'function' ? undefined : optionsOrBody;
      const callback = typeof optionsOrBody === 'function' ? optionsOrBody : body!;
      return this.builder.quantize(grid, options, callback);
    }
    
    // Modifier mode
    const options = optionsOrBody as QuantizeOptions | undefined;
    const gridTicks = durationToTicks(grid);
    const strengthPct = Math.round((options?.strength ?? 1.0) * 100);
    this.builder.buf.push(NOTE_MOD_QUANTIZE, gridTicks, strengthPct);
    return this;
  }
  
  // Overload 1: Modifier (stays on cursor)
  groove(template: GrooveTemplate): this;
  // Overload 2: Block (escapes to builder)
  groove(template: GrooveTemplate, body: (b: ClipBuilder) => void): ClipBuilder;
  // Implementation
  groove(
    template: GrooveTemplate,
    body?: (b: ClipBuilder) => void
  ): this | ClipBuilder {
    if (body) {
      return this.builder.groove(template, body);
    }
    const idx = this.builder.registerGroove(template);
    this.builder.buf.push(NOTE_MOD_GROOVE, idx);
    return this;
  }
  
  // --- Standard Cursor Methods ---
  
  velocity(v: number): this {
    // Builder NOTE: [opcode, tick, pitch, vel, dur]
    this.builder.buf[this.opIndex + 3] = Math.round(v * 127);
    return this;
  }
  
  staccato(): this {
    this.builder.buf[this.opIndex + 4] = Math.round(
      this.builder.buf[this.opIndex + 4] * 0.5
    );
    return this;
  }
  
  // Chain back to builder
  note(pitch: NoteName, duration: NoteDuration): NoteCursor {
    return this.builder.note(pitch, duration);
  }
}
```

---

## 7. Method Implementations

### 7.1 note()

```typescript
note(pitch: NoteName, duration: NoteDuration): NoteCursor {
  const opIndex = this.buf.length;
  const midi = noteToMidi(pitch) + this.trans;
  const ticks = durationToTicks(duration);
  
  // Builder format: [opcode, tick, pitch, vel, dur]
  this.buf.push(OP.NOTE, this.tick, midi, this.vel, ticks);
  this.tick += ticks;
  
  this.cursor.opIndex = opIndex;
  return this.cursor;
}
```

### 7.2 rest()

```typescript
rest(duration: NoteDuration): this {
  const ticks = durationToTicks(duration);
  this.buf.push(OP.REST, this.tick, ticks);
  this.tick += ticks;
  return this;
}
```

### 7.3 Block-Scoped Transforms (ClipBuilder)

```typescript
humanize(settings: HumanizeSettings, body: (b: this) => void): this {
  const timingPpt = Math.round((settings.timing ?? 0) * 1000);
  const velocityPpt = Math.round((settings.velocity ?? 0) * 1000);
  
  this.buf.push(HUMANIZE_PUSH, timingPpt, velocityPpt);
  body(this);
  this.buf.push(HUMANIZE_POP);
  
  return this;
}

quantize(grid: NoteDuration, options: QuantizeOptions | undefined, body: (b: this) => void): this {
  const gridTicks = durationToTicks(grid);
  const strengthPct = Math.round((options?.strength ?? 1.0) * 100);
  
  this.buf.push(QUANTIZE_PUSH, gridTicks, strengthPct);
  body(this);
  this.buf.push(QUANTIZE_POP);
  
  return this;
}

groove(template: GrooveTemplate, body: (b: this) => void): this {
  const offsets = template.getOffsets();
  
  this.buf.push(GROOVE_PUSH, offsets.length, ...offsets);
  body(this);
  this.buf.push(GROOVE_POP);
  
  return this;
}
```

### 7.4 loop()

```typescript
loop(count: number, body: (b: this) => void): this {
  if (count <= 0) return this;
  
  this.buf.push(OP.LOOP_START, this.tick, count);
  body(this);
  this.buf.push(OP.LOOP_END);
  
  return this;
}
```

### 7.5 clone()

```typescript
clone(): ClipBuilder {
  const copy = new ClipBuilder();
  copy.buf = [...this.buf];
  copy.vel = this.vel;
  copy.trans = this.trans;
  copy.tick = this.tick;
  return copy;
}
```

---

## 8. Build: Bytecode-to-Bytecode Compilation

The `build()` method compiles Builder Bytecode → VM Bytecode in 5 phases:

### Phase 1: Extract Events
Scan buffer, extract events with their transform context.
- Block context from context stack (HUMANIZE_PUSH/POP etc.)
- Atomic modifiers from NOTE_MOD_* following each NOTE
- **Atomic overrides block when both present**

### Phase 2: Apply Transforms
Pipeline order: **Quantize → Groove → Humanize**

### Phase 3: Sort by Final Tick
Events may be reordered by quantize moving notes earlier.

### Phase 4: Emit VM Bytecode
Insert REST opcodes for timing gaps. Skip REST if events overlap.

### Phase 5: Copy to SharedArrayBuffer
Write RFC-038 headers and copy VM bytecode.

---

## 9. Example: Smart Overloading in Action

```typescript
Clip.melody()
  .note('C4', '4n')                        // Returns NoteCursor
  .humanize({ timing: 0.1 })               // Modifier → returns NoteCursor
  .velocity(0.8)                           // Cursor method → still on C4
  .humanize({ timing: 0.5 }, b => {        // Block! → returns ClipBuilder
     b.note('D4', '4n')
     b.note('E4', '4n').quantize('8n')     // Atomic quantize on E4
  })
  .note('F4', '4n')                        // Back on ClipBuilder
  .quantize('16n', { strength: 0.5 }, b => {
     b.note('G4', '4n')
  })
  .build()
```

**Type flow:**
1. `.note('C4')` → `NoteCursor`
2. `.humanize({...})` → `NoteCursor` (modifier, no callback)
3. `.velocity(0.8)` → `NoteCursor`
4. `.humanize({...}, b => ...)` → `ClipBuilder` (block, has callback)
5. `.note('F4')` → `NoteCursor`
6. `.quantize(..., b => ...)` → `ClipBuilder` (block)
7. `.build()` → `SharedArrayBuffer`

---

## 10. Branching Behavior

The builder is **mutable**. Branching requires explicit `.clone()`.

```typescript
const base = Clip.melody().note('C4', '4n');
const var1 = base.clone().note('E4', '4n');
const var2 = base.clone().note('G4', '4n');
// base still has only C4
```

---

## 11. Success Criteria

- [ ] Zero allocations during fluent chain (no `new` except constructor/clone)
- [ ] `buf` contains only integers (no objects)
- [ ] Cursor is recycled (same instance from every `note()`)
- [ ] Cursor modifies buffer in place via index
- [ ] **Smart overloading** on NoteCursor for all transforms
- [ ] **Block-scoped transforms** via callback (`HUMANIZE_PUSH/POP` etc.)
- [ ] **Atomic transforms** via modifier (`NOTE_MOD_*`)
- [ ] **Atomic overrides block** when both present
- [ ] TypeScript overloads provide correct return types
- [ ] Pipeline order: Quantize → Groove → Humanize
- [ ] Callbacks execute immediately (not stored)
- [ ] `.clone()` creates independent copy
- [ ] `build()` compiles Builder → VM bytecode
- [ ] `build()` returns `SharedArrayBuffer`
- [ ] Output compatible with RFC-038 `BytecodeVM`
- [ ] All tests pass
- [ ] `npx tsc --noEmit` passes

---

## 12. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
