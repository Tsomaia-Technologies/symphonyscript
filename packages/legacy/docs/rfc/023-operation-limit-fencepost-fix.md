# RFC-023: Operation Limit Fence-Post Fix

**Status**: Draft  
**Priority**: Low  
**Estimated Effort**: 0.1 days  
**Breaking Change**: None (tightens existing limit by 1)

---

## 1. Problem Statement

The operation limit check in `expand.ts` fires _after_ pushing to `result`:

```typescript
// src/compiler/pipeline/expand.ts:83-91
if (result.length > config.maxOperations) {
  throw new ExpansionError(...)
}
```

This is a fence-post error. The actual limit enforced is `maxOperations + 1`.

---

## 2. Requirements

| ID   | Requirement                                      | Priority  |
| ---- | ------------------------------------------------ | --------- |
| FR-1 | Limit check MUST fire at exactly `maxOperations` | Must Have |

---

## 3. Proposed Solution

Change `>` to `>=`:

```typescript
// Before
if (result.length > config.maxOperations) {

// After
if (result.length >= config.maxOperations) {
```

---

## 4. Files to Modify

| Action     | Path                              | Description    |
| ---------- | --------------------------------- | -------------- |
| **MODIFY** | `src/compiler/pipeline/expand.ts` | Fix comparison |

---

## 5. Testing Strategy

```typescript
describe("Expansion Limits", () => {
  it("throws at exactly maxOperations", () => {
    const clip = Clip.melody();
    for (let i = 0; i < 10; i++) clip.note("C4");

    expect(() =>
      compileClip(clip.build(), {
        bpm: 120,
        maxOperations: 10,
      })
    ).toThrow(/Max operations 10/);
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
