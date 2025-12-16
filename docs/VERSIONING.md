# Schema Versioning

SymphonyScript uses semantic versioning for all serialized data to ensure compositions remain loadable across library updates.

## Overview

Every serialized node (`ClipNode`, `SessionNode`, `TrackNode`) includes a `_version` field:

```json
{
  "_version": "1.0.0",
  "kind": "clip",
  "name": "MyMelody",
  "operations": [...]
}
```

This enables:
- **Forward compatibility**: Old compositions load in newer library versions
- **Safe upgrades**: Clear errors when data is incompatible
- **Automatic migration**: Seamless updates to new schema versions

---

## Semantic Versioning

Version format: `MAJOR.MINOR.PATCH`

| Component | When to Increment | Example |
|-----------|-------------------|---------|
| **MAJOR** | Breaking changes to data format | `1.0.0` → `2.0.0` |
| **MINOR** | New optional fields added | `1.0.0` → `1.1.0` |
| **PATCH** | Bug fixes, no schema changes | `1.0.0` → `1.0.1` |

---

## Compatibility Rules

| Data Version | Library Version | Result |
|--------------|-----------------|--------|
| `1.0.0` | `1.0.0` | ✅ Load directly |
| `1.0.0` | `1.2.0` | ✅ Compatible (older data, newer library) |
| `1.2.0` | `1.0.0` | ❌ Rejected (data newer than library) |
| `1.0.0` | `2.0.0` | ⚠️ Requires migration |
| No version | `1.0.0` | ⚠️ Legacy data, auto-migrates |

### Why Newer Data is Rejected

If you create a composition with library v1.2.0 (which might use new fields), then try to load it with v1.0.0, the older library doesn't know about those fields. Loading would cause data loss or incorrect behavior.

**Solution**: Update your library to match or exceed the data version.

---

## Loading Data

### Default Mode (Warn)

```typescript
import { deserializeClip } from 'symphonyscript'

const clip = deserializeClip(jsonString)
// Console warning if version mismatch, but loads anyway
```

### Strict Mode (Error on Mismatch)

```typescript
import { deserializeClip } from 'symphonyscript'

try {
  const clip = deserializeClip(jsonString, { strict: true })
} catch (e) {
  if (e instanceof SchemaVersionError) {
    console.error(`Version mismatch: data is ${e.dataVersion}, library is ${e.libraryVersion}`)
  }
}
```

### Auto-Migration Mode

```typescript
import { deserializeClip } from 'symphonyscript'

// Automatically upgrade old data to current version
const clip = deserializeClip(jsonString, { migrate: true })
```

---

## Migration System

### How It Works

Migrations are registered as version-to-version transformers:

```typescript
// Internal registration (in src/schema/migrations.ts)
migrations.register('1.0.0', '1.1.0', (data) => ({
  ...data,
  _version: '1.1.0',
  newOptionalField: undefined  // Add new field with default
}))
```

### Multi-Step Migration

The system uses BFS (Breadth-First Search) to find the shortest migration path:

```
Data at 0.0.0 → Library at 1.2.0

Available migrations:
  0.0.0 → 1.0.0
  1.0.0 → 1.1.0
  1.1.0 → 1.2.0

Path found: 0.0.0 → 1.0.0 → 1.1.0 → 1.2.0
```

Each migration function is applied in sequence.

### Legacy Data (No Version)

Data without a `_version` field is treated as version `0.0.0` and migrated accordingly:

```typescript
// Old data (pre-versioning)
{ "kind": "clip", "name": "Legacy", "operations": [] }

// After migration
{ "_version": "1.0.0", "kind": "clip", "name": "Legacy", "operations": [] }
```

---

## Version Checking API

### Check Compatibility

```typescript
import { isCompatible, SCHEMA_VERSION } from 'symphonyscript/schema'

const result = isCompatible('1.0.0', SCHEMA_VERSION)
// { compatible: true }

const result2 = isCompatible('2.0.0', '1.0.0')
// { compatible: false, reason: 'Data version 2.0.0 is newer than library 1.0.0' }
```

### Parse Version

```typescript
import { parseVersion } from 'symphonyscript/schema'

parseVersion('1.2.3')
// { major: 1, minor: 2, patch: 3 }
```

### Get Current Version

```typescript
import { SCHEMA_VERSION } from 'symphonyscript/schema'

console.log(SCHEMA_VERSION)  // '1.0.0'
```

---

## For Library Maintainers

### Adding a New Optional Field

1. Add the field to the interface:
   ```typescript
   interface ClipNode {
     // ... existing fields
     newFeature?: NewFeatureType  // Optional for backward compat
   }
   ```

2. Register migration:
   ```typescript
   // src/schema/migrations.ts
   migrations.register('1.0.0', '1.1.0', (data) => ({
     ...data,
     _version: '1.1.0',
     newFeature: undefined  // Default value
   }))
   ```

3. Update version constant:
   ```typescript
   // src/schema/version.ts
   export const SCHEMA_VERSION = '1.1.0' as const
   ```

### Making a Breaking Change

1. Increment MAJOR version
2. Register migration with data transformation
3. Document the breaking change
4. Consider providing a CLI migration tool for users

---

## Validation Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Load JSON File                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Check _version field  │
              └────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
      [No version]    [Compatible]    [Incompatible]
           │               │               │
           ▼               ▼               ▼
    Treat as 0.0.0    ✅ Load OK      Check reason
           │                              │
           │                    ┌─────────┴─────────┐
           │                    │                   │
           │                    ▼                   ▼
           │              [Data newer]        [Data older]
           │                    │                   │
           │                    ▼                   ▼
           │              ❌ Reject           Can migrate?
           │              (update lib)              │
           │                              ┌────────┴────────┐
           │                              │                 │
           │                              ▼                 ▼
           │                      [migrate: true]    [migrate: false]
           │                              │                 │
           └──────────────────────────────┤                 │
                                          ▼                 ▼
                                    Run migrations      ⚠️ Warn
                                          │             & load as-is
                                          ▼
                                    ✅ Load migrated
```

---

## Best Practices

1. **Always use `migrate: true` in production** — ensures old compositions remain playable
2. **Use `strict: true` in development** — catch version issues early
3. **Test migrations** — ensure old data transforms correctly
4. **Document breaking changes** — help users understand what changed

---

## Troubleshooting

### "Data version X.Y.Z is newer than library"

Your data was created with a newer version of SymphonyScript. Update the library:

```bash
npm update symphonyscript
```

### "No migration path from X to Y"

A required migration is missing. This shouldn't happen with official releases. If using a custom migration, ensure all intermediate versions are registered.

### "Migration failed"

A migration function threw an error. Check the error message for details. This usually indicates corrupted data or a bug in a custom migration.






