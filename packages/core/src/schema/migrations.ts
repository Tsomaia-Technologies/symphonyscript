type MigrationFn = (data: any) => any

interface Migration {
    from: string
    to: string
    migrate: MigrationFn
}

class MigrationRegistry {
    private migrations: Migration[] = []

    register(from: string, to: string, migrate: MigrationFn): void {
        this.migrations.push({ from, to, migrate })
    }

    /**
     * Find migration path from source to target version.
     */
    findPath(from: string, to: string): MigrationFn[] {
        // Legacy support: 0.0.0 -> 1.0.0

        // BFS to find shortest migration path
        const queue: { version: string; path: MigrationFn[] }[] = [
            { version: from, path: [] }
        ]
        const visited = new Set<string>([from])

        while (queue.length > 0) {
            const { version, path } = queue.shift()!

            if (version === to) {
                return path
            }

            for (const m of this.migrations) {
                if (m.from === version && !visited.has(m.to)) {
                    visited.add(m.to)
                    queue.push({
                        version: m.to,
                        path: [...path, m.migrate]
                    })
                }
            }
        }

        throw new Error(
            `No migration path from ${from} to ${to}. ` +
            `Available migrations: ${this.migrations.map(m => `${m.from}->${m.to}`).join(', ')}`
        )
    }

    migrate<T>(data: any, targetVersion: string): T {
        // Handle 'undefined' version as '0.0.0'
        const sourceVersion = data._version ?? '0.0.0'

        if (sourceVersion === targetVersion) {
            return data as T
        }

        const path = this.findPath(sourceVersion, targetVersion)
        return path.reduce((acc, fn) => fn(acc), data) as T
    }
}

export const migrations = new MigrationRegistry()

// Register standard migrations
// 0.0.0 (Legacy) -> 1.0.0
migrations.register('0.0.0', '1.0.0', (data: any) => ({
    ...data,
    _version: '1.0.0'
}))
