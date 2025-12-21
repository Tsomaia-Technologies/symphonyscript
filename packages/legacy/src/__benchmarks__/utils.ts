// =============================================================================
// SymphonyScript - Benchmark Utilities
// =============================================================================

import { performance } from 'perf_hooks'

// =============================================================================
// Types
// =============================================================================

export interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  stdDev: number
  heapUsedBefore: number
  heapUsedAfter: number
  heapDelta: number
}

export interface BenchmarkOptions {
  /** Number of iterations (default: 1000) */
  iterations?: number
  /** Number of warmup iterations (default: 10) */
  warmup?: number
  /** Force GC before measuring if available (default: true) */
  forceGC?: boolean
}

// =============================================================================
// Benchmark Runner
// =============================================================================

/**
 * Run a benchmark and collect performance metrics.
 * 
 * @param name - Name of the benchmark
 * @param fn - Function to benchmark
 * @param options - Benchmark configuration
 */
export function benchmark(
  name: string,
  fn: () => void,
  options: BenchmarkOptions = {}
): BenchmarkResult {
  const {
    iterations = 1000,
    warmup = 10,
    forceGC = true
  } = options

  // Warmup phase
  for (let i = 0; i < warmup; i++) {
    fn()
  }

  // Force GC if available
  if (forceGC && typeof global.gc === 'function') {
    global.gc()
  }

  // Record heap before
  const heapBefore = process.memoryUsage().heapUsed

  // Benchmark phase
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }

  // Record heap after
  const heapAfter = process.memoryUsage().heapUsed

  // Calculate statistics
  const totalMs = times.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / iterations
  const minMs = Math.min(...times)
  const maxMs = Math.max(...times)

  // Standard deviation
  const variance = times.reduce((sum, t) => sum + Math.pow(t - avgMs, 2), 0) / iterations
  const stdDev = Math.sqrt(variance)

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    stdDev,
    heapUsedBefore: heapBefore,
    heapUsedAfter: heapAfter,
    heapDelta: heapAfter - heapBefore
  }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Calculate speedup ratio relative to baseline.
 */
export function calculateSpeedup(baseline: BenchmarkResult, test: BenchmarkResult): number {
  return baseline.avgMs / test.avgMs
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (Math.abs(kb) < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

/**
 * Format a number with fixed decimal places.
 */
function formatMs(ms: number): string {
  if (ms < 0.01) return ms.toFixed(4)
  if (ms < 1) return ms.toFixed(3)
  return ms.toFixed(2)
}

/**
 * Pad string to width.
 */
function padStr(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (align === 'right') {
    return str.padStart(width)
  }
  return str.padEnd(width)
}

/**
 * Format benchmark results as a comparison table.
 * 
 * @param results - Array of benchmark results
 * @param baseline - Result to use as baseline for speedup calculation
 */
export function formatResultsTable(
  results: BenchmarkResult[],
  baseline?: BenchmarkResult
): string {
  const baselineResult = baseline ?? results[0]
  
  const lines: string[] = []
  
  // Header
  lines.push('| Compiler        | Avg (ms) | Min (ms) | Max (ms) | StdDev   | Heap Δ      | Speedup |')
  lines.push('|-----------------|----------|----------|----------|----------|-------------|---------|')
  
  // Rows
  for (const r of results) {
    const speedup = calculateSpeedup(baselineResult, r)
    const heapDelta = formatBytes(r.heapDelta)
    
    lines.push(
      '| ' +
      padStr(r.name, 15) + ' | ' +
      padStr(formatMs(r.avgMs), 8, 'right') + ' | ' +
      padStr(formatMs(r.minMs), 8, 'right') + ' | ' +
      padStr(formatMs(r.maxMs), 8, 'right') + ' | ' +
      padStr(formatMs(r.stdDev), 8, 'right') + ' | ' +
      padStr(heapDelta, 11, 'right') + ' | ' +
      padStr(speedup.toFixed(1) + 'x', 7, 'right') + ' |'
    )
  }
  
  return lines.join('\n')
}

/**
 * Print a section header.
 */
export function printHeader(title: string, width: number = 77): void {
  console.log('='.repeat(width))
  console.log(title)
  console.log('='.repeat(width))
}

/**
 * Print a scenario header.
 */
export function printScenarioHeader(name: string, description: string, width: number = 77): void {
  console.log('')
  console.log(`Scenario: ${name} (${description})`)
  console.log('-'.repeat(width))
}
