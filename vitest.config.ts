import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  test: {
    globals: true,
    environment: 'node',
    // Use jsdom for component and workflow tests
    environmentMatchGlobs: [
      ['tests/components/**', 'jsdom'],
      ['tests/workflows/**', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/nodes/**/*.ts', 'src/engine/**/*.ts', 'src/editor/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts']
    }
  },
  resolve: {
    // Component tests need Svelte's browser entry even though most of the suite
    // intentionally runs in the lightweight Node environment.
    conditions: ['browser'],
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
