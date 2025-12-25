#!/usr/bin/env node
// =============================================================================
// SymphonyScript - Standalone Benchmark (No Jest)
// =============================================================================
// Run with: node packages/kernel/src/__tests__/benchmark-standalone.cjs
// Or after build: node packages/kernel/benchmark-standalone.cjs

const { SiliconSynapse, OPCODE, FLAG } = require('../dist/index.js');

// ANSI colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

console.log('='.repeat(60));
console.log('SymphonyScript Kernel Benchmark (Standalone - No Jest)');
console.log('='.repeat(60));
console.log('');

// -----------------------------------------------------------------------------
// Test 1: 5000 insertions WITH ID table (sourceId = i+1)
// -----------------------------------------------------------------------------
console.log('Test 1: 5000 insertions WITH ID table');
console.log('-'.repeat(40));

const linker1 = SiliconSynapse.create({ nodeCapacity: 12000, safeZoneTicks: 0 });
const start1 = performance.now();

for (let i = 0; i < 5000; i++) {
    linker1.insertHead(
        OPCODE.NOTE,
        60 + (i % 12),
        80 + (i % 40),
        480,
        i * 120,
        i + 1, // sourceId - uses ID table
        FLAG.ACTIVE
    );
}

const elapsed1 = performance.now() - start1;
const perOp1 = (elapsed1 / 5000 * 1000).toFixed(1);
const nodeCount1 = linker1.getNodeCount();

console.log(`  Total time:    ${elapsed1.toFixed(2)} ms`);
console.log(`  Per-op:        ${perOp1} µs`);
console.log(`  Nodes:         ${nodeCount1}`);
console.log(`  Target:        < 500 ms`);
console.log(`  Result:        ${elapsed1 < 500 ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET}`);
console.log('');

// -----------------------------------------------------------------------------
// Test 2: 5000 insertions WITHOUT ID table (sourceId = 0)
// -----------------------------------------------------------------------------
console.log('Test 2: 5000 insertions WITHOUT ID table (baseline)');
console.log('-'.repeat(40));

const linker2 = SiliconSynapse.create({ nodeCapacity: 12000, safeZoneTicks: 0 });
const start2 = performance.now();

for (let i = 0; i < 5000; i++) {
    linker2.insertHead(
        OPCODE.NOTE,
        60 + (i % 12),
        80 + (i % 40),
        480,
        i * 120,
        0, // sourceId = 0, skips ID table
        FLAG.ACTIVE
    );
}

const elapsed2 = performance.now() - start2;
const perOp2 = (elapsed2 / 5000 * 1000).toFixed(1);
const nodeCount2 = linker2.getNodeCount();

console.log(`  Total time:    ${elapsed2.toFixed(2)} ms`);
console.log(`  Per-op:        ${perOp2} µs`);
console.log(`  Nodes:         ${nodeCount2}`);
console.log('');

// -----------------------------------------------------------------------------
// Test 3: 5000 attribute patches
// -----------------------------------------------------------------------------
console.log('Test 3: 5000 attribute patches');
console.log('-'.repeat(40));

const linker3 = SiliconSynapse.create({ nodeCapacity: 100, safeZoneTicks: 0 });
const ptr = linker3.insertHead(OPCODE.NOTE, 60, 100, 480, 10000, 1, FLAG.ACTIVE);

const start3 = performance.now();

for (let i = 0; i < 5000; i++) {
    linker3.patchPitch(ptr, 60 + (i % 12));
}

const elapsed3 = performance.now() - start3;
const perOp3 = (elapsed3 / 5000 * 1000).toFixed(1);

console.log(`  Total time:    ${elapsed3.toFixed(2)} ms`);
console.log(`  Per-op:        ${perOp3} µs`);
console.log(`  Target:        < 15 ms`);
console.log(`  Result:        ${elapsed3 < 15 ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET}`);
console.log('');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`  ID Table Overhead: ${(elapsed1 / elapsed2).toFixed(1)}x`);
console.log(`  Insert target:     ${elapsed1 < 500 ? GREEN + 'PASS' : RED + 'FAIL'} (${elapsed1.toFixed(0)}ms < 500ms)${RESET}`);
console.log(`  Patch target:      ${elapsed3 < 15 ? GREEN + 'PASS' : RED + 'FAIL'} (${elapsed3.toFixed(1)}ms < 15ms)${RESET}`);
console.log('');

// Exit with error code if tests failed
if (elapsed1 >= 500 || elapsed3 >= 15 || nodeCount1 !== 5000) {
    console.log(RED + 'Some tests FAILED!' + RESET);
    process.exit(1);
} else {
    console.log(GREEN + 'All tests PASSED!' + RESET);
    process.exit(0);
}
