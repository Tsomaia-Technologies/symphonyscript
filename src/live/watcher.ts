/**
 * RFC-031: Live Coding Runtime - File Watcher
 * 
 * Watches files for changes and triggers live session updates.
 * Uses chokidar if available, falls back to Node.js fs.watch.
 */

import * as fs from 'fs'
import * as path from 'path'

// =============================================================================
// Types
// =============================================================================

/**
 * File watcher configuration.
 */
export interface WatcherOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounce?: number
  
  /** Whether to watch recursively (default: false) */
  recursive?: boolean
  
  /** File extensions to watch (default: ['.ts', '.js']) */
  extensions?: string[]
  
  /** Patterns to ignore (glob patterns) */
  ignore?: string[]
  
  /** Whether to trigger on initial load (default: false) */
  triggerOnStart?: boolean
}

/**
 * File change event.
 */
export interface FileChangeEvent {
  /** Type of change */
  type: 'add' | 'change' | 'unlink'
  
  /** Absolute path to the file */
  path: string
  
  /** Timestamp of the change */
  timestamp: number
}

/**
 * File change handler.
 */
export type FileChangeHandler = (event: FileChangeEvent) => void

/**
 * Watcher interface - abstraction over chokidar/fs.watch.
 */
export interface FileWatcher {
  /** Add a file or directory to watch */
  add(path: string): void
  
  /** Remove a watched path */
  unwatch(path: string): void
  
  /** Close the watcher */
  close(): Promise<void>
  
  /** Whether the watcher is active */
  isWatching(): boolean
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
// File Watcher Implementation (Node.js fs.watch)
// =============================================================================

/**
 * File watcher using Node.js fs.watch.
 * Falls back to this when chokidar is not available.
 */
export class NodeFileWatcher implements FileWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map()
  private handler: FileChangeHandler
  private debouncedHandler: ReturnType<typeof debounce>
  private options: Required<WatcherOptions>
  private closed: boolean = false
  private pendingChanges: Map<string, FileChangeEvent> = new Map()
  
  constructor(handler: FileChangeHandler, options: WatcherOptions = {}) {
    this.handler = handler
    this.options = {
      debounce: options.debounce ?? 300,
      recursive: options.recursive ?? false,
      extensions: options.extensions ?? ['.ts', '.js'],
      ignore: options.ignore ?? ['node_modules', '.git'],
      triggerOnStart: options.triggerOnStart ?? false
    }
    
    // Create debounced handler that processes accumulated changes
    this.debouncedHandler = debounce(() => {
      for (const event of this.pendingChanges.values()) {
        this.handler(event)
      }
      this.pendingChanges.clear()
    }, this.options.debounce)
  }
  
  /**
   * Add a file or directory to watch.
   */
  add(watchPath: string): void {
    if (this.closed) return
    
    const absolutePath = path.resolve(watchPath)
    
    // Don't watch if already watching
    if (this.watchers.has(absolutePath)) return
    
    try {
      const stats = fs.statSync(absolutePath)
      
      if (stats.isDirectory()) {
        this.watchDirectory(absolutePath)
      } else if (stats.isFile()) {
        this.watchFile(absolutePath)
      }
      
      // Trigger on start if enabled
      if (this.options.triggerOnStart && stats.isFile()) {
        this.queueChange('add', absolutePath)
      }
      
    } catch (error) {
      console.error(`Failed to watch path: ${absolutePath}`, error)
    }
  }
  
  /**
   * Watch a single file.
   */
  private watchFile(filePath: string): void {
    if (!this.shouldWatch(filePath)) return
    
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          this.queueChange('change', filePath)
        }
      })
      
      watcher.on('error', (error) => {
        console.error(`Watch error for ${filePath}:`, error)
      })
      
      this.watchers.set(filePath, watcher)
    } catch (error) {
      console.error(`Failed to watch file: ${filePath}`, error)
    }
  }
  
  /**
   * Watch a directory.
   */
  private watchDirectory(dirPath: string): void {
    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: this.options.recursive },
        (eventType, filename) => {
          if (!filename) return
          
          const fullPath = path.join(dirPath, filename)
          
          if (!this.shouldWatch(fullPath)) return
          
          // Determine event type
          try {
            fs.statSync(fullPath)
            this.queueChange(eventType === 'rename' ? 'add' : 'change', fullPath)
          } catch {
            // File was deleted
            this.queueChange('unlink', fullPath)
          }
        }
      )
      
      watcher.on('error', (error) => {
        console.error(`Watch error for ${dirPath}:`, error)
      })
      
      this.watchers.set(dirPath, watcher)
    } catch (error) {
      console.error(`Failed to watch directory: ${dirPath}`, error)
    }
  }
  
  /**
   * Check if a path should be watched.
   */
  private shouldWatch(filePath: string): boolean {
    // Check extension
    const ext = path.extname(filePath)
    if (ext && !this.options.extensions.includes(ext)) {
      return false
    }
    
    // Check ignore patterns
    for (const pattern of this.options.ignore) {
      if (filePath.includes(pattern)) {
        return false
      }
    }
    
    return true
  }
  
  /**
   * Queue a change event (for debouncing).
   */
  private queueChange(type: FileChangeEvent['type'], filePath: string): void {
    this.pendingChanges.set(filePath, {
      type,
      path: filePath,
      timestamp: Date.now()
    })
    this.debouncedHandler()
  }
  
  /**
   * Remove a watched path.
   */
  unwatch(watchPath: string): void {
    const absolutePath = path.resolve(watchPath)
    const watcher = this.watchers.get(absolutePath)
    
    if (watcher) {
      watcher.close()
      this.watchers.delete(absolutePath)
    }
  }
  
  /**
   * Close the watcher.
   */
  async close(): Promise<void> {
    this.closed = true
    this.debouncedHandler.cancel()
    
    for (const watcher of this.watchers.values()) {
      watcher.close()
    }
    
    this.watchers.clear()
    this.pendingChanges.clear()
  }
  
  /**
   * Check if watcher is active.
   */
  isWatching(): boolean {
    return !this.closed && this.watchers.size > 0
  }
}

