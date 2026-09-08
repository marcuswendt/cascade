/**
 * A definition-v1 prop must be able to hold an expression and a keyframe
 * channel, in BOTH hosts, and resolve them in one order.
 *
 * Written to fail first. Measured 2026-09-08 against 0e1ca49: converting an
 * animated node to definition-v1 silently turned its animation into a static
 * number, because
 *
 *   - `Graph.fromJSON` restored a prop's expression and channel only when the
 *     prop was NOT a definition prop (`if (expression && !definitionProp)`),
 *   - `Graph.toJSON` wrote every changed definition prop back as
 *     `props[name] = parameter.value` — the RESOLVED number — after the props
 *     reduce had written the binding, so a save replaced the expression with
 *     whatever frame the save happened on,
 *   - `packages/runtime/src/runtime.ts` read `saved.value` and nothing else,
 *     and had no clock to resolve either binding against.
 *
 * The defect is a reader defect, not a format one: the document shape has held
 * `{ value, expression?, channel? }` since `contracts/animation.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { setProjectModuleCompiler } from '@/engine/nodeModuleLoader';
import { registerDefinitionNodes } from '@/nodes/definition/DefinitionNode';
import { deleteKeyAtPlayhead, keyState, setKeyAtPlayhead } from '@/editor/keyframeGesture';
import { expressionEngine } from '@/engine/expressions/index';
import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import type { DefinitionNodeRegistration as RuntimeRegistration } from '../packages/runtime/src/types.js';

/**
 * A definition-v1 project module with one prop. `result = value * factor`, so
 * the output reports the resolved prop rather than the test having to reach
 * into the node's internals to read it.
 */
const doublerModule = `
export const definition = {
  apiVersion: 1,
  label: 'Doubler',
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 3 },
  },
  outputs: {
    result: { kind: 'data', type: 'float' },
  },
  props: {
    factor: { type: 'float', default: 2, min: 0, max: 100 },
  },
};

export function execute(context) {
  context.outputs.result.set(context.inputs.value * context.props.factor);
}
`;

const selfAnimatingDoublerModule = doublerModule.replace(
  "factor: { type: 'float', default: 2, min: 0, max: 100 },",
  "factor: { type: 'float', default: 2, min: 0, max: 100, expression: '$F' },",
);

function document(props: Record<string, unknown>) {
  return {
    version: '0.2',
    nodes: [{
      id: 'subject',
      module: 'project.Doubler',
      source: 'project',
      position: [0, 0],
      props,
    }],
    connections: [],
  };
}

async function cookAt(graph: Graph, frame: number): Promise<number> {
  expressionEngine.setFrame(frame);
  const node = graph.getNode('subject')!;
  node.markDirty();
  await graph.execute(node);
  return node.outputs.find(port => port.name === 'result')!.value as number;
}

describe('an expression on a definition-v1 prop', () => {
  beforeEach(() => {
    setProjectModuleCompiler(async () => doublerModule);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });
  afterEach(() => setProjectModuleCompiler(null));

  it('survives the load and animates in Studio when the frame moves', async () => {
    const graph = Graph.fromJSON(document({ factor: { value: 2, expression: '$F * 0.5' } }));

    // $F * 0.5 at frame 4 is 2, times the input default of 3.
    expect(await cookAt(graph, 4)).toBe(6);
    // And at frame 10 it is 5 — a static number would still read 6.
    expect(await cookAt(graph, 10)).toBe(15);

    const node = graph.getNode('subject')!;
    expect(node.parm('factor')!.expression()).toBe('$F * 0.5');
  });

  it('is written back as an expression, not as the number it happened to be', async () => {
    const graph = Graph.fromJSON(document({ factor: { value: 2, expression: '$F * 0.5' } }));
    await cookAt(graph, 10);

    const saved: any = graph.toJSON().nodes.find((node: any) => node.id === 'subject');
    expect(saved.props.factor).toEqual({ value: 2, expression: '$F * 0.5' });
    // The resolved value at the frame the save happened on must not be what
    // reaches disk: `5` here would freeze the animation.
    expect(saved.props.factor).not.toBe(5);
  });

  it('round-trips through save and reload and still animates', async () => {
    const first = Graph.fromJSON(document({ factor: { value: 2, expression: '$F * 0.5' } }));
    await cookAt(first, 10);

    const reloaded = Graph.fromJSON(first.toJSON());
    expect(await cookAt(reloaded, 4)).toBe(6);
    expect(await cookAt(reloaded, 10)).toBe(15);
  });
});

