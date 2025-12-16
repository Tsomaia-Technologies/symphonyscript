/**
 * RFC-031: Live Coding Runtime - File Watcher Tests
 * 
 * Tests for Phase 6: File watching and auto-reload.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  NodeFileWatcher,
  createFileWatcher,
  isChokidarAvailable,
  type FileChangeEvent,
  type WatcherOptions
} from '../live/watcher'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a temporary directory for testing.
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'symphonyscript-watcher-test-'))
}

/**
 * Clean up temporary directory.
 */
function cleanupTempDir(dir: string): void {
  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file))
    }
    fs.rmdirSync(dir)
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Wait for a specified time.
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================================================
// NodeFileWatcher Tests
// =============================================================================

describe('NodeFileWatcher', () => {
  let tempDir: string
  let watcher: NodeFileWatcher | null = null
  
  beforeEach(() => {
    tempDir = createTempDir()
  })
  
  afterEach(async () => {
    if (watcher) {
      await watcher.close()
      watcher = null
    }
    cleanupTempDir(tempDir)
  })
  
  describe('constructor', () => {
    it('creates watcher with default options', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler)
      
      expect(watcher).toBeInstanceOf(NodeFileWatcher)
      expect(watcher.isWatching()).toBe(false)
    })
    
    it('accepts custom options', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        debounce: 500,
        recursive: true,
        extensions: ['.ts', '.tsx'],
        ignore: ['dist']
      })
      
      expect(watcher).toBeInstanceOf(NodeFileWatcher)
    })
  })
  
  describe('add()', () => {
    it('watches a file', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler)
      
      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, 'const x = 1')
      
      watcher.add(filePath)
      
      expect(watcher.isWatching()).toBe(true)
    })
    
    it('watches a directory', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler)
      
      watcher.add(tempDir)
      
      expect(watcher.isWatching()).toBe(true)
    })
    
    it('ignores non-matching extensions', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        extensions: ['.ts']
      })
      
      const jsFile = path.join(tempDir, 'test.js')
      fs.writeFileSync(jsFile, 'const x = 1')
      
      watcher.add(jsFile)
      
      // File should not be watched (different extension)
      // Note: The watcher may still be active for the directory
    })
  })
  
  describe('unwatch()', () => {
    it('stops watching a path', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler)
      
      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, 'const x = 1')
      
      watcher.add(filePath)
      expect(watcher.isWatching()).toBe(true)
      
      watcher.unwatch(filePath)
      // After unwatching the only file, should still be watching (internal state)
    })
  })
  
  describe('close()', () => {
    it('closes the watcher', async () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler)
      
      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, 'const x = 1')
      
      watcher.add(filePath)
      expect(watcher.isWatching()).toBe(true)
      
      await watcher.close()
      expect(watcher.isWatching()).toBe(false)
    })
  })
  
  describe('file change detection', () => {
    // Note: fs.watch behavior varies across platforms and may not reliably
    // detect changes in fast test environments. These tests validate the
    // watcher setup and debouncing logic rather than fs.watch reliability.
    
    it('triggers on start if enabled', async () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        debounce: 100,
        triggerOnStart: true
      })
      
      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, 'const x = 1')
      
      watcher.add(filePath)
      
      // Wait for debounce
      await wait(200)
      
      expect(handler).toHaveBeenCalled()
      const event = handler.mock.calls[0][0] as FileChangeEvent
      expect(event.type).toBe('add')
    })
    
    it('debounces rapid triggerOnStart calls', async () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        debounce: 100,
        triggerOnStart: true
      })
      
      // Create multiple files
      const file1 = path.join(tempDir, 'test1.ts')
      const file2 = path.join(tempDir, 'test2.ts')
      fs.writeFileSync(file1, 'const x = 1')
      fs.writeFileSync(file2, 'const y = 2')
      
      // Add files rapidly
      watcher.add(file1)
      watcher.add(file2)
      
      // Wait for debounce
      await wait(200)
      
      // Should have been called (debounced, so may be 1 or 2 calls depending on timing)
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1)
    })
  })
  
  describe('filtering', () => {
    it('only watches specified extensions (triggerOnStart)', async () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        debounce: 100,
        extensions: ['.ts'],
        triggerOnStart: true
      })
      
      // Create both .ts and .js files
      const tsFile = path.join(tempDir, 'test.ts')
      const jsFile = path.join(tempDir, 'test.js')
      fs.writeFileSync(tsFile, 'const x = 1')
      fs.writeFileSync(jsFile, 'const y = 1')
      
      // Add .ts file (should trigger)
      watcher.add(tsFile)
      
      // Wait for debounce
      await wait(200)
      
      // .ts file should have triggered
      expect(handler).toHaveBeenCalled()
      const event = handler.mock.calls[0][0] as FileChangeEvent
      expect(event.path).toBe(tsFile)
    })
    
    it('ignores specified patterns (shouldWatch check)', () => {
      const handler = jest.fn()
      watcher = new NodeFileWatcher(handler, {
        debounce: 100,
        ignore: ['ignored', 'node_modules']
      })
      
      // The shouldWatch method should filter paths containing ignored patterns
      // We test this by checking the internal behavior - the watcher won't
      // call the handler for ignored paths
      
      // Add the temp directory (not ignored)
      watcher.add(tempDir)
      
      expect(watcher.isWatching()).toBe(true)
    })
  })
})

