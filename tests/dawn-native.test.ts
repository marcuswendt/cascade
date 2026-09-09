import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

// Opt-in so ordinary tests work with --omit=optional and on CPU-only CI.
// The dedicated hardware gate MUST fail, not skip, if Dawn cannot initialize.
describe.skipIf(process.env.CASCADE_TEST_DAWN !== '1')('native Dawn hardware gate', () => {
  it('renders padded rows repeatedly and exits naturally after cleanup', async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--import', 'tsx', 'tests/fixtures/dawn-render.ts'], { timeout: 30_000 });
    expect(stdout.trim().split('\n').map((line) => JSON.parse(line).cycle)).toEqual([0, 1, 2]);
    expect(stderr).not.toMatch(/validation error|uncaptured/i);
  }, 35_000);
});
