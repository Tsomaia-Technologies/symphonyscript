import { SCHEMA_VERSION, isCompatible } from './version'
import { migrations } from './migrations'

export class SchemaVersionError extends Error {
    constructor(
        public readonly dataVersion: string,
        public readonly libraryVersion: string,
        message: string
    ) {
        super(message)
        this.name = 'SchemaVersionError'
    }
}

/**
 * Validate and optionally migrate serialized data.
 */
export function validateSchema<T extends { _version?: string }>(
    data: T,
    options: {
        strict?: boolean  // If true, reject version mismatches
        migrate?: boolean // If true, attempt migration
    } = {}
): T {
    const dataVersion = data._version ?? '0.0.0'  // Legacy data without version
    const { compatible, reason } = isCompatible(dataVersion)

    if (!compatible) {
        if (options.strict) {
            throw new SchemaVersionError(
                dataVersion,
                SCHEMA_VERSION,
                reason ?? 'Version incompatible'
            )
        }

        // Note: Older major versions are also considered incompatible by isCompatible,
        // so we check here if we can/should migrate.

        if (options.migrate) {
            // If we have a migration path, do it.
            // Even if strictly compatible (e.g. 1.0.0 vs 1.0.1, though isCompatible says false for newer lib?? 
            // Wait, isCompatible logic:
            // Same major, data <= lib: Compatible.
            // Same major, data > lib: Incompatible (newer data).
            // Different major: Incompatible.

            // Migration usually needed when data < lib (which is deemed "compatible" by default but might need field updates).
            // Actually isCompatible returns TRUE for older data.
            // So we only reach here if data is NEWER (minor > lib OR major mismatch).

            // If data is OLDER (major match, data < lib), compatible is TRUE. 
            // But we might still want to migrate to up-level the version tag.

            // Let's refine. Migration is chiefly for OLDER data.
            // If OLDER data (compatible=true), we skip this block.
            // We should check migration separately.

            // However, different MAJOR version (older) is INCOMPATIBLE.
            // So if data=0.0.0 (legacy) and lib=1.0.0, compatible=false (major mismatch).
            // So we enter this block.

            // Migration attempt:
            return migrateToLatest(data, dataVersion) as T
        }

        console.warn(
            `[SymphonyScript] Loading data with version ${dataVersion}, ` +
            `library is ${SCHEMA_VERSION}. ${reason ?? ''}`
        )
    } else {
        // Even if compatible (e.g. 1.0 vs 1.1), if migrate is requested, we should update strict version
        // But usually compatible means "loadable as is".
        // If user explicitly asks for migrate, we should probably do it if older.
        if (options.migrate && dataVersion !== SCHEMA_VERSION) {
            return migrateToLatest(data, dataVersion) as T
        }
    }

    return data
}

function migrateToLatest(data: any, fromVersion: string): any {
    try {
        return migrations.migrate(data, SCHEMA_VERSION)
    } catch (e: any) {
        // If migration fails, we can't initialize.
        throw new Error(`Migration failed: ${e.message}`)
    }
}