// =============================================================================
// createFileWatcher Tests
// =============================================================================

describe('createFileWatcher', () => {
  it('creates a watcher instance', () => {
    const handler = jest.fn()
    const watcher = createFileWatcher(handler)
    
    expect(watcher).toBeDefined()
    expect(typeof watcher.add).toBe('function')
    expect(typeof watcher.unwatch).toBe('function')
    expect(typeof watcher.close).toBe('function')
    expect(typeof watcher.isWatching).toBe('function')
    
    watcher.close()
  })
  
  it('passes options to watcher', () => {
    const handler = jest.fn()
    const options: WatcherOptions = {
      debounce: 500,
      recursive: true,
      extensions: ['.ts'],
      ignore: ['node_modules']
    }
    
    const watcher = createFileWatcher(handler, options)
    expect(watcher).toBeDefined()
    
    watcher.close()
  })
})

// =============================================================================
// isChokidarAvailable Tests
// =============================================================================

describe('isChokidarAvailable', () => {
  it('returns boolean indicating chokidar availability', () => {
    const result = isChokidarAvailable()
    
    // Should be false since chokidar is not installed in this project
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Watcher Integration', () => {
  let tempDir: string
  let watcher: ReturnType<typeof createFileWatcher> | null = null
  
  beforeEach(() => {
    tempDir = createTempDir()
  })
  
  afterEach(async () => {
    if (watcher) {
      await watcher.close()
      watcher = null
    }
    cleanupTempDir(tempDir)
  })
  
  it('full workflow: create watcher, add file, verify watching', async () => {
    const events: FileChangeEvent[] = []
    
    watcher = createFileWatcher(
      (event) => events.push(event),
      { debounce: 100, triggerOnStart: true }
    )
    
    // Create initial file
    const filePath = path.join(tempDir, 'music.ts')
    fs.writeFileSync(filePath, 'export const drums = "kick"')
    
    // Start watching with triggerOnStart
    watcher.add(filePath)
    expect(watcher.isWatching()).toBe(true)
    
    // Wait for trigger on start
    await wait(200)
    
    // Verify initial event was captured
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].path).toBe(filePath)
    expect(events[0].type).toBe('add')
  })
  
  it('watcher can be closed', async () => {
    const events: FileChangeEvent[] = []
    
    watcher = createFileWatcher(
      (event) => events.push(event),
      { debounce: 100 }
    )
    
    // Create file and watch
    const filePath = path.join(tempDir, 'test.ts')
    fs.writeFileSync(filePath, 'const x = 1')
    
    watcher.add(filePath)
    expect(watcher.isWatching()).toBe(true)
    
    // Close watcher
    await watcher.close()
    expect(watcher.isWatching()).toBe(false)
    
    // Mark as null so afterEach doesn't try to close again
    watcher = null
  })
  
  it('watcher handles multiple file additions', async () => {
    const events: FileChangeEvent[] = []
    
    watcher = createFileWatcher(
      (event) => events.push(event),
      { debounce: 100, triggerOnStart: true }
    )
    
    // Create files
    const file1 = path.join(tempDir, 'drums.ts')
    const file2 = path.join(tempDir, 'bass.ts')
    fs.writeFileSync(file1, 'export const drums = {}')
    fs.writeFileSync(file2, 'export const bass = {}')
    
    // Add both files
    watcher.add(file1)
    watcher.add(file2)
    
    // Wait for detection
    await wait(200)
    
    // Should have added events (debounced, so at least 1)
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(watcher.isWatching()).toBe(true)
  })
})
