# RFC-022: Schema Migration Implementation

**Status**: Draft  
**Priority**: Moderate  
**Estimated Effort**: 2 days  
**Breaking Change**: None (additive feature)

---

## 1. Problem Statement

README.md documents schema versioning and auto-migration:

```typescript
// README.md claims this exists
const clip = deserializeClip(json, { migrate: true });
```

However, no implementation of `deserializeClip` or migration logic exists in the codebase. Adding a required property in v2 will silently break v1 loaders.

**Current State**:

- `ClipNode._version` field exists ✅
- `SCHEMA_VERSION` constant exists ✅
- Serialization works (`JSON.stringify(clip)`) ✅
- Deserialization with migration: ❌ **Not Implemented**

---

## 2. Requirements

| ID   | Requirement                                                 | Priority  |
| ---- | ----------------------------------------------------------- | --------- |
| FR-1 | `deserializeClip(json, options)` MUST be implemented        | Must Have |
| FR-2 | Migration MUST be explicit (opt-in via `{ migrate: true }`) | Must Have |
| FR-3 | Version mismatch without migration MUST throw               | Must Have |
| FR-4 | Migration registry MUST support chained migrations          | Should    |
| FR-5 | Unknown future versions MUST throw (no downgrade)           | Must Have |

---

## 3. Proposed Solution

### 3.1 Migration Registry

```typescript
// src/schema/migrations.ts

type Migrator = (data: unknown) => unknown;

const migrations: Record<string, Migrator> = {
  "0.1.0 -> 0.2.0": (clip) => ({
    ...clip,
    _version: "0.2.0",
    // Add new required fields with defaults
  }),
  "0.2.0 -> 0.3.0": (clip) => ({
    ...clip,
    _version: "0.3.0",
    // Transform existing fields
  }),
};
```

### 3.2 Deserialization Function

```typescript
// src/schema/deserialize.ts

export interface DeserializeOptions {
  migrate?: boolean; // Default: false
}

export function deserializeClip(
  json: string | object,
  options: DeserializeOptions = {}
): ClipNode {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const version = data._version;

  if (!version) {
    throw new SchemaError("Missing _version field");
  }

  if (version === SCHEMA_VERSION) {
    return validateClipNode(data);
  }

  if (!options.migrate) {
    throw new SchemaError(
      `Version mismatch: found ${version}, expected ${SCHEMA_VERSION}. ` +
        `Use { migrate: true } to auto-migrate.`
    );
  }

  return migrateToLatest(data);
}
```

### 3.3 Chain Migration

```typescript
function migrateToLatest(data: unknown): ClipNode {
  let current = data as any;

  while (current._version !== SCHEMA_VERSION) {
    const key = `${current._version} -> ${getNextVersion(current._version)}`;
    const migrator = migrations[key];

    if (!migrator) {
      throw new SchemaError(`No migration path from ${current._version}`);
    }

    current = migrator(current);
  }

  return validateClipNode(current);
}
```

---

## 4. Files to Modify

| Action  | Path                        | Description                  |
| ------- | --------------------------- | ---------------------------- |
| **ADD** | `src/schema/deserialize.ts` | Deserialization with options |
| **ADD** | `src/schema/migrations.ts`  | Migration registry           |
| **ADD** | `src/schema/errors.ts`      | SchemaError class            |
| **ADD** | `src/schema/validate.ts`    | Runtime validation           |

---

## 5. Testing Strategy

```typescript
describe("Schema Migration", () => {
  it("deserializes current version without migration", () => {
    const clip = { _version: SCHEMA_VERSION, kind: 'clip', ... }
    expect(deserializeClip(clip)).toEqual(clip)
  })

  it("throws on version mismatch without migrate flag", () => {
    const clip = { _version: '0.0.1', kind: 'clip', ... }
    expect(() => deserializeClip(clip)).toThrow(/Version mismatch/)
  })

  it("migrates old version with migrate: true", () => {
    const old = { _version: '0.0.1', kind: 'clip', ... }
    const migrated = deserializeClip(old, { migrate: true })
    expect(migrated._version).toBe(SCHEMA_VERSION)
  })

  it("throws on unknown future version", () => {
    const future = { _version: '99.0.0', kind: 'clip', ... }
    expect(() => deserializeClip(future, { migrate: true }))
      .toThrow(/No migration path/)
  })
})
```

---

## 6. Approval

- [ ] Approved by maintainer
