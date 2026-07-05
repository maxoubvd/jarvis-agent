import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
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
    }
  },
  plugins: [svelte({ hot: !process.env.VITEST })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});