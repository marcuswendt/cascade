import { describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import '@/nodes/core';

/**
 * The keyframe engine and Graph's save/load are written in different files by
 * different hands, and the join between them is two lines. This test exists
 * because the half that reads was the half nobody could exercise: building a
 * node through `Graph.fromJSON` needs a type that resolves, and a `cascade.*`
 * one throws unless its library happens to be registered.
 *
 * A channel that saves and does not load is the worst shape of bug here — the
 * animation is on screen until you reopen the file, and then silently is not.
 */
function keyedGraph() {
  const graph = new Graph();
  const node = new Node('sine-1', 'project.sine', graph);
  graph.addElement(node);
  node.addParm('angle', { value: 0 } as any);
  node.parm('angle')!.setKey(1, 0, 'linear');
  node.parm('angle')!.setKey(11, 100);
  return { graph, node };
}

describe('a keyframe channel survives a real save and load', () => {
  it('writes the channel beside the value', () => {
    const { graph } = keyedGraph();
    const saved: any = graph.toJSON().nodes.find((n: any) => n.id === 'sine-1');

    expect(saved.props.angle).toEqual({
      value: 0,
      channel: {
        keys: [
          { frame: 1, value: 0, interpolation: 'linear' },
          // The default interpolation is omitted rather than written out.
          { frame: 11, value: 100 },
        ],
      },
    });
  });

  it('reads it back with its keys and its time-dependence', () => {
    const { graph } = keyedGraph();
    const loaded = Graph.fromJSON(graph.toJSON());
    const node = loaded.getNode('sine-1')!;

    expect(node.parm('angle')!.hasChannel()).toBe(true);
    expect(node.parm('angle')!.keys()).toEqual([
      { frame: 1, value: 0, interpolation: 'linear' },
      { frame: 11, value: 100, interpolation: 'smooth' },
    ]);
    // Without this a keyed parameter loaded from disk would never be recooked
    // per frame, so the animation would exist and not play.
    expect(node.isTimeDependent).toBe(true);
  });

  it('leaves an unkeyed prop as a bare value', () => {
    const graph = new Graph();
    const node = new Node('plain-1', 'project.plain', graph);
    graph.addElement(node);
    node.addParm('size', { value: 7 } as any);

    const saved: any = graph.toJSON().nodes.find((n: any) => n.id === 'plain-1');
    expect(saved.props.size).toBe(7);
  });
});
