# RFC-005: Modifier Relay Pattern

## 1. The Problem

The current Builder API relies on extensive runtime validation to support modifier chaining:

```typescript
// Current "magic" behavior
clip.note('C4').staccato()
```

- **Runtime Risk**: If called without a preceding note, it throws at runtime.
- **Loose Typing**: `staccato()` is available on `ClipBuilder` even when invalid.
- **State Complexity**: `modifyLastNote` requires traversing the operations chain backwards.

## 2. The Solution: Relay Pattern

Separate the **Container Builder** from the **Note Cursor**.

### 2.1 Concept

1.  `ClipBuilder` methods like `.note()` **DO NOT** return `this`.
2.  They return a specialized `NoteCursor` (or `Relay`).
3.  The `NoteCursor` contains *only* the methods valid for that note (modifiers).
4.  Calling any "Container" method (like `.note()` again, or `.build()`) on the cursor:
    - Commits the current note.
    - Returns control to the builder.

### 2.2 New Syntax

```typescript
// Valid
clip.note('C4').staccato().accent()
    .note('D4').legato()

// Compile-Time Error (Type Safety)
clip.staccato() // Error: Property 'staccato' does not exist on type 'ClipBuilder'.
```

## 3. Core Architecture

### 3.1 `NoteCursor` Class

```typescript
export class NoteCursor<B extends ClipBuilder> {
  constructor(
    protected builder: B,
    protected pendingOp: NoteOp
  ) {}

  // 1. Modifiers (Fluent, return this)
  staccato(): this { ... }
  velocity(v: number): this { ... }

  // 2. Escapes (Commit & Delegate)
  note(n: NoteName): NoteCursor<B> {
    this.commit()
    return this.builder.note(n)
  }

  build(): ClipNode {
    this.commit()
    return this.builder.build()
  }

  protected commit() {
    this.builder.addOp(this.pendingOp)
  }
}
```

### 3.2 Removal of NoteModifierBuilder

The callback pattern (`.note('C4', n => n.staccato())`) is **deprecated and removed**. The linear syntax is strictly superior in readability and equal in power.

## 4. Migration Strategy

This is a **Breaking Change (v2.0.0)**.

- **Phase 1**: Implement `NoteCursor`.
- **Phase 2**: Update `ClipBuilder` return types.
- **Phase 3**: Remove old `modifyLastNote` logic.

## 5. Benefits

1.  **Compile-Time Safety**: Impossible to apply modifiers to non-notes.
2.  **Cleaner Internals**: Removes fragile look-back logic.
3.  **Better IntelliSense**: Autocomplete only shows relevant methods.
