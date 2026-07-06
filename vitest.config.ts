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
          alias: { '@': resolve(__dirname, 'src') }
        }
      },
      {
        // configFile: false — la build de prod (vite.config.mts, root src/frontend)
        // ne charge jamais svelte.config.js ; svelte-preprocess y éliderait les
        // imports utilisés uniquement dans le template. Svelte 5 gère le TS nativement.
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
          // Résout Svelte côté client (sinon le compilateur/runtime serveur est
          // chargé sous Node et le rendu de composants échoue).
          conditions: ['browser']
        }
      }
    ]
  }
});