describe('a stored project prop overrides a lazily loaded default expression', () => {
  beforeEach(() => {
    setProjectModuleCompiler(async () => selfAnimatingDoublerModule);
    expressionEngine.setFrame(10);
  });
  afterEach(() => setProjectModuleCompiler(null));

  it('keeps the stored value after the project definition attaches', async () => {
    const graph = Graph.fromJSON(document({ factor: 7 }));

    expect(await cookAt(graph, 10)).toBe(21);
    expect(graph.getNode('subject')!.parm('factor')!.expression()).toBeNull();
  });

  /**
   * The boundary, and the defect that shipped in 0.3.0.
   *
   * A stored value that happens to *equal* the default was dropped on save —
   * `Graph.toJSON` filters out any parameter whose raw value matches its
   * default — so nothing was written, and on reload the declared expression
   * applied to a number the author had deliberately chosen. Setting a prop back
   * to its default made it start animating.
   *
   * It is the losing case in the one variant three independent proofs all
   * missed. Each picked a value obviously different from the default — `7`
   * against `2` above, `7` against `0` and `0.4` against `0` elsewhere —
   * because a distant value reads as the stronger test. The boundary was the
   * weaker-looking one and the only one that failed.
   *
   * Diagnosed and fixed by Marcus's Codex session (`preservePlainProp`); this
   * pins it. **The save and reload are the point** — the bug is in what gets
   * written, so a test that only checks the loaded graph passes either way.
   */
  it('keeps a stored value that equals the default, through a save and reload', async () => {
    const graph = Graph.fromJSON(document({ factor: 2 }));

    expect(await cookAt(graph, 10)).toBe(6);
    expect(graph.getNode('subject')!.parm('factor')!.expression()).toBeNull();

    const written = JSON.parse(JSON.stringify(graph.toJSON()));
    const saved = written.nodes.find((node: any) => node.id === 'subject');
    // Written even though it matches the default, because here that is a
    // decision rather than an absence.
    expect(saved.props).toMatchObject({ factor: 2 });

    const reopened = Graph.fromJSON(written);
    expect(await cookAt(reopened, 10)).toBe(6);
    expect(reopened.getNode('subject')!.parm('factor')!.expression()).toBeNull();
    expect(reopened.getNode('subject')!.isTimeDependent).toBe(false);
  });
});

describe('a keyframe channel on a definition-v1 prop', () => {
  const keyed = {
    factor: {
      value: 2,
      channel: {
        keys: [
          { frame: 1, value: 1, interpolation: 'linear' },
          { frame: 11, value: 11 },
        ],
      },
    },
  };

  beforeEach(() => {
    setProjectModuleCompiler(async () => doublerModule);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });
  afterEach(() => setProjectModuleCompiler(null));

  it('survives the load and samples at the current frame', async () => {
    const graph = Graph.fromJSON(document(keyed));

    // Linear from (1,1) to (11,11): frame 6 samples 6, times the input's 3.
    expect(await cookAt(graph, 6)).toBe(18);
    expect(await cookAt(graph, 11)).toBe(33);

    const node = graph.getNode('subject')!;
    expect(node.parm('factor')!.hasChannel()).toBe(true);
    // A keyed parameter loaded from disk must be recooked per frame exactly as
    // one keyed in the session is.
    expect(node.isTimeDependent).toBe(true);
  });

  it('round-trips through save and reload and still samples', async () => {
    const first = Graph.fromJSON(document(keyed));
    await cookAt(first, 6);

    const saved: any = first.toJSON().nodes.find((node: any) => node.id === 'subject');
    expect(saved.props.factor.channel).toEqual({
      keys: [
        { frame: 1, value: 1, interpolation: 'linear' },
        { frame: 11, value: 11 },
      ],
    });

    const reloaded = Graph.fromJSON(first.toJSON());
    expect(await cookAt(reloaded, 6)).toBe(18);
  });

  it('wins over an expression on the same prop, and leaves the expression intact', async () => {
    const graph = Graph.fromJSON(document({
      factor: { value: 2, expression: '99', channel: keyed.factor.channel },
    }));

    // The channel wins; the expression is kept, inert, and comes back when the
    // channel is deleted.
    expect(await cookAt(graph, 6)).toBe(18);
    const node = graph.getNode('subject')!;
    expect(node.parm('factor')!.expression()).toBe('99');

    node.parm('factor')!.clearChannel();
    expect(await cookAt(graph, 6)).toBe(297);
  });
});

/**
 * The headless half. Same document, same order, no Studio.
 *
 * Imported by relative path rather than through `@cascade/runtime`, so these
 * exercise the runtime source in this tree and not a built `dist`.
 */
