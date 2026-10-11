import { defineConfig } from 'tsup';

// Bundle the server and ALL of its dependencies (including the workspace package
// @neon/shared) into one self-contained file. The runtime Docker image then only
// needs Node.js and this single file, with no node_modules.
export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  minify: false,
  noExternal: [/.*/],
  // Optional native accelerators for `ws`; it falls back to pure JS when absent.
  external: ['bufferutil', 'utf-8-validate'],
});
