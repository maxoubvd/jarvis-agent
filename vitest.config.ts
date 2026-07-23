import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/types/**',
        '**/test/**',
        '**/*.test.ts'
      ]
    },
    projects: [
      {
        test: {
          name: 'backend',
          globals: true,
          environment: 'node',
          include: ['test/*.test.ts', 'test/backend/**/*.test.ts'],
          exclude: ['node_modules', 'dist']
        },
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src'),
            '@jarvis/core/vscode': resolve(__dirname, 'packages/core/src/vscode.ts'),
            '@jarvis/core': resolve(__dirname, 'packages/core/src/index.ts')
          }
        }
      },
      {
        test: {
          name: 'cli',
          globals: true,
          environment: 'node',
          include: ['packages/cli/test/**/*.test.ts'],
          exclude: ['node_modules', 'dist']
        },
        resolve: {
          alias: {
            '@jarvis/core/vscode': resolve(__dirname, 'packages/core/src/vscode.ts'),
            '@jarvis/core': resolve(__dirname, 'packages/core/src/index.ts')
          }
        }
      },
      {
        // configFile: false — the prod build (vite.config.mts, root src/frontend)
        // never loads svelte.config.js; svelte-preprocess would elide the
        // imports used only in the template. Svelte 5 handles TS natively.
        plugins: [
          svelte({ configFile: false, hot: false, compilerOptions: { runes: true } }),
          svelteTesting()
        ],
        test: {
          name: 'frontend',
          globals: true,
          environment: 'happy-dom',
          include: ['test/frontend/**/*.test.ts'],
          exclude: ['node_modules', 'dist']
        },
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
          // Resolves Svelte on the client side (otherwise the server compiler/runtime
          // is loaded under Node and component rendering fails).
          conditions: ['browser']
        }
      }
    ]
  }
});
