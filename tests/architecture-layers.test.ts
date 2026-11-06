/**
 * The layering ARCHITECTURE.md states, as a failing test: contracts import
 * nothing, the runtime imports only contracts, and the engine, nodes, CLI and
 * player never import the Studio editor. Import cycles may not grow past the
 * five groups that existed when the guard landed (2026-11-06).
 *
 * The lists below are ratchets: shrink them when an offender goes, never add
 * to them. A new edge or cycle is fixed in the code, not here.
 */
import { describe, expect, it } from 'vitest';
import { importCycles, importGraph, layerViolations } from '../scripts/architecture.mjs';

/** Offenders on main on 2026-11-06: type-only imports of the TypeScript API
 *  for the definition extractor (erased at build, so the runtime does not
 *  load TypeScript at run time). */
const KNOWN_LAYER_VIOLATIONS = [
  'packages/runtime/src/definition/architecture.ts -> type typescript',
  'packages/runtime/src/definition/extract.ts -> type typescript',
];

/** Import cycles on main on 2026-11-06, largest first. A cycle may shrink or
 *  go; it may not gain a file, and no new one may appear. */
const KNOWN_CYCLES = [
  // The compatibility engine core: Graph and Node import each other.
  [
    'src/engine/GraphValidator.ts', 'src/engine/ModuleResolver.ts', 'src/engine/expressions/ExpressionEngine.ts',
    'src/engine/expressions/index.ts', 'src/nodes/CookScheduler.ts', 'src/nodes/Graph.ts', 'src/nodes/Node.ts',
    'src/nodes/annotations/Annotation.ts', 'src/nodes/annotations/Group.ts', 'src/nodes/annotations/Image.ts',
    'src/nodes/annotations/Line.ts', 'src/nodes/annotations/Polyline.ts', 'src/nodes/annotations/Text.ts',
    'src/nodes/definition/DefinitionNode.ts', 'src/nodes/definition/projectDefinition.ts', 'src/utils/nodeTypeUtils.ts',
  ],
  ['packages/contracts/src/camera.ts', 'packages/contracts/src/color.ts', 'packages/contracts/src/scene.ts', 'packages/contracts/src/values.ts'],
  ['src/editor/components/BundleValue.svelte', 'src/editor/components/CoreValue.svelte', 'src/editor/components/registerRenderers.ts'],
  ['server/src/serve/command.ts', 'server/src/cliCommands.ts'],
  ['server/src/project.ts', 'server/src/shell/service.ts'],
];

const graph = importGraph();
const cycles: string[][] = importCycles(graph);

describe('architecture: layers', () => {
  it('reads the source tree', () => {
    expect(graph.size).toBeGreaterThan(300);
  });

  it('keeps contracts, runtime, engine and Studio in their layers', () => {
    const found = layerViolations(graph).map(({ rule, from, to }) => ({ edge: `${from} -> ${to}`, rule }));
    const fresh = found.filter(({ edge }) => !KNOWN_LAYER_VIOLATIONS.includes(edge));
    expect(fresh, 'new import across a layer boundary; move the shared code down a layer instead').toEqual([]);
  });

  it('lists only offenders that still exist', () => {
    const found = new Set(layerViolations(graph).map(({ from, to }) => `${from} -> ${to}`));
    const gone = KNOWN_LAYER_VIOLATIONS.filter((edge) => !found.has(edge));
    expect(gone, 'fixed: delete these from KNOWN_LAYER_VIOLATIONS').toEqual([]);
  });

  it('adds no import cycle and grows none', () => {
    const outside = cycles.filter((group) => !KNOWN_CYCLES.some((known) => group.every((file) => known.includes(file))));
    expect(outside, 'new or grown import cycle').toEqual([]);
    expect(cycles.length).toBeLessThanOrEqual(KNOWN_CYCLES.length);
  });

  it('lists only cycles that still exist', () => {
    const gone = KNOWN_CYCLES.filter((known) => !cycles.some((group) => group.some((file) => known.includes(file))));
    expect(gone, 'broken: delete these from KNOWN_CYCLES').toEqual([]);
  });
});
