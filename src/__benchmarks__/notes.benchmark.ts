import { ClipFactory } from '@symphonyscript/core'
import { compileClip } from '@symphonyscript/core'
import { performance } from 'perf_hooks'

function runBenchmark() {
  console.log('Starting Benchmark...')

  // Warmup
  let b = ClipFactory.melody()
  for (let i = 0; i < 100; i++) b = (b.note('C4', '4n').commit() as any)
  compileClip(b.build(), { bpm: 120 })

  const sizes = [100, 1000, 5000]

  for (const size of sizes) {
    console.log(`\n--- Benchmarking ${size} notes ---`)

    // Measure Builder Memory/Time
    const startBuild = performance.now()
    let builder = ClipFactory.melody()
    const startMem = process.memoryUsage().heapUsed

    for (let i = 0; i < size; i++) {
      // .note() returns cursor, so we must commit to get builder back for the loop variable
      // However, builder variable is typed as builder.
      builder = (builder.note('C4', '4n').commit() as any)
    }
    const clip = builder.build()
    const endBuild = performance.now()
    const endMem = process.memoryUsage().heapUsed

    const buildTime = endBuild - startBuild
    const buildRate = Math.round((size / buildTime) * 1000).toLocaleString()
    console.log(`Build Time: ${buildTime.toFixed(2)}ms (${buildRate} notes/sec)`)
    console.log(`Build Memory Delta: ${((endMem - startMem) / 1024 / 1024).toFixed(4)}MB`)

    // Measure Compilation Time
    if (global.gc) global.gc()
    const startCompile = performance.now()
    compileClip(clip, { bpm: 120 })
    const endCompile = performance.now()

    const compileTime = endCompile - startCompile
    const compileRate = Math.round((size / compileTime) * 1000).toLocaleString()
    console.log(`Compile Time: ${compileTime.toFixed(2)}ms (${compileRate} notes/sec)`)

    const totalTime = buildTime + compileTime
    const totalRate = Math.round((size / totalTime) * 1000).toLocaleString()
    console.log(`Total: ${totalTime.toFixed(2)}ms (${totalRate} notes/sec)`)
  }
}

runBenchmark()
