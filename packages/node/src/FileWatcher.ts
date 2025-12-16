/**
 * @symphonyscript/node - FileWatcher
 * 
 * File system watcher using chokidar.
 * Implements the Watcher interface from @symphonyscript/live.
 * 
 * BEHAVIOR: When a file changes, reads the file contents and passes
 * the code string to registered handlers (not the file path).
 */

import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'

// =============================================================================
// Watcher Interface (compatible with @symphonyscript/live)
// =============================================================================

/**
 * Watcher interface for live coding.
 * 
 * TODO: Import from @symphonyscript/live once that package builds .d.ts files.
 * This is a structural copy to avoid build-time dependency issues.
 * Must stay in sync with packages/live/src/watcher.ts
 */
export interface Watcher {
  on(event: 'change', handler: (code: string) => void): void
  start(): void
  stop(): void
  add?(path: string): void
  remove?(path: string): void
}

// =============================================================================
// Types
// =============================================================================

/**
 * FileWatcher configuration options.
 */
export interface FileWatcherOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounce?: number
  
  /** File extensions to watch (default: ['.ts', '.js']) */
  extensions?: string[]
  
  /** Patterns to ignore (glob patterns) */
  ignore?: string[]
  
  /** Whether to read file on initial add (default: false) */
  readOnAdd?: boolean
}

// =============================================================================
// Debounce Utility
// =============================================================================

/**
 * Create a debounced function.
 */
function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  
  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }) as T & { cancel: () => void }
  
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }
  
  return debounced
}

// =============================================================================
// FileWatcher Implementation
// =============================================================================

/**
 * File watcher using chokidar.
 * 
 * Watches files for changes and emits file contents (not paths) to handlers.
 * Implements the Watcher interface from @symphonyscript/live.
 * 
 * @example
 * ```typescript
 * import { FileWatcher } from '@symphonyscript/node'
 * 
 * const watcher = new FileWatcher({ extensions: ['.ts'] })
 * watcher.on('change', (code) => {
 *   console.log('File contents:', code)
 * })
 * watcher.add('./src')
 * watcher.start()
 * ```
 */
export class FileWatcher implements Watcher {
  private watcher: chokidar.FSWatcher | null = null
  private handlers = new Set<(code: string) => void>()
  private options: Required<FileWatcherOptions>
  private started = false
  private pendingPaths = new Set<string>()
  private debouncedEmit: ReturnType<typeof debounce>
  
  constructor(options: FileWatcherOptions = {}) {
    this.options = {
      debounce: options.debounce ?? 300,
      extensions: options.extensions ?? ['.ts', '.js'],
      ignore: options.ignore ?? ['**/node_modules/**', '**/.git/**', '**/*.d.ts'],
      readOnAdd: options.readOnAdd ?? false
    }
    
    // Create debounced emit function that processes accumulated paths
    this.debouncedEmit = debounce(() => {
      for (const filePath of this.pendingPaths) {
        this.emitFileContents(filePath)
      }
      this.pendingPaths.clear()
    }, this.options.debounce)
    
    // Initialize chokidar watcher
    this.watcher = chokidar.watch([], {
      ignored: this.options.ignore,
      persistent: true,
      ignoreInitial: !this.options.readOnAdd
    })
    
    // Handle file add events (new files)
    this.watcher.on('add', (filePath: string) => {
      if (this.started && this.shouldWatch(filePath)) {
        this.queuePath(filePath)
      }
    })
    
    // Handle file change events (modified files)
    this.watcher.on('change', (filePath: string) => {
      if (this.started && this.shouldWatch(filePath)) {
        this.queuePath(filePath)
      }
    })
    
    this.watcher.on('error', (error: Error) => {
      console.error('[FileWatcher] Error:', error.message)
    })
  }
  
  /**
   * Register a handler for file changes.
   * Handler receives file contents as a string.
   */
  on(event: 'change', handler: (code: string) => void): void {
    if (event === 'change') {
      this.handlers.add(handler)
    }
  }
  
  /**
   * Start watching for file changes.
   */
  start(): void {
    this.started = true
  }
  
  /**
   * Stop watching for file changes.
   */
  stop(): void {
    this.started = false
    this.debouncedEmit.cancel()
    this.pendingPaths.clear()
    this.handlers.clear()
    
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
  
  /**
   * Add a file or directory to watch.
   */
  add(watchPath: string): void {
    if (this.watcher) {
      this.watcher.add(watchPath)
    }
  }
  
  /**
   * Remove a file or directory from watch list.
   */
  remove(watchPath: string): void {
    if (this.watcher) {
      this.watcher.unwatch(watchPath)
    }
  }
  
  /**
   * Check if a file should be watched based on extension.
   */
  private shouldWatch(filePath: string): boolean {
    const ext = path.extname(filePath)
    return this.options.extensions.includes(ext)
  }
  
  /**
   * Queue a path for debounced processing.
   */
  private queuePath(filePath: string): void {
    this.pendingPaths.add(filePath)
    this.debouncedEmit()
  }
  
  /**
   * Read file and emit contents to all handlers.
   */
  private emitFileContents(filePath: string): void {
    try {
      const contents = fs.readFileSync(filePath, 'utf-8')
      for (const handler of this.handlers) {
        handler(contents)
      }
    } catch (error) {
      // File may have been deleted between event and read,
      // or permission denied, or locked by another process.
      // Log warning but don't crash.
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[FileWatcher] Failed to read ${filePath}: ${message}`)
    }
  }
}
