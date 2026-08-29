import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function config(relativePath: string): { compilerOptions?: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

describe('TypeScript configurations', () => {
  it('uses bundler resolution without the deprecated baseUrl option for browser and package builds', () => {
    for (const [relativePath, module] of [
      ['tsconfig.json', 'ESNext'],
      ['packages/contracts/tsconfig.json', 'ES2022'],
      ['packages/runtime/tsconfig.json', 'ES2022'],
    ] as const) {
      const options = config(relativePath).compilerOptions ?? {};
      expect(options.module, relativePath).toBe(module);
      expect(options.moduleResolution, relativePath).toBe('bundler');
      expect(options.baseUrl, relativePath).toBeUndefined();
    }

    expect(config('tsconfig.json').compilerOptions?.paths).toEqual({ '@/*': ['./src/*'] });
  });

  it('uses NodeNext module semantics for the Node server build', () => {
    expect(config('server/tsconfig.json').compilerOptions).toMatchObject({
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    });
  });
});
