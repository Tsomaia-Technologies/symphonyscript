/**
 * RFC-031: Live Coding Runtime - Watcher Interface
 * 
 * Defines the contract for file watchers.
 * Implementations live in platform-specific packages:
 * - @symphonyscript/node (uses chokidar)
 * - @symphonyscript/live (generic EventWatcher)
 */

export interface Watcher {
  on(event: 'change', handler: (code: string) => void): void;
  start(): void;
  stop(): void;
  add?(path: string): void;
  remove?(path: string): void;
}

/**
 * Generic event-based watcher.
 * User wires it to any source (WebSocket, DOM events, file system).
 */
export class EventWatcher implements Watcher {
  private handlers = new Set<(code: string) => void>()
  
  /**
   * Emit a change event manually.
   * Call this when source code changes.
   */
  emit(code: string): void {
    for (const handler of this.handlers) {
      handler(code)
    }
  }
  
  on(event: 'change', handler: (code: string) => void): void {
    if (event === 'change') {
      this.handlers.add(handler)
    }
  }
  
  start(): void {
    // No-op for manual watcher
  }
  
  stop(): void {
    this.handlers.clear()
  }
}
