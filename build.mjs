import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/symphonyscript.js',
    format: 'esm',
    sourcemap: true,
    target: ['es2020'],
    platform: 'browser',
});

console.log('⚡ Bundle build complete: dist/symphonyscript.js');