// =============================================================================
// Chokidar Watcher (Optional)
// =============================================================================

/**
 * Try to load chokidar if available.
 */
let chokidar: any = null
try {
  chokidar = require('chokidar')
} catch {
  // Chokidar not installed - will use NodeFileWatcher
}

/**
 * File watcher using chokidar (if available).
 * Provides better cross-platform support and more features.
 */
export class ChokidarWatcher implements FileWatcher {
  private watcher: any
  private handler: FileChangeHandler
  private debouncedHandler: ReturnType<typeof debounce>
  private options: Required<WatcherOptions>
  private closed: boolean = false
  private pendingChanges: Map<string, FileChangeEvent> = new Map()
  
  constructor(handler: FileChangeHandler, options: WatcherOptions = {}) {
    if (!chokidar) {
      throw new Error('Chokidar is not installed. Use NodeFileWatcher instead.')
    }
    
    this.handler = handler
    this.options = {
      debounce: options.debounce ?? 300,
      recursive: options.recursive ?? false,
      extensions: options.extensions ?? ['.ts', '.js'],
      ignore: options.ignore ?? ['node_modules', '.git', '**/*.d.ts'],
      triggerOnStart: options.triggerOnStart ?? false
    }
    
    // Create debounced handler
    this.debouncedHandler = debounce(() => {
      for (const event of this.pendingChanges.values()) {
        this.handler(event)
      }
      this.pendingChanges.clear()
    }, this.options.debounce)
    
    // Build glob patterns for extensions
    const extPattern = this.options.extensions.length === 1
      ? `**/*${this.options.extensions[0]}`
      : `**/*{${this.options.extensions.join(',')}}`
    
    // Initialize chokidar
    this.watcher = chokidar.watch([], {
      ignored: this.options.ignore,
      persistent: true,
      ignoreInitial: !this.options.triggerOnStart,
      depth: this.options.recursive ? undefined : 0
    })
    
    // Set up event handlers
    this.watcher.on('add', (filePath: string) => {
      if (this.shouldWatch(filePath)) {
        this.queueChange('add', filePath)
      }
    })
    
    this.watcher.on('change', (filePath: string) => {
      if (this.shouldWatch(filePath)) {
        this.queueChange('change', filePath)
      }
    })
    
    this.watcher.on('unlink', (filePath: string) => {
      if (this.shouldWatch(filePath)) {
        this.queueChange('unlink', filePath)
      }
    })
    
    this.watcher.on('error', (error: Error) => {
      console.error('Chokidar watcher error:', error)
    })
  }
  
  /**
   * Check if a path should be watched.
   */
  private shouldWatch(filePath: string): boolean {
    const ext = path.extname(filePath)
    return this.options.extensions.includes(ext)
  }
  
  /**
   * Queue a change event.
   */
  private queueChange(type: FileChangeEvent['type'], filePath: string): void {
    this.pendingChanges.set(filePath, {
      type,
      path: filePath,
      timestamp: Date.now()
    })
    this.debouncedHandler()
  }
  
  /**
   * Add a path to watch.
   */
  add(watchPath: string): void {
    if (this.closed) return
    this.watcher.add(watchPath)
  }
  
  /**
   * Remove a watched path.
   */
  unwatch(watchPath: string): void {
    this.watcher.unwatch(watchPath)
  }
  
  /**
   * Close the watcher.
   */
  async close(): Promise<void> {
    this.closed = true
    this.debouncedHandler.cancel()
    await this.watcher.close()
    this.pendingChanges.clear()
  }
  
  /**
   * Check if watcher is active.
   */
  isWatching(): boolean {
    return !this.closed
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a file watcher.
 * Uses chokidar if available, otherwise falls back to Node.js fs.watch.
 * 
 * @param handler - Function to call on file changes
 * @param options - Watcher configuration
 * @returns FileWatcher instance
 */
export function createFileWatcher(
  handler: FileChangeHandler,
  options: WatcherOptions = {}
): FileWatcher {
  if (chokidar) {
    return new ChokidarWatcher(handler, options)
  }
  return new NodeFileWatcher(handler, options)
}

/**
 * Check if chokidar is available.
 */
export function isChokidarAvailable(): boolean {
  return chokidar !== null
}

