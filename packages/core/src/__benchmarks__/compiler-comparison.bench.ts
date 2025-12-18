// =============================================================================
// SymphonyScript - Compiler Performance Comparison Benchmark
// =============================================================================
//
// Compares three compilation paths:
// 1. Legacy AST: MelodyBuilder → compileClip()
// 2. Tree-based: Clip.melody() → compileBuilderToVM()
// 3. Zero-alloc: Clip.melody() → compileBuilderToVMZeroAlloc()
//
// Run with: npx tsx src/__benchmarks__/compiler-comparison.bench.ts
// Run with GC: node --expose-gc --import tsx src/__benchmarks__/compiler-comparison.bench.ts
//
// =============================================================================

import {
  benchmark,
  formatResultsTable,
  printHeader,
  printScenarioHeader,
  type BenchmarkResult
} from './utils'

import {
  SCENARIOS,
  prebuildAllScenarios,
  type ScenarioConfig
} from './scenarios'

// Import compilers
import { compileClip } from '../compiler/pipeline'
import { compileBuilderToVM } from '../builder/compiler'
import { compileBuilderToVMZeroAlloc, ZeroAllocCompiler } from '../builder/compiler-zero-alloc'

// =============================================================================
// Configuration
// =============================================================================

const ITERATIONS = 1000
const WARMUP = 50
const SEED = 12345

// =============================================================================
// Benchmark Runners
// =============================================================================

interface ScenarioBenchmarks {
  legacy: BenchmarkResult
  treeBased: BenchmarkResult
  zeroAlloc: BenchmarkResult
}

function runScenarioBenchmarks(
  scenarioKey: string,
  config: ScenarioConfig,
  prebuilt: ReturnType<typeof prebuildAllScenarios>[string]
): ScenarioBenchmarks {
  const { legacy, builder } = prebuilt

  // Benchmark 1: Legacy AST Pipeline
  const legacyResult = benchmark(
    'Legacy AST',
    () => {
      compileClip(legacy.clip, { bpm: 120, seed: SEED })
    },
    { iterations: ITERATIONS, warmup: WARMUP }
  )

  // Benchmark 2: Tree-based Compiler (RFC-040)
  const treeResult = benchmark(
    'Tree-based',
    () => {
      compileBuilderToVM(builder.buf, 96, SEED, builder.grooveTemplates, false)
    },
    { iterations: ITERATIONS, warmup: WARMUP }
  )

  // Benchmark 3: Zero-allocation Compiler (RFC-041)
  // Pre-create a compiler instance to reuse across iterations
  const zeroAllocCompiler = new ZeroAllocCompiler()

  const zeroAllocResult = benchmark(
    'Zero-alloc',
    () => {
      zeroAllocCompiler.compile(builder.buf, {
        ppq: 96,
        seed: SEED,
        grooveTemplates: builder.grooveTemplates,
        unroll: false
      })
    },
    { iterations: ITERATIONS, warmup: WARMUP }
  )

  return {
    legacy: legacyResult,
    treeBased: treeResult,
    zeroAlloc: zeroAllocResult
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  printHeader('SymphonyScript Compiler Benchmark')
  console.log(`Iterations: ${ITERATIONS} | Warmup: ${WARMUP} | Seed: ${SEED}`)
  console.log(`GC available: ${typeof global.gc === 'function' ? 'Yes' : 'No (run with --expose-gc for accurate heap metrics)'}`)
  console.log('')

  // Pre-build all scenarios
  console.log('Building scenarios...')
  const scenarios = prebuildAllScenarios()
  console.log('Scenarios built.')

  // Run benchmarks for each scenario
  const allResults: Record<string, ScenarioBenchmarks> = {}

  for (const [key, config] of Object.entries(SCENARIOS)) {
    printScenarioHeader(config.name, config.description)

    const results = runScenarioBenchmarks(key, config, scenarios[key])
    allResults[key] = results

    // Print results table (legacy as baseline)
    console.log(formatResultsTable(
      [results.legacy, results.treeBased, results.zeroAlloc],
      results.legacy
    ))
  }

  // Summary
  console.log('')
  printHeader('Summary')

  // Calculate average speedups across all scenarios
  let totalLegacyMs = 0
  let totalTreeMs = 0
  let totalZeroMs = 0

  for (const results of Object.values(allResults)) {
    totalLegacyMs += results.legacy.avgMs
    totalTreeMs += results.treeBased.avgMs
    totalZeroMs += results.zeroAlloc.avgMs
  }

  const scenarioCount = Object.keys(allResults).length
  const avgLegacy = totalLegacyMs / scenarioCount
  const avgTree = totalTreeMs / scenarioCount
  const avgZero = totalZeroMs / scenarioCount

  console.log('Average Performance (across all scenarios):')
  console.log(`  Legacy AST:  ${avgLegacy.toFixed(3)} ms`)
  console.log(`  Tree-based:  ${avgTree.toFixed(3)} ms (${(avgLegacy / avgTree).toFixed(1)}x faster)`)
  console.log(`  Zero-alloc:  ${avgZero.toFixed(3)} ms (${(avgLegacy / avgZero).toFixed(1)}x faster)`)
  console.log('')

  // Heap usage summary (from stress test)
  const stressResults = allResults['stress']
  if (stressResults) {
    console.log('Memory Usage (Stress scenario):')
    console.log(`  Legacy AST:  ${formatHeapDelta(stressResults.legacy.heapDelta)}`)
    console.log(`  Tree-based:  ${formatHeapDelta(stressResults.treeBased.heapDelta)}`)
    console.log(`  Zero-alloc:  ${formatHeapDelta(stressResults.zeroAlloc.heapDelta)}`)
  }

  console.log('')
  console.log('Benchmark complete.')
}

function formatHeapDelta(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (Math.abs(kb) < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

// Run
main().catch(console.error)
