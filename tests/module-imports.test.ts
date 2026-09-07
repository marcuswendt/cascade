import { describe, expect, it } from 'vitest';
import { moduleDirectory, rewriteRelativeImports } from '../src/editor/moduleImports.js';

describe('relative imports across an embed or extract', () => {
  const nodeDir = moduleDirectory('distort');

  it('rewrites a project module for the graph root when embedding', () => {
    // The real case: the agent console wrote nodes/distort/index.ts importing
    // ../../lib/warp, and Embed in Graph compiled it with the project root as
    // the resolve directory, where that specifier points outside the project.
    const code = `import { warp } from '../../lib/warp';\nimport { x } from './helper';`;
    expect(rewriteRelativeImports(code, nodeDir, '')).toBe(
      `import { warp } from './lib/warp';\nimport { x } from './nodes/distort/helper';`,
    );
  });

  it('rewrites the other way when extracting to a file', () => {
    const code = `import { warp } from './lib/warp';`;
    expect(rewriteRelativeImports(code, '', nodeDir)).toBe(
      `import { warp } from '../../lib/warp';`,
    );
  });

  it('leaves bare package specifiers alone', () => {
    const code = `import { saveImage } from 'cascade/io';\nimport x from "some-package";`;
    expect(rewriteRelativeImports(code, nodeDir, '')).toBe(code);
  });

  it('handles dynamic import and require', () => {
    expect(rewriteRelativeImports(`await import('../../lib/warp')`, nodeDir, '')).toBe(
      `await import('./lib/warp')`,
    );
    expect(rewriteRelativeImports(`require("../../lib/warp")`, nodeDir, '')).toBe(
      `require("./lib/warp")`,
    );
  });

  it('keeps an import that genuinely escapes the project broken and visible', () => {
    // Rewriting this into something that resolves would point at the wrong
    // file. Better to leave it pointing outside and let the compile say so.
    expect(rewriteRelativeImports(`from '../../../outside'`, nodeDir, '')).toBe(`from '../outside'`);
  });

  it('is a no-op when the directory has not changed', () => {
    const code = `import { x } from '../../lib/warp';`;
    expect(rewriteRelativeImports(code, nodeDir, nodeDir)).toBe(code);
  });

  it('round-trips embed then extract', () => {
    const original = `import { warp } from '../../lib/warp';`;
    const embedded = rewriteRelativeImports(original, nodeDir, '');
    expect(rewriteRelativeImports(embedded, '', nodeDir)).toBe(original);
  });
});
