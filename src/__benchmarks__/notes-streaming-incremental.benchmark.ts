import { ClipFactory } from '../clip'
import { performance } from 'perf_hooks'
import { incrementalCompile } from '../compiler/incremental'
import { compileClip } from '../compiler/pipeline'

/**
 * Incremental Compilation Benchmark
 * 
 * Tests the actual use case: compile once, edit, recompile with cache reuse.
 * 
 * Key insight: Incremental partial recompile only shows benefits when clips
 * have MULTIPLE SECTIONS (separated by tempo/time-sig changes). When only
 * one section exists, partial = full recompile.
 * 
 * Scenarios:
 * 1. Baseline: Non-incremental compile
 * 2. Incremental cold compile (no cache)
 * 3. Incremental hot compile (same clip, cache hit)
 * 4. Incremental partial (change in last section, earlier sections reused)
 */

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build a clip with multiple sections using tempo changes as boundaries.
 * Each tempo change creates a new section for incremental compilation.
 */
function buildMultiSectionClip(notesPerSection: number, sectionCount: number) {
  let builder = ClipFactory.melody() as any
  
  for (let s = 0; s < sectionCount; s++) {
    // Tempo change creates section boundary (except for first section)
    if (s > 0) {
      builder = builder.tempo(120 + s)
    }
    // Add notes to this section
    for (let i = 0; i < notesPerSection; i++) {
      builder = builder.note('C4', '4n').commit()
    }
  }
  
  return builder.build()
}

/**
 * Build a modified clip where only the LAST section is changed.
 * This allows earlier sections to be reused from cache.
 */
function buildModifiedMultiSectionClip(notesPerSection: number, sectionCount: number) {
  let builder = ClipFactory.melody() as any
  
  for (let s = 0; s < sectionCount; s++) {
    if (s > 0) {
      builder = builder.tempo(120 + s)
    }
    for (let i = 0; i < notesPerSection; i++) {
      // Change first note of LAST section only
      const isLastSection = s === sectionCount - 1
      const isFirstNote = i === 0
      const note = (isLastSection && isFirstNote) ? 'D4' : 'C4'
      builder = builder.note(note, '4n').commit()
    }
  }
  
  return builder.build()
}

// =============================================================================
// Benchmark
// =============================================================================

function runBenchmark() {
  console.log('=== Incremental Compilation Benchmark ===')
  console.log('(Multi-section clips to demonstrate partial recompile benefits)\n')

  // Test configurations: total notes and section count
  const configs = [
    { totalNotes: 100,  sections: 1 },   // Single section (no partial benefit)
    { totalNotes: 1000, sections: 10 },  // 100 notes per section
    { totalNotes: 5000, sections: 10 },  // 500 notes per section
  ]

  for (const config of configs) {
    const { totalNotes, sections } = config
    const notesPerSection = Math.floor(totalNotes / sections)
    
    console.log(`\n${'='.repeat(65)}`)
    console.log(`--- ${totalNotes} notes (${sections} section${sections > 1 ? 's' : ''}, ${notesPerSection} notes each) ---`)
    console.log('='.repeat(65))

    // Build clips
    const clip = buildMultiSectionClip(notesPerSection, sections)
    const modifiedClip = buildModifiedMultiSectionClip(notesPerSection, sections)

    // ==========================================================================
    // BASELINE: Non-incremental compile
    // ==========================================================================
    console.log('\n--- Baseline (Non-incremental) ---')

    if (global.gc) global.gc()
    const baselineStart = performance.now()
    compileClip(clip, { bpm: 120, streaming: false })
    const baselineTime = performance.now() - baselineStart
    console.log(`Non-streaming: ${baselineTime.toFixed(2)}ms`)

    // ==========================================================================
    // INCREMENTAL: Cold compile (no cache)
    // ==========================================================================
    console.log('\n--- Incremental Cold (no cache) ---')

    if (global.gc) global.gc()
    const coldStart = performance.now()
    const { cache, stats: coldStats } = incrementalCompile(
      clip, null, { bpm: 120, streaming: false }
    )
    const coldTime = performance.now() - coldStart
    console.log(`Non-streaming: ${coldTime.toFixed(2)}ms (sections: ${coldStats.totalSections})`)

    // ==========================================================================
    // INCREMENTAL: Hot compile (same clip, full cache hit)
    // ==========================================================================
    console.log('\n--- Incremental Hot (cache hit, same clip object) ---')

    if (global.gc) global.gc()
    const hotStart = performance.now()
    const { stats: hotStats } = incrementalCompile(
      clip, cache, { bpm: 120, streaming: false }
    )
    const hotTime = performance.now() - hotStart
    console.log(`Non-streaming: ${hotTime.toFixed(2)}ms (reused: ${hotStats.sectionsReused}/${hotStats.totalSections})`)

    // ==========================================================================
    // INCREMENTAL: Partial recompile (change in last section)
    // ==========================================================================
    console.log('\n--- Incremental Partial (last section changed) ---')

    if (global.gc) global.gc()
    const partialStart = performance.now()
    const { stats: partialStats } = incrementalCompile(
      modifiedClip, cache, { bpm: 120, streaming: false }
    )
    const partialTime = performance.now() - partialStart
    console.log(`Non-streaming: ${partialTime.toFixed(2)}ms (recompiled: ${partialStats.sectionsRecompiled}/${partialStats.totalSections}, reused: ${partialStats.sectionsReused})`)

    // ==========================================================================
    // SUMMARY
    // ==========================================================================
    console.log(`\n--- Summary for ${totalNotes} notes (${sections} sections) ---`)
    console.log(`Baseline (non-incr):     ${baselineTime.toFixed(2).padStart(8)}ms`)
    console.log(`Incremental cold:        ${coldTime.toFixed(2).padStart(8)}ms`)
    console.log(`Incremental hot:         ${hotTime.toFixed(2).padStart(8)}ms  (${(baselineTime / hotTime).toFixed(0)}x faster)`)
    console.log(`Incremental partial:     ${partialTime.toFixed(2).padStart(8)}ms  (${(baselineTime / partialTime).toFixed(1)}x vs baseline)`)
    
    if (sections > 1) {
      console.log(`\n  -> Partial recompiled only ${partialStats.sectionsRecompiled}/${sections} sections`)
      console.log(`  -> ${partialStats.sectionsReused} sections reused from cache`)
    }
  }

  console.log('\n\n=== Benchmark Complete ===')
  console.log('\nKey takeaways:')
  console.log('- Hot compile (same clip): O(1) reference check, instant return')
  console.log('- Partial recompile: Only changed sections recompiled')
  console.log('- More sections = more potential for cache reuse')
}

runBenchmark()
