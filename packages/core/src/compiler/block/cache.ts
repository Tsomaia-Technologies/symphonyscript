import type {BlockHash, CompiledBlock} from './types'

/**
 * Block cache for incremental compilation.
 */
export interface BlockCache {
  get(hash: BlockHash): CompiledBlock | undefined

  set(hash: BlockHash, block: CompiledBlock): void

  has(hash: BlockHash): boolean

  invalidate(hash: BlockHash): void

  clear(): void

  stats(): { hits: number; misses: number; size: number }
}

/**
 * In-memory LRU cache implementation.
 */
export class MemoryBlockCache implements BlockCache {
  private cache = new Map<BlockHash, CompiledBlock>()
  private accessOrder: BlockHash[] = []
  private hits = 0
  private misses = 0

  constructor(private maxSize: number = 100) {
  }

  get(hash: BlockHash): CompiledBlock | undefined {
    const block = this.cache.get(hash)
    if (block) {
      this.hits++
      this.touchAccess(hash)
      return block
    }
    this.misses++
    return undefined
  }

  set(hash: BlockHash, block: CompiledBlock): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }
    this.cache.set(hash, block)
    this.touchAccess(hash)
  }

  has(hash: BlockHash): boolean {
    return this.cache.has(hash)
  }

  invalidate(hash: BlockHash): void {
    this.cache.delete(hash)
    this.accessOrder = this.accessOrder.filter(h => h !== hash)
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size
    }
  }

  private touchAccess(hash: BlockHash): void {
    this.accessOrder = this.accessOrder.filter(h => h !== hash)
    this.accessOrder.push(hash)
  }

  private evictLRU(): void {
    const oldest = this.accessOrder.shift()
    if (oldest) {
      this.cache.delete(oldest)
    }
  }
}

let defaultCache: BlockCache = new MemoryBlockCache()

export function getDefaultCache(): BlockCache {
  return defaultCache
}

export function setDefaultCache(cache: BlockCache): void {
  defaultCache = cache
}
