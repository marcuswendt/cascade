import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Component and workflow tests: the ones that compile Svelte components. */
const STUDIO = ['tests/components/**/*.test.ts', 'tests/workflows/**/*.test.ts'];

/**
 * Two projects, so a runtime or CLI edit does not pay for Studio's test setup:
 * `node` (everything else) runs without the Svelte plugin, `studio` with it.
 * `vitest run --project node` is the runtime loop (1,767 tests in ~10 s
 * against ~18 s for all, 2026-11-07); plain `vitest run` (and `verify`) runs
 * both, so the count is unchanged. The environment is node in both and a file
 * that needs the DOM opts in with a `@vitest-environment jsdom` docblock —
 * which is what already happened: Vitest 4 dropped the
 * `environmentMatchGlobs` this config used to carry, so those globs did
 * nothing.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/nodes/**/*.ts', 'src/engine/**/*.ts', 'src/editor/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts']
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          // CASCADE_SKIP_PERF=1 (set by `verify --push`) drops the timing
          // assertions, which fail on a loaded machine. The CLI's --exclude
          // does not reach a project's own exclude list, hence the variable.
          exclude: ['**/node_modules/**', ...STUDIO, ...(process.env.CASCADE_SKIP_PERF ? ['tests/performance/**'] : [])],
        },
      },
      {
        extends: true,
        plugins: [svelte()],
        test: {
          name: 'studio',
          environment: 'node',
          include: STUDIO,
        },
      },
    ],
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