describe('the deterministic runtime resolves a bound definition-v1 prop', () => {
  const definition = {
    apiVersion: 1,
    runsOn: 'portable',
    inputs: { value: { kind: 'data', type: 'float', default: 3 } },
    outputs: { result: { kind: 'data', type: 'float' } },
    props: { factor: { type: 'float', default: 2 } },
  } as const;

  const registration = {
    kind: 'definition-v1',
    moduleId: 'cascade.test.Animated',
    definition,
    loadExecute: async () => (context: any) => {
      context.outputs.result.set(context.inputs.value * context.props.factor);
    },
  } as unknown as RuntimeRegistration;

  async function load(props: Record<string, unknown>) {
    const runtime = createRuntime({
      host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
      nodes: [registration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{ id: 'subject', module: 'cascade.test.Animated', props }],
      connections: [],
    } as never);
    return {
      graph,
      async at(frame: number): Promise<number> {
        const result = await graph.run({ frame, fps: 25 });
        expect(result.status).toBe('completed');
        return graph.getOutput('subject', 'result') as number;
      },
      async done() {
        await graph.dispose();
        await runtime.dispose();
      },
    };
  }

  it('evaluates an expression at the frame the run states', async () => {
    const subject = await load({ factor: { value: 2, expression: '$F * 0.5' } });
    expect(await subject.at(4)).toBe(6);
    expect(await subject.at(10)).toBe(15);
    // The stored value is untouched, so deleting the expression restores it.
    expect(subject.graph.inspect().nodes[0].props.factor.value).toBe(5);
    await subject.done();
  });

  it('samples a keyframe channel at the frame the run states', async () => {
    const subject = await load({
      factor: {
        value: 2,
        channel: {
          keys: [
            { frame: 1, value: 1, interpolation: 'linear' },
            { frame: 11, value: 11 },
          ],
        },
      },
    });
    expect(await subject.at(1)).toBe(3);
    expect(await subject.at(6)).toBe(18);
    expect(await subject.at(11)).toBe(33);
    await subject.done();
  });

  it('lets the channel win over an expression, exactly as Studio does', async () => {
    const subject = await load({
      factor: {
        value: 2,
        expression: '99',
        channel: { keys: [{ frame: 1, value: 4 }] },
      },
    });
    expect(await subject.at(6)).toBe(12);
    await subject.done();
  });

  it('reads $T in seconds, and $T is zero on the first frame', async () => {
    const subject = await load({ factor: { value: 0, expression: '$T' } });
    expect(await subject.at(1)).toBe(0);
    // (frame - 1) / fps, at 25fps: frame 26 is one second.
    expect(await subject.at(26)).toBe(3);
    await subject.done();
  });

  it('falls back to the stored value and says so when an expression fails', async () => {
    const subject = await load({ factor: { value: 7, expression: 'nope(' } });
    expect(await subject.at(1)).toBe(21);
    const diagnostics = subject.graph.inspect().diagnostics;
    expect(diagnostics.some(item => item.code === 'runtime/expression-failed')).toBe(true);
    await subject.done();
  });

  it('leaves an unbound prop alone', async () => {
    const subject = await load({ factor: 6 });
    expect(await subject.at(50)).toBe(18);
    await subject.done();
  });
});

/**
 * A LIBRARY definition-v1 node, which is the case the `!definitionProp` guards
 * in `Graph.fromJSON` actually bit.
 *
 * The difference is arrival time, not style. A library definition is known
 * synchronously, so `setup()` declares its props in the constructor and
 * `fromJSON` finds a `documentField: 'props'` parameter for the key it is
 * restoring — which is what the guard tested. A project module compiles on
 * demand, so at that moment the node has no parameters at all, the guard
 * missed, and its expression was restored by accident. One document, two
 * outcomes, depending on where the module lived.
 */
describe('an expression on a library definition-v1 node', () => {
  const definition = {
    apiVersion: 1,
    runsOn: 'portable',
    inputs: { value: { kind: 'data', type: 'float', default: 3 } },
    outputs: { result: { kind: 'data', type: 'float' } },
    props: { factor: { type: 'float', default: 2 } },
  } as const;

  beforeAll(() => {
    registerDefinitionNodes([{
      kind: 'definition-v1',
      moduleId: 'cascade.animtest.Doubler',
      definition,
      loadExecute: async () => (context: any) => {
        context.outputs.result.set(context.inputs.value * context.props.factor);
      },
    } as unknown as RuntimeRegistration]);
  });

  beforeEach(() => {
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });

  function libraryGraph(props: Record<string, unknown>) {
    return Graph.fromJSON({
      version: '0.2',
      nodes: [{ id: 'subject', type: 'cascade.animtest.Doubler', position: [0, 0], props }],
      connections: [],
    });
  }

  it('restores the expression a definition prop was saved with', async () => {
    const graph = libraryGraph({ factor: { value: 2, expression: '$F * 0.5' } });
    const node = graph.getNode('subject')!;

    expect(node.parm('factor')!.expression()).toBe('$F * 0.5');
    expect(await cookAt(graph, 10)).toBe(15);
  });

  it('restores a keyframe channel a definition prop was saved with', async () => {
    const graph = libraryGraph({
      factor: { value: 2, channel: { keys: [{ frame: 1, value: 1, interpolation: 'linear' }, { frame: 11, value: 11 }] } },
    });
    const node = graph.getNode('subject')!;

    expect(node.parm('factor')!.hasChannel()).toBe(true);
    expect(await cookAt(graph, 6)).toBe(18);
  });
});

