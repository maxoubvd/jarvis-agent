import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { chmodSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Single source of truth for the version: package.json, injected at build time so
// `jarvis --version` can never drift from what is actually published.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

await build({
  entryPoints: [resolve(__dirname, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(__dirname, 'dist/cli.js'),
  sourcemap: true,
  logLevel: 'info',
  // Executable shebang so `jarvis` runs directly once installed globally.
  banner: {
    js: [
      '#!/usr/bin/env node',
      // Bundled CJS deps (transitively, e.g. via the MCP stdio transport / onnxruntime)
      // call require(); provide a real binding in this ESM bundle.
      "import { createRequire as __jarvisCreateRequire } from 'module'; const require = __jarvisCreateRequire(import.meta.url);"
    ].join('\n')
  },
  define: {
    __JARVIS_CLI_VERSION__: JSON.stringify(pkg.version)
  },
  // Resolve the shared engine straight from its TypeScript sources.
  alias: {
    '@jarvis/core': resolve(__dirname, '../core/src/index.ts')
  },
  // Heavy native/wasm deps stay external (same as the extension bundle). Note we do
  // NOT mark `vscode` as external: if anything in the graph imported it, this build
  // would fail — that is our guarantee the CLI's core graph is vscode-free.
  external: ['@xenova/transformers', 'web-tree-sitter']
});

// Make the output directly executable (POSIX). No-op semantics on Windows.
try {
  chmodSync(resolve(__dirname, 'dist/cli.js'), 0o755);
} catch {
  /* best-effort */
}
