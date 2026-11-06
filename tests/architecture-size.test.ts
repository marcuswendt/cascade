/**
 * File-size ratchet: no new code file over 750 lines. The files already over
 * it on 2026-11-06 are listed; split one and delete its line here. Never add
 * a file to the list — split the new one instead.
 */
import { describe, expect, it } from 'vitest';
import { filesOver } from '../scripts/architecture.mjs';

const LIMIT = 750;

/** Over the limit on main on 2026-11-06 (19 files). */
const KNOWN_LARGE_FILES = [
  'src/editor/Canvas.svelte',
  'packages/runtime/src/runtime.ts',
  'src/editor/Inspector.svelte',
  'src/nodes/Node.ts',
  'src/nodes/Graph.ts',
  'src/App.svelte',
  'src/editor/Viewer.svelte',
  'src/player/editor.ts',
  'src/editor/NodeUI.svelte',
  'src/editor/dockview/dockview-store.svelte.ts',
  'src/editor/NodePanel.svelte',
  'src/editor/panels/AgentPanel.svelte',
  'src/editor/components/ColorPicker.svelte',
  'src/editor/CodeEditor.svelte',
  'packages/runtime/test/runtime.test.mjs',
  'src/cli/projectRuntime.ts',
  'packages/runtime/src/edit/graphEditor.ts',
  'packages/runtime/src/builtins/pop/definitions.ts',
  'packages/contracts/src/geometry.ts',
];

describe('architecture: file size', () => {
  const large = filesOver(LIMIT);

  it(`adds no file over ${LIMIT} lines`, () => {
    const fresh = large.filter(([file]) => !KNOWN_LARGE_FILES.includes(file)).map(([file, lines]) => `${file} (${lines})`);
    expect(fresh, `over ${LIMIT} lines: split it along its seams`).toEqual([]);
  });

  it('lists only files still over the limit', () => {
    const over = new Set(large.map(([file]) => file));
    const gone = KNOWN_LARGE_FILES.filter((file) => !over.has(file));
    expect(gone, 'now under the limit (or moved): delete these from KNOWN_LARGE_FILES').toEqual([]);
  });
});
