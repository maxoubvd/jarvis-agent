import { rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// @vscode/vsce ships the entirety of any node_modules package it decides to include
// (based on package.json "dependencies"), ignoring .vscodeignore patterns nested inside
// that package. These subpaths are unreachable at runtime -- safe to delete before packaging.
const unusedPaths = [
  // Browser/webpack bundle + its own vendored ort-wasm*.wasm, unreachable from
  // @xenova/transformers's Node.js entry point (src/transformers.js).
  'node_modules/@xenova/transformers/dist',
  // Locally cached model artifact (re-downloaded on demand).
  'node_modules/@xenova/transformers/.cache',
  // TypeScript sources (dist/ has the compiled output actually loaded) and docs.
  'node_modules/onnxruntime-web/lib',
  'node_modules/onnxruntime-web/docs'
];

for (const path of unusedPaths) {
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
}

// onnxruntime-web/dist ships browser bundles for every execution backend (webgl, webgpu,
// jsep, jspi, all.*...) -- our code only ever resolves the bare `onnxruntime-web` specifier,
// which its package.json "exports" map resolves (under Node) to ort.node.min.{js,mjs}, which
// in turn only loads ort-wasm-simd-threaded.{mjs,wasm}. Keep just those four files.
const keepFiles = new Set([
  'ort.node.min.js',
  'ort.node.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm'
]);
const onnxWebDist = 'node_modules/onnxruntime-web/dist';
for (const file of readdirSync(onnxWebDist)) {
  if (!keepFiles.has(file)) {
    rmSync(join(onnxWebDist, file), { force: true });
  }
}
console.log(`Pruned ${onnxWebDist} to: ${[...keepFiles].join(', ')}`);
