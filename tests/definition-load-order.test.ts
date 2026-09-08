/**
 * A project definition-v1 node is restored BEFORE its definition exists, and
 * nothing the definition does when it arrives may overwrite what was restored.
 *
 * The general hazard, found while diagnosing the `vec3` corruption on
 * 2026-09-08 (see `tests/vector-prop-load.test.ts`): a **project** module's
 * definition is fetched and compiled asynchronously, so at the moment
 * `Graph.fromJSON` runs, `node.parameters` is empty, `node.inputs` is empty and
 * every branch that keys off the definition takes its else. The colour coercion
 * was one casualty of that window. This file pins the rest of the window shut,
 * because each of these would fail exactly as silently: a value the author set
 * reverting to a module default, with no error anywhere.
 *
 * Two directions, and both matter. The definition arriving must not clobber the
 * restore, and a save taken *inside* the window — before the definition lands —
 * must still write everything the document came in with.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { setProjectModuleCompiler } from '@/engine/nodeModuleLoader';
import { expressionEngine } from '@/engine/expressions/index';

/** `result = offset + camera[0] * scale`, so one cook reports all three stores
 *  — the input, the vector prop and the scalar prop — and the assertions do not
 *  have to reach into the node's internals to read them. */
const rigModule = `
export const definition = {
  apiVersion: 1,
  label: 'Rig',
  runsOn: 'portable',
  inputs: {
    offset: { kind: 'data', type: 'float', default: 1 },
  },
  outputs: {
    result: { kind: 'data', type: 'float' },
  },
  props: {
    camera: { type: 'vec3', default: [0, 0, 0] },
    scale: { type: 'float', default: 2 },
  },
};

export function execute(context) {
  context.outputs.result.set(context.inputs.offset + context.props.camera[0] * context.props.scale);
}
`;

function document(node: Record<string, unknown>) {
  return {
    version: '0.2',
    nodes: [{
      id: 'rig',
      module: 'project.Rig',
      source: 'project',
      position: [0, 0],
      ...node,
    }],
    connections: [],
  };
}

async function cook(graph: Graph): Promise<number> {
  const node = graph.getNode('rig')!;
  node.markDirty();
  await graph.execute(node);
  return node.outputs.find(port => port.name === 'result')!.value as number;
}

describe('a project definition attaching to an already-restored node', () => {
  beforeEach(() => {
    setProjectModuleCompiler(async () => rigModule);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });
  afterEach(() => setProjectModuleCompiler(null));

  /**
   * `Node.in()` refreshes an existing port's `defaultValue` from the incoming
   * declaration. It must not carry the port's live value along with it: the
   * port was created by the restore and its value is the author's.
   */
  it('keeps a restored input value rather than the declared default', async () => {
    const graph = Graph.fromJSON(document({
      inputs: [{ name: 'offset', defaultValue: 9, dataType: 'float' }],
      props: { camera: [3, 0, 0], scale: 5 },
    }));

    // 9 + 3 * 5. The declared default of 1 would give 16.
    expect(await cook(graph)).toBe(24);
    expect(graph.getNode('rig')!.inputs.find(p => p.name === 'offset')!.value).toBe(9);
  });

  /** The boundary the animation tests found the hard way: a stored value equal
   *  to the module default is the case every proof picks a distant number to
   *  avoid, and the only one where a wrong `===` reads as correct. */
  it('keeps a restored input value that equals the declared default', async () => {
    const graph = Graph.fromJSON(document({
      inputs: [{ name: 'offset', defaultValue: 1, dataType: 'float' }],
      props: { camera: [3, 0, 0], scale: 5 },
    }));

    expect(await cook(graph)).toBe(16);
  });

  /** `bindParameterProp` seeds a prop only when none exists. A restored prop
   *  exists, so the declaration may refresh its metadata and nothing else. */
  it('keeps restored props rather than the declared defaults', async () => {
    const graph = Graph.fromJSON(document({ props: { camera: [3, 0, 0], scale: 5 } }));
    await cook(graph);

    const node = graph.getNode('rig')!;
    expect(node.props.camera.value).toEqual([3, 0, 0]);
    expect(node.props.scale.value).toBe(5);
    // The metadata IS the definition's — that half is what the declaration is
    // for. `type` on a prop is the Inspector CONTROL, not the contract type:
    // `paramControlType` maps float to a number field.
    expect(node.props.scale.type).toBe('number');
  });
});

describe('a save taken before the project definition has arrived', () => {
  beforeEach(() => {
    setProjectModuleCompiler(async () => rigModule);
    expressionEngine.setFrame(1);
  });
  afterEach(() => setProjectModuleCompiler(null));

  /**
   * The window is real in Studio: a document opens, the module fetch is in
   * flight, and anything that saves in between must not write a lossy file.
   *
   * `Graph.toJSON` writes definition-v1 props from `node.parameters`, which is
   * still empty here — so what makes this pass is that the props reduce writes
   * them from `node.props` instead, and does so precisely because
   * `prop.fromParameter` has not been set yet either. The two branches cover
   * each other, which is worth pinning rather than trusting.
   */
  it('writes the restored props and inputs, losing nothing', () => {
    const graph = Graph.fromJSON(document({
      inputs: [{ name: 'offset', defaultValue: 9, dataType: 'float' }],
      props: { camera: [3, 0, 0], scale: 5 },
    }));

    const saved: any = graph.toJSON().nodes.find((node: any) => node.id === 'rig');
    // An unbound prop serialises as the bare value; `{ value, expression? }` is
    // the shape only once there is a binding to carry.
    expect(saved.props.camera).toEqual([3, 0, 0]);
    expect(saved.props.scale).toBe(5);
    expect(saved.inputs.find((port: any) => port.name === 'offset').defaultValue).toBe(9);
  });

  /** And the reload of that save still cooks to the authored numbers — the
   *  round trip is the test, since a lossy write only shows on the way back. */
  it('reloads to the same graph once the definition does arrive', async () => {
    const first = Graph.fromJSON(document({
      inputs: [{ name: 'offset', defaultValue: 9, dataType: 'float' }],
      props: { camera: [3, 0, 0], scale: 5 },
    }));

    const reloaded = Graph.fromJSON(first.toJSON());
    expect(await cook(reloaded)).toBe(24);
  });
});
