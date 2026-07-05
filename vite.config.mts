import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  root: 'src/frontend',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'webview'),
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'src/frontend', 'main.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
  plugins: [
    svelte({
      compilerOptions: {
        runes: true
      },
      hot: process.env.NODE_ENV === 'development'
    })
  ],
  css: {
    modules: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  esbuild: {
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
