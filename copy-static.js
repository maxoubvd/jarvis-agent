import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const filesToCopy = ['README.md', 'LICENSE', 'CHANGELOG.md'];

const root = process.cwd();
const outDir = join(root, 'dist');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

for (const file of filesToCopy) {
  const src = join(root, file);
  if (existsSync(src)) {
    cpSync(src, join(outDir, file));
    console.log(`Copied ${file} → dist/`);
  }
}

console.log('Static files copy complete.');
