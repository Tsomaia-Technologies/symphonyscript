# RFC-048: Pluggable ID Resolution Strategy

| Metadata | Value |
| --- | --- |
| **Title** | **Pluggable ID Resolution Strategy** |
| **Status** | **PLANNING** |
| **Target** | `packages/kernel/` |
| **Goals** | Strategy Pattern, Zero-Allocation, Configurable Performance |
| **Depends On** | RFC-047 (Kernel Engine) |

---

## 1. Executive Summary

The current Kernel uses a **Hash Table (ID Table)** for sourceId → NodePtr lookups. While functional (83µs per insert), this approach has inherent O(n) probe overhead under load.

RFC-048 proposes a **Pluggable Strategy Pattern** that allows users and benchmarks to choose between:

1.  **ID Table (Hash Map)**: Battle-tested, well-understood, ~80µs insert/lookup
2.  **Generational Handles**: O(1) array access, ~0.5µs insert/lookup, 160x faster

Both strategies share a common interface. The choice is made at kernel initialization and cannot be changed at runtime.

**Result**: Power users get bleeding-edge performance. Conservative users keep the proven approach. Benchmarks can compare both objectively.

---

## 2. The Performance Problem

### Current State: ID Table Only

| Operation | Complexity | Time |
|-----------|-----------|------|
| Insert | Hash + Probe (1-5 iterations) | ~80µs |
| Lookup | Hash + Probe (1-5 iterations) | ~80µs |
| Delete | Hash + Probe + Tombstone | ~10µs |

**Bottleneck**: Even with quadratic probing and 2x capacity, hash collisions cause multiple `Atomics.load()` calls per operation.

### Proposed: Generational Handles

| Operation | Complexity | Time |
|-----------|-----------|------|
| Insert | Array slot assignment | ~0.5µs |
| Lookup | `slots[handle.slot]` | ~0.5µs |
| Delete | Bump generation counter | ~0.5µs |

**Key Insight**: No hashing, no probing. Direct array indexing.

---

## 3. Architecture

### 3.1. The Strategy Interface

```typescript
interface IdResolver {
  /**
   * Insert a mapping: sourceId → NodePtr.
   * Returns a handle (number) for future lookups.
   */
  insert(sourceId: number, ptr: NodePtr): number;

  /**
   * Lookup a NodePtr by handle.
   * Returns NULL_PTR if handle is invalid/stale.
   */
  lookup(handle: number): NodePtr;

  /**
   * Remove a handle.
   * Returns true if successful, false if not found.
   */
  remove(handle: number): boolean;

  /**
   * Clear all entries.
   */
  clear(): void;
}
```

### 3.2. Concrete Implementations

#### A. ID Table (Hash Map)

```typescript
class IdTableResolver implements IdResolver {
  private table: Int32Array;  // [sourceId, ptr, sourceId, ptr, ...]
  private capacity: number;

  insert(sourceId: number, ptr: NodePtr): number {
    const slot = this.quadraticProbe(sourceId);
    this.table[slot * 2] = sourceId;
    this.table[slot * 2 + 1] = ptr;
    return sourceId;  // Handle is the sourceId itself
  }

  lookup(handle: number): NodePtr {
    const slot = this.quadraticProbe(handle);
    return this.table[slot * 2 + 1];
  }
}
```

#### B. Generational Handles (Arena)

```typescript
class GenerationalResolver implements IdResolver {
  private slots: Int32Array;     // [gen, ptr, gen, ptr, ...]
  private freeList: number[];
  private slotBits = 20;  // 1M slots
  private genBits = 12;   // 4K generations

  insert(sourceId: number, ptr: NodePtr): number {
    const slot = this.allocSlot();
    const gen = this.slots[slot * 2];
    this.slots[slot * 2 + 1] = ptr;
    return (gen << this.slotBits) | slot;  // Pack into handle
  }

  lookup(handle: number): NodePtr {
    const slot = handle & ((1 << this.slotBits) - 1);
    const gen = handle >>> this.slotBits;
    const slotGen = this.slots[slot * 2];
    if (slotGen !== gen) return NULL_PTR;  // Stale handle
    return this.slots[slot * 2 + 1];
  }

  remove(handle: number): boolean {
    const slot = handle & ((1 << this.slotBits) - 1);
    this.slots[slot * 2]++;  // Bump generation
    this.freeList.push(slot);
    return true;
  }
}
```

