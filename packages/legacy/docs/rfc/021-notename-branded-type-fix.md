# RFC-021: NoteName Branded Type Fix

**Status**: Draft  
**Priority**: Moderate  
**Estimated Effort**: 0.25 days  
**Breaking Change**: Minor (stricter typing may require explicit casts)

---

## 1. Problem Statement

The `NoteName` branded type is defined with a permissive union:

```typescript
// src/types/primitives.ts:11
export type NoteName = string | (string & { readonly [NoteNameBrand]: never });
```

This simplifies to just `string`, defeating the purpose of the brand. Any string can be assigned to `NoteName` without validation:

```typescript
const bad: NoteName = "not-a-note"; // ✅ Compiles (WRONG)
```

---

## 2. Requirements

| ID   | Requirement                                              | Priority  |
| ---- | -------------------------------------------------------- | --------- |
| FR-1 | `NoteName` MUST only accept branded strings              | Must Have |
| FR-2 | Use `noteName()` helper for validation                   | Must Have |
| FR-3 | Internal code MAY use `unsafeNoteName()` for performance | Should    |

---

## 3. Proposed Solution

Remove the `string |` prefix from the union:

```typescript
// Before
export type NoteName = string | (string & { readonly [NoteNameBrand]: never });

// After
export type NoteName = string & { readonly [NoteNameBrand]: never };
```

---

## 4. Files to Modify

| Action     | Path                      | Description         |
| ---------- | ------------------------- | ------------------- |
| **MODIFY** | `src/types/primitives.ts` | Fix type definition |

---

## 5. Migration Notes

After this change, code passing raw strings to `NoteName` parameters will fail type-checking:

```typescript
// Before: Compiles
clip.note("C4", "4n");

// After: Still compiles (string literal inference)
clip.note("C4", "4n");

// But dynamic strings fail:
const note = getUserInput();
clip.note(note, "4n"); // ❌ Error: string not assignable to NoteName

// Fix:
clip.note(noteName(note), "4n"); // ✅ Runtime validation
```

TypeScript infers string literals as their literal type, so most static usage continues to work.

---

## 6. Testing Strategy

```typescript
describe("NoteName branding", () => {
  it("accepts valid note names", () => {
    expect(() => noteName("C4")).not.toThrow();
    expect(() => noteName("F#3")).not.toThrow();
    expect(() => noteName("Bb5")).not.toThrow();
  });

  it("rejects invalid note names", () => {
    expect(() => noteName("H4")).toThrow();
    expect(() => noteName("C")).toThrow();
    expect(() => noteName("4C")).toThrow();
  });
});
```

---

## 7. Approval

- [ ] Approved by maintainer
