import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  root: 'src/frontend',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'src/frontend', 'main.ts')
      }
    }
  },
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
