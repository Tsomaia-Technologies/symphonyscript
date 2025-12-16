/**
 * Current schema version.
 * Increment MINOR for additive changes.
 * Increment MAJOR for breaking changes.
 */
export const SCHEMA_VERSION = '1.0.0' as const
export type SchemaVersion = typeof SCHEMA_VERSION

/**
 * Parse version string into components.
 */
export function parseVersion(version: string): {
    major: number
    minor: number
    patch: number
} {
    const [major, minor, patch] = version.split('.').map(Number)
    return { major, minor, patch }
}

/**
 * Check if data version is compatible with library version.
 */
export function isCompatible(
    dataVersion: string,
    libraryVersion: string = SCHEMA_VERSION
): { compatible: boolean; reason?: string } {
    const data = parseVersion(dataVersion)
    const lib = parseVersion(libraryVersion)

    // Major version mismatch: incompatible
    if (data.major !== lib.major) {
        return {
            compatible: false,
            reason: data.major > lib.major
                ? `Data version ${dataVersion} is newer than library ${libraryVersion}`
                : `Data version ${dataVersion} requires migration to ${libraryVersion}`
        }
    }

    // Data newer than library: incompatible
    if (data.minor > lib.minor) {
        return {
            compatible: false,
            reason: `Data version ${dataVersion} is newer than library ${libraryVersion}`
        }
    }

    // Data older: compatible with potential migration
    return { compatible: true }
}