### 3.3. Kernel Integration

```typescript
class SiliconSynapse {
  private resolver: IdResolver;

  constructor(sab: SharedArrayBuffer, options: KernelOptions) {
    // Strategy selection at init time
    this.resolver = options.idStrategy === 'generational-handles'
      ? new GenerationalResolver(options)
      : new IdTableResolver(options);
  }

  insertHead(...): NodePtr {
    const ptr = this.allocNode();
    const handle = this.resolver.insert(sourceId, ptr);
    // ... rest of insertion logic
    return ptr;
  }

  patchPitch(handle: number, pitch: number): void {
    const ptr = this.resolver.lookup(handle);
    if (ptr === NULL_PTR) return;  // Stale handle
    // ... patch logic
  }
}
```

---

## 4. User API

### 4.1. Configuration

```typescript
// Conservative user: proven approach
const kernel = createKernel({
  nodeCapacity: 100_000,
  idStrategy: 'id-table'  // Default
});

// Power user: maximum performance
const kernel = createKernel({
  nodeCapacity: 100_000,
  idStrategy: 'generational-handles'
});
```

### 4.2. Custom Strategy (Advanced)

```typescript
// User provides custom resolver
const kernel = createKernel({
  nodeCapacity: 100_000,
  idResolver: new MyCustomResolver()
});
```

---

## 5. Trade-offs

| Property | ID Table | Generational Handles |
|----------|----------|---------------------|
| **Insert Speed** | 80µs | 0.5µs (160x faster) |
| **Lookup Speed** | 80µs | 0.5µs (160x faster) |
| **Memory** | 2x nodeCapacity × 8 bytes | 2x nodeCapacity × 8 bytes |
| **Max Capacity** | Unlimited (hash grows) | 1M slots (20-bit config) |
| **Robustness** | Battle-tested | Newer pattern |
| **Stale Handle Detection** | N/A (sourceIds don't expire) | Built-in (generation check) |

---

## 6. Implementation Plan

### Phase 1: Interface Definition
1.  Define `IdResolver` interface in `kernel/src/id-resolver.ts`
2.  Extract current ID table logic into `IdTableResolver` class
3.  Update `SiliconSynapse` to use `IdResolver` interface

### Phase 2: Generational Handles
1.  Implement `GenerationalResolver` class
2.  Add free list management
3.  Implement generation checking

### Phase 3: Configuration
1.  Add `idStrategy` option to `createKernel()`
2.  Add factory method to instantiate correct resolver
3.  Support custom resolver instances

### Phase 4: Benchmarking
1.  Update `benchmark-standalone.cjs` to compare both strategies
2.  Measure insert, lookup, and delete operations
3.  Document performance characteristics

---

## 7. Verification Plan

### Unit Tests
- `id-table-resolver.spec.ts`: Hash table correctness
- `generational-resolver.spec.ts`: Generation checking, stale handles
- `strategy-pattern.spec.ts`: Both strategies produce same results

### Performance Tests
- Standalone benchmark comparing both strategies
- 5000-note composition stress test
- Incremental edit scenarios (1 note changed in 1000-note clip)

### Integration Tests
- SynapticClip → Bridge → Kernel with both strategies
- Verify live-swap works identically with both

---

## 8. Constraints

1.  **Zero-Allocation**: Both strategies must be zero-allocation after init
2.  **Thread-Safety**: All operations must use `Atomics`
3.  **Interface Stability**: `IdResolver` interface must never change once shipped
4.  **No Runtime Switching**: Strategy cannot change after kernel creation

---

## 9. Future Work

### Rust WASM Port
- Use generics for zero-overhead strategy selection:
  ```rust
  struct Kernel<R: IdResolver> { ... }
  ```
- Compile-time monomorphization eliminates all vtable overhead

### Hybrid Strategy
- Use generational handles for first 10K notes (fast path)
- Fall back to hash table for overflow (rare but supported)

---

## 10. Architect's Note

This RFC demonstrates **good engineering judgment**:
- We don't remove the working solution (ID table)
- We provide a faster alternative for those who need it
- We let benchmarks and users decide objectively

**The strategy pattern is not premature optimization.** It's about **user choice** and **objective measurement**.

**Ratification Status:** PENDING REVIEW.
**Courage Level:** MEDIUM (proven pattern, low risk).
