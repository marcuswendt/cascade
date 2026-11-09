import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { validateNodeModuleArchitecture } from '../packages/runtime/src/definition/architecture';

/**
 * `architecture/module-state` names the fix when a `definition` has superseded
 * a module-level `icon` or `runsOn`, and keeps the general advice otherwise.
 *
 * Tested against the validator directly rather than through `cascade check`,
 * and that is the point rather than a shortcut. The CLI only reaches this rule
 * after a definition has been extracted, so the no-definition branch is
 * unreachable from there — an earlier version of this test went through
 * `checkProjectGraph` and was answered by "Static check requires definition-v1
 * modules" without the rule ever running. The function is exported from the
 * runtime package, so it has to behave on any source it is handed, and this is
 * the level at which both branches exist.
 */
describe('the module-state message', () => {
  const definition = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  outputs: { result: { kind: 'data', type: 'float' } }
} as const;
export function execute(context) { context.outputs.result.set(1); }
`;

  it('tells a stub that icon and runsOn belong inside the definition', () => {
    const diagnostics = validateNodeModuleArchitecture(
      `export const icon = 'Crop';\nexport const runsOn = 'portable';${definition}`,
      'index.ts',
      ts,
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].message).toContain('`icon` belongs inside the definition');
    expect(diagnostics[1].message).toContain('`runsOn` belongs inside the definition');
    // Still the same code, because it is the same rule — only the sentence
    // changes, so nothing keying on the code has to know about this.
    expect(diagnostics.every(item => item.code === 'architecture/module-state')).toBe(true);
  });

  it('keeps the general advice where there is no definition to move them into', () => {
    // A dynamic module declares `icon` at module level because that is the
    // only way to state it. Telling somebody to move it into an object that
    // does not exist would be worse than saying nothing specific. A string
    // constant is a pure helper and passes; mutable state gets the advice.
    expect(validateNodeModuleArchitecture(
      `export const icon = 'Crop';\nexport function execute(context) {}\n`,
      'index.ts',
      ts,
    )).toEqual([]);
    const diagnostics = validateNodeModuleArchitecture(
      `export let icon = 'Crop';\nexport function execute(context) {}\n`,
      'index.ts',
      ts,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('may not declare module-level values');
    expect(diagnostics[0].message).not.toContain('belongs inside the definition');
  });

  it('allows pure module-level helpers: functions and immutable constants', () => {
    const diagnostics = validateNodeModuleArchitecture(
      `import { mix } from './lib/colour';
const TAU = Math.PI * 2;
const STEPS = 64, HALF = STEPS / 2;
const LABEL = \`ring \${STEPS}\`;
const PALETTE = ['#f2e8cf', '#6a994e'] as const;
const LAYERS = Object.freeze({ near: 0.2, far: 0.8 });
const NESTED = { sizes: [1, 2, 3], name: 'x' } as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function wave(t: number) { return Math.sin(t * TAU); }
const tint = mix;
${definition}`,
      'index.ts',
      ts,
    );
    expect(diagnostics).toEqual([]);
  });

  it('still refuses module-level values that can hold state between cooks', () => {
    for (const source of [
      'let count = 0;',
      'var seen = 1;',
      'const cache = new Map();',
      'const points = [];',
      'const options = { size: 2 };',
      'const pattern = /x/g;',
      'const seed = Math.random();',
      'const shallow = Object.freeze({ list: [1, 2] });',
      'const spread = [...other] as const;',
    ]) {
      const diagnostics = validateNodeModuleArchitecture(`${source}${definition}`, 'index.ts', ts);
      expect(diagnostics.map((item) => item.code), source).toContain('architecture/module-state');
    }
  });

  it('still refuses ordinary module state beside a definition', () => {
    const diagnostics = validateNodeModuleArchitecture(
      `const cache = new Map();${definition}`,
      'index.ts',
      ts,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('may not declare module-level values');
  });
});
