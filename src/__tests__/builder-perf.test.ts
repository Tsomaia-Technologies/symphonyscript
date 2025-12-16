// =============================================================================
// SymphonyScript - Builder Allocation Benchmark (Jest test)
// =============================================================================

import { describe, expect, it } from '@jest/globals'
import { Clip } from '../index'

function benchmarkImmutableBuilder(iterations: number): number {
  const start = performance.now()

  let builder = Clip.melody('Benchmark')
  for (let i = 0; i < iterations; i++) {
    builder = (builder as any).note('C4', '4n').velocity(0.8).commit()
  }
  builder.build()

  return performance.now() - start
}

function benchmarkMixedOperations(iterations: number): number {
  const start = performance.now()

  let builder = Clip.melody('Mixed Benchmark')
  for (let i = 0; i < iterations; i++) {
    builder = (builder as any)
      .note('C4', '4n').velocity(0.8).commit()
      .rest('8n')
  }
  builder.build()

  return performance.now() - start
}

describe('Builder Performance Benchmark', () => {
  it('measures baseline performance (1000 notes)', () => {
    // Warmup
    benchmarkImmutableBuilder(100)

    const times: number[] = []
    for (let run = 0; run < 5; run++) {
      times.push(benchmarkImmutableBuilder(1000))
    }
    const median = times.sort((a, b) => a - b)[2]
    const opsPerSec = Math.round(1000 / (median / 1000))

    console.log(`1,000 notes: ${median.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`)

    // Just verify it completes - no assertions on speed
    expect(median).toBeGreaterThan(0)
  })

  it('measures baseline performance (10000 notes)', () => {
    const times: number[] = []
    for (let run = 0; run < 3; run++) {
      times.push(benchmarkImmutableBuilder(10000))
    }
    const median = times.sort((a, b) => a - b)[1]
    const opsPerSec = Math.round(10000 / (median / 1000))

    console.log(`10,000 notes: ${median.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`)

    expect(median).toBeGreaterThan(0)
  })

  it('measures mixed operations (1000 iterations)', () => {
    const times: number[] = []
    for (let run = 0; run < 3; run++) {
      times.push(benchmarkMixedOperations(1000))
    }
    const median = times.sort((a, b) => a - b)[1]
    const opsPerSec = Math.round(2000 / (median / 1000))  // 2 ops per iteration

    console.log(`1,000 mixed iterations: ${median.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`)

    expect(median).toBeGreaterThan(0)
  })
})
