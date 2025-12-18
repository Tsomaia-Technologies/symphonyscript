// =============================================================================
// SymphonyScript - Compiler Performance Comparison Benchmark (Jest Runner)
// =============================================================================
//
// Run with: npm run bench
//
// =============================================================================

/* eslint-disable @typescript-eslint/no-require-imports */
// Use Jest globals (injected by Jest runtime)

import {
  benchmark,
  formatResultsTable,
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

const ITERATIONS = 100  // Reduced for test mode
const WARMUP = 10
const SEED = 12345

// =============================================================================
// Benchmark Tests
// =============================================================================

describe('Compiler Performance Comparison', () => {
  // Pre-build all scenarios once
  const scenarios = prebuildAllScenarios()

  for (const [key, config] of Object.entries(SCENARIOS)) {
    describe(`Scenario: ${config.name}`, () => {
      const prebuilt = scenarios[key]

      it(`benchmarks Legacy AST (${config.description})`, () => {
        const result = benchmark(
          'Legacy AST',
          () => {
            compileClip(prebuilt.legacy.clip, { bpm: 120, seed: SEED })
          },
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        console.log(`  Legacy AST: ${result.avgMs.toFixed(3)} ms (min: ${result.minMs.toFixed(3)}, max: ${result.maxMs.toFixed(3)})`)
        expect(result.avgMs).toBeGreaterThan(0)
      })

      it(`benchmarks Tree-based (${config.description})`, () => {
        const result = benchmark(
          'Tree-based',
          () => {
            compileBuilderToVM(
              prebuilt.builder.buf,
              96,
              SEED,
              prebuilt.builder.grooveTemplates,
              false
            )
          },
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        console.log(`  Tree-based: ${result.avgMs.toFixed(3)} ms (min: ${result.minMs.toFixed(3)}, max: ${result.maxMs.toFixed(3)})`)
        expect(result.avgMs).toBeGreaterThan(0)
      })

      it(`benchmarks Zero-alloc (${config.description})`, () => {
        const compiler = new ZeroAllocCompiler()

        const result = benchmark(
          'Zero-alloc',
          () => {
            compiler.compile(prebuilt.builder.buf, {
              ppq: 96,
              seed: SEED,
              grooveTemplates: prebuilt.builder.grooveTemplates,
              unroll: false
            })
          },
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        console.log(`  Zero-alloc: ${result.avgMs.toFixed(3)} ms (min: ${result.minMs.toFixed(3)}, max: ${result.maxMs.toFixed(3)})`)
        expect(result.avgMs).toBeGreaterThan(0)
      })

      it(`prints comparison table for ${config.name}`, () => {
        const legacyResult = benchmark(
          'Legacy AST',
          () => compileClip(prebuilt.legacy.clip, { bpm: 120, seed: SEED }),
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        const treeResult = benchmark(
          'Tree-based',
          () => compileBuilderToVM(prebuilt.builder.buf, 96, SEED, prebuilt.builder.grooveTemplates, false),
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        const compiler = new ZeroAllocCompiler()
        const zeroResult = benchmark(
          'Zero-alloc',
          () => compiler.compile(prebuilt.builder.buf, { ppq: 96, seed: SEED, grooveTemplates: prebuilt.builder.grooveTemplates, unroll: false }),
          { iterations: ITERATIONS, warmup: WARMUP }
        )

        console.log('\n' + '-'.repeat(77))
        console.log(`Scenario: ${config.name} (${config.description})`)
        console.log('-'.repeat(77))
        console.log(formatResultsTable([legacyResult, treeResult, zeroResult], legacyResult))
        console.log('')

        // Verify zero-alloc is fastest
        expect(zeroResult.avgMs).toBeLessThanOrEqual(legacyResult.avgMs)
      })
    })
  }
})
