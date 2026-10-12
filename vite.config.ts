import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    exclude: ['svelte']
  },
  build: {
    // scripts/build.mjs points this at a staging directory and swaps it in on success.
    outDir: process.env.CASCADE_DIST_DIR ?? 'dist',
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 1000
  }
});
