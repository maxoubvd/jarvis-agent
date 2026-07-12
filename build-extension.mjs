import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/extension.js',
  sourcemap: true,
  logLevel: 'info',
  // Bundled CJS deps (e.g. `cross-spawn`, pulled in via @modelcontextprotocol/sdk's
  // stdio transport) call require() for Node builtins. `require` doesn't exist as a
  // global in Node ESM, so esbuild's own require-shim would throw at runtime without
  // a real binding to fall back on. Alias the import so it can't collide with any
  // `import { createRequire } from 'module'` already present in the bundled source
  // (e.g. rag.ts, which needs its own createRequire to locate onnxruntime-web).
  banner: {
    js: "import { createRequire as __jarvisCreateRequire } from 'module'; const require = __jarvisCreateRequire(import.meta.url);"
  },
  external: [
    'vscode',
    '@xenova/transformers',
    'web-tree-sitter'
  ]
});
