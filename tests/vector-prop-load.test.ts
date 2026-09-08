import { describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';

/**
 * A `vec3` prop must survive a load as a `vec3`.
 *
 * `isColorValue` answers true for any array of three or four numbers, and the
 * deserialise path had no `type === 'color'` guard — so every `vec3`/`vec4`
 * prop in every sketch was silently rewritten to an RGB object on load, and
 * divided by 255 whenever a component exceeded 1. `cloud-volumes` threw on
 * `const [az, el, radius] = props.camera` and the whole WebGPU path was
 * blocked behind it. `vec2` survived only by being shorter than the threshold,
 * which is why a ranged-vector change looked innocent and was.
 *
 * Diagnosed by MW-OBSERVATORY-ART, measured in the page: `cameraIsArray
 * false`, `resIsArray true`.
 */
describe('loading a document with vector props', () => {
  function loaded(props: Record<string, unknown>) {
    const graph = Graph.fromJSON({
      version: '0.2',
      nodes: [{ id: 'n', module: 'project.Volume', source: 'project', position: [0, 0], props }],
      connections: [],
    });
    return graph.getNode('n')!;
  }

  it('keeps a three-component vector an array', () => {
    // The reported case, including a component above 1 — which is what tripped
    // the divide-by-255 branch and made the corruption unmistakable.
    const node = loaded({ camera: [0.55, 0.12, 1.95] });
    expect(node.props.camera.value).toEqual([0.55, 0.12, 1.95]);
  });

  it('keeps a four-component vector an array', () => {
    const node = loaded({ bounds: [1, 2, 3, 4] });
    expect(node.props.bounds.value).toEqual([1, 2, 3, 4]);
  });

  it('still normalises the shapes that can only be colours', () => {
    // An object with r/g/b, and a hex string, are unambiguous — those are the
    // legacy forms the coercion exists for and they keep working.
    expect(loaded({ tint: { r: 1, g: 0.5, b: 0 } }).props.tint.value)
      .toMatchObject({ r: 1, g: 0.5, b: 0 });
    expect(loaded({ tint: '#ff8000' }).props.tint.value)
      .toMatchObject({ r: expect.any(Number), g: expect.any(Number), b: expect.any(Number) });
  });

  /**
   * **Not covered here: an array on a prop already declared `color`.**
   *
   * That branch needs a node whose colour prop exists in `node.props` before
   * the document's values are restored, which means a class-based node
   * declaring one in `setup()`. Building that through `Graph.fromJSON` failed
   * on node reconstruction rather than on the rule, and a test that has to
   * fight its fixture is not evidence about the code.
   *
   * Named rather than left implied. The three cases above cover the fault that
   * was reported and the two shapes that can only be colours; the declared
   * case keeps its old behaviour and nothing here proves it.
   */
});