/**
 * The Inspector's gestures, on a definition-v1 prop.
 *
 * These are the functions the panel calls — `setKeyAtPlayhead` for alt-click
 * and the diamond, `deleteKeyAtPlayhead` for ctrl-click, `keyState` for the
 * marker — driven here directly because a gesture is only worth testing at the
 * layer that does the work.
 *
 * They already reached a v1 prop before this change, because a v1 prop IS a
 * `param()` and the Parameters section renders those with the full row. What
 * they did not do was persist: keying one wrote a channel that the next save
 * discarded, which is the shape of bug where the animation is on screen until
 * you reopen the file. So the assertion that matters is the round-trip at the
 * end.
 */
describe('the Inspector gestures on a definition-v1 prop', () => {
  beforeEach(() => {
    setProjectModuleCompiler(async () => doublerModule);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });
  afterEach(() => setProjectModuleCompiler(null));

  it('keys, marks, deletes, and saves what it keyed', async () => {
    const graph = Graph.fromJSON(document({ factor: 2 }));
    const node = graph.getNode('subject')!;
    await cookAt(graph, 1);

    // The row is a real parameter row: it has a backing prop with a numeric
    // control, which is what makes the panel render the keyable variant with
    // an expression-capable field rather than a plain number input.
    expect(node.props.factor.fromParameter).toBe('factor');
    expect(node.props.factor.type).toBe('number');
    expect(keyState(node, 'factor')).toBe('none');

    // Alt-click at frame 1: the key takes the parameter's value here.
    expect(setKeyAtPlayhead(node, 'factor')).toBe('set');
    expect(keyState(node, 'factor')).toBe('keyed-here');

    // Alt-click again at frame 9 with nothing typed in between makes a FLAT
    // key, not a second value — the gesture records what the parameter is
    // worth at the playhead, and once a channel exists that is the channel's
    // own value. Same on a dynamic prop; asserted so the day someone adds
    // autokey, this is where it shows up.
    expressionEngine.setFrame(9);
    expect(setKeyAtPlayhead(node, 'factor')).toBe('set');
    expect(node.parm('factor')!.keys().map(key => [key.frame, key.value])).toEqual([[1, 2], [9, 2]]);

    // A key with a value of its own — the dope sheet's move, and the value
    // field's once it re-keys.
    node.parm('factor')!.setKey(9, 10);
    expect(node.parm('factor')!.keys().map(key => [key.frame, key.value])).toEqual([[1, 2], [9, 10]]);

    // It animates, in the host it was keyed in.
    expect(await cookAt(graph, 1)).toBe(6);
    expect(await cookAt(graph, 9)).toBe(30);

    // And it survives the save, which is the half that was broken.
    const reloaded = Graph.fromJSON(graph.toJSON());
    expect(reloaded.getNode('subject')!.parm('factor')!.keys().map(key => [key.frame, key.value]))
      .toEqual([[1, 2], [9, 10]]);
    expect(await cookAt(reloaded, 5)).toBe(18);

    // Ctrl-click removes the key under the playhead.
    expressionEngine.setFrame(9);
    expect(deleteKeyAtPlayhead(node, 'factor')).toBe('removed');
    expect(node.parm('factor')!.keys()).toHaveLength(1);
  });

  it('takes an expression typed into the parameter field and saves it', async () => {
    const graph = Graph.fromJSON(document({ factor: 2 }));
    const node = graph.getNode('subject')!;
    await cookAt(graph, 1);

    node.parm('factor')!.setExpression('$F * 0.5');
    expect(await cookAt(graph, 10)).toBe(15);

    const reloaded = Graph.fromJSON(graph.toJSON());
    expect(reloaded.getNode('subject')!.parm('factor')!.expression()).toBe('$F * 0.5');
    expect(await cookAt(reloaded, 10)).toBe(15);
  });
});
