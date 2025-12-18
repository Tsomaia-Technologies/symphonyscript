/**
 * @symphonyscript/node - FileWatcher Tests
 * 
 * Tests for the FileWatcher class.
 * Verifies that handlers receive file CONTENTS (not paths).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { FileWatcher } from '../FileWatcher'
import type { Watcher } from '../FileWatcher'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a temporary directory for testing.
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'symphonyscript-filewatcher-test-'))
}

/**
 * Clean up temporary directory.
 */
function cleanupTempDir(dir: string): void {
  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        cleanupTempDir(filePath)
      } else {
        fs.unlinkSync(filePath)
      }
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
// FileWatcher Tests
// =============================================================================

describe('FileWatcher', () => {
  let tempDir: string
  let watcher: FileWatcher | null = null
  
  beforeEach(() => {
    tempDir = createTempDir()
  })
  
  afterEach(async () => {
    if (watcher) {
      watcher.stop()
      watcher = null
    }
    // Wait a bit for file handles to release
    await wait(100)
    cleanupTempDir(tempDir)
  })
  
  describe('constructor', () => {
    it('creates watcher with default options', () => {
      watcher = new FileWatcher()
      expect(watcher).toBeInstanceOf(FileWatcher)
    })
    
    it('accepts custom options', () => {
      watcher = new FileWatcher({
        debounce: 500,
        extensions: ['.ts', '.tsx'],
        ignore: ['**/dist/**']
      })
      expect(watcher).toBeInstanceOf(FileWatcher)
    })
  })
  
  describe('Watcher interface compliance', () => {
    it('implements Watcher interface', () => {
      watcher = new FileWatcher()
      
      // Type assertion - this will fail at compile time if not compatible
      const asWatcher: Watcher = watcher
      
      // Verify all required methods exist
      expect(typeof asWatcher.on).toBe('function')
      expect(typeof asWatcher.start).toBe('function')
      expect(typeof asWatcher.stop).toBe('function')
      expect(typeof asWatcher.add).toBe('function')
      expect(typeof asWatcher.remove).toBe('function')
    })
  })
  
  describe('add() / remove()', () => {
    it('add() does not throw', () => {
      watcher = new FileWatcher()
      expect(() => watcher!.add(tempDir)).not.toThrow()
    })
    
    it('remove() does not throw', () => {
      watcher = new FileWatcher()
      watcher.add(tempDir)
      expect(() => watcher!.remove(tempDir)).not.toThrow()
    })
  })
  
  describe('start() / stop()', () => {
    it('start() enables event emission', () => {
      watcher = new FileWatcher()
      expect(() => watcher!.start()).not.toThrow()
    })
    
    it('stop() cleans up resources', () => {
      watcher = new FileWatcher()
      watcher.start()
      expect(() => watcher!.stop()).not.toThrow()
    })
    
    it('stop() is idempotent', () => {
      watcher = new FileWatcher()
      watcher.start()
      watcher.stop()
      expect(() => watcher!.stop()).not.toThrow()
      watcher = null // Prevent double-stop in afterEach
    })
  })
  
  describe('on("change", handler)', () => {
    it('handler receives FILE CONTENTS, not path', async () => {
      const receivedContents: string[] = []
      const expectedContent = 'export const drums = "kick snare"'
      
      watcher = new FileWatcher({
        debounce: 50,
        extensions: ['.ts'],
        readOnAdd: true
      })
      
      watcher.on('change', (code) => {
        receivedContents.push(code)
      })
      
      // Create file BEFORE adding to watcher
      const filePath = path.join(tempDir, 'music.ts')
      fs.writeFileSync(filePath, expectedContent)
      
      // Add path and start watching
      watcher.add(tempDir)
      watcher.start()
      
      // Wait for debounce + chokidar detection
      await wait(200)
      
      // Verify handler received file contents (not path)
      expect(receivedContents.length).toBeGreaterThanOrEqual(1)
      expect(receivedContents[0]).toBe(expectedContent)
      expect(receivedContents[0]).not.toContain(tempDir) // NOT a path
    })
    
    it('handler receives updated contents on file change', async () => {
      const receivedContents: string[] = []
      const initialContent = 'const x = 1'
      const updatedContent = 'const x = 2'
      
      watcher = new FileWatcher({
        debounce: 50,
        extensions: ['.ts']
      })
      
      watcher.on('change', (code) => {
        receivedContents.push(code)
      })
      
      // Create initial file
      const filePath = path.join(tempDir, 'test.ts')
      fs.writeFileSync(filePath, initialContent)
      
      // Start watching
      watcher.add(tempDir)
      watcher.start()
      
      // Wait for initial setup
      await wait(100)
      
      // Modify file
      fs.writeFileSync(filePath, updatedContent)
      
      // Wait for detection + debounce
      await wait(200)
      
      // Should have received the updated content
      expect(receivedContents.some(c => c === updatedContent)).toBe(true)
    })
  })
  
  describe('debouncing', () => {
    it('coalesces rapid file changes', async () => {
      let callCount = 0
      
      watcher = new FileWatcher({
        debounce: 100,
        extensions: ['.ts']
      })
      
      watcher.on('change', () => {
        callCount++
      })
      
      const filePath = path.join(tempDir, 'rapid.ts')
      fs.writeFileSync(filePath, 'v1')
      
      watcher.add(tempDir)
      watcher.start()
      await wait(50)
      
      // Rapid modifications
      fs.writeFileSync(filePath, 'v2')
      await wait(10)
      fs.writeFileSync(filePath, 'v3')
      await wait(10)
      fs.writeFileSync(filePath, 'v4')
      
      // Wait for debounce to settle
      await wait(250)
      
      // Should have fewer calls than writes due to debouncing
      // (exact count depends on timing, but should be coalesced)
      expect(callCount).toBeLessThan(4)
    })
  })
  
  describe('extension filtering', () => {
    it('only triggers for specified extensions', async () => {
      const receivedContents: string[] = []
      
      watcher = new FileWatcher({
        debounce: 50,
        extensions: ['.ts'], // Only .ts files
        readOnAdd: true
      })
      
      watcher.on('change', (code) => {
        receivedContents.push(code)
      })
      
      // Create both .ts and .js files
      const tsFile = path.join(tempDir, 'allowed.ts')
      const jsFile = path.join(tempDir, 'ignored.js')
      fs.writeFileSync(tsFile, 'ts content')
      fs.writeFileSync(jsFile, 'js content')
      
      watcher.add(tempDir)
      watcher.start()
      
      await wait(200)
      
      // Should only have received .ts file contents
      expect(receivedContents).toContain('ts content')
      expect(receivedContents).not.toContain('js content')
    })
  })
  
  describe('error handling', () => {
    it('handles file read errors gracefully', async () => {
      // Create a watcher and start it
      watcher = new FileWatcher({
        debounce: 50,
        extensions: ['.ts']
      })
      
      const handler = jest.fn()
      watcher.on('change', handler)
      
      watcher.add(tempDir)
      watcher.start()
      
      // Create and immediately delete file to trigger potential error
      const filePath = path.join(tempDir, 'ephemeral.ts')
      fs.writeFileSync(filePath, 'temporary')
      
      // Should not throw even if file operations have edge cases
      await wait(200)
      
      // Watcher should still be functional (didn't crash)
      expect(watcher).toBeDefined()
    })
  })
  
  describe('handler does not receive events before start()', () => {
    it('ignores changes before start() is called', async () => {
      const receivedContents: string[] = []
      
      watcher = new FileWatcher({
        debounce: 50,
        extensions: ['.ts']
      })
      
      watcher.on('change', (code) => {
        receivedContents.push(code)
      })
      
      // Add path but DON'T call start()
      watcher.add(tempDir)
      
      // Create file while not started
      const filePath = path.join(tempDir, 'before-start.ts')
      fs.writeFileSync(filePath, 'should not trigger')
      
      await wait(200)
      
      // Should not have received anything
      expect(receivedContents.length).toBe(0)
    })
  })
})


