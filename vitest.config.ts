import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Component and workflow tests: the ones that compile Svelte components. */
const STUDIO = ['tests/components/**/*.test.ts', 'tests/workflows/**/*.test.ts'];

/**
 * End-to-end tests: real CLI renders in worker processes, ffmpeg. They import
 * the CLI, so `vitest related` would pull them in for any runtime edit (a
 * runtime.ts related run was ~10 s, 7.75 s of it tests/cli-render.test.ts's
 * renders, 2026-11-16). The `e2e` project is left out of `vitest related`
 * unless a named file is under src/cli/ or tests/e2e/; `vitest run` (and
 * full `verify`) always runs it, so the count is unchanged. Run them alone:
 * `npx vitest run --project e2e`.
 */
const E2E = ['tests/e2e/**/*.e2e.test.ts'];
const argv = process.argv.slice(2);
const related = argv.includes('related');
const withE2e = !related || argv.some((arg) => /(^|\/)(src\/cli|tests\/e2e)\//.test(arg));

/**
 * Two projects, so a runtime or CLI edit does not pay for Studio's test setup:
 * `node` (everything else) runs without the Svelte plugin, `studio` with it
 * (and `e2e`, above, keeps the slow renders out of `vitest related`).
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
          exclude: ['**/node_modules/**', ...STUDIO, ...E2E, ...(process.env.CASCADE_SKIP_PERF ? ['tests/performance/**'] : [])],
        },
      },
      ...(withE2e ? [{
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: E2E,
        },
      }] : []),
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
