/**
 * A node whose input is about to be connected must not cook yet.
 *
 * Reported against `volume-field` on 2026-09-10, by someone who cloned
 * `cascade-sketches` and had verified from the cache files that the render was
 * actually correct: *"Log panel shows permanent false errors. On load it logs
 * 'nothing wired to its image input' for every downstream node… the errors just
 * never clear, so it reads as broken when it isn't."*
 *
 * The cause was not a race in the sense of nondeterminism. **A node's ports are
 * created by running its code**, so on load a connection into a node that has
 * never executed has no port to attach to, and Studio deliberately cooks the
 * graph up to sixteen times until the wiring settles. Early passes therefore
 * reached nodes whose upstream edge had not bound, those nodes ran with
 * `undefined` on that input and threw whatever their author wrote for the
 * unwired case, and a later pass succeeded. The graph came out right; the log
 * kept the throws.
 *
 * So the fix is a distinction the scheduler could not previously make: an
 * input that is *pending* is not an input that is *missing*.
 */
import { describe, expect, it } from 'vitest';

import { Graph } from '../src/nodes/Graph';
import { Node } from '../src/nodes/Node';

/** A node that throws if its `image` input is undefined — what every project
 *  node in `volume-field` does, and correctly. */
function consumer(graph: Graph, id: string, log: string[]): Node {
  const node = new Node(id, 'project.consumer', graph);
  node.in('image', undefined, { type: 'image' });
  node.out('image', 'param', { type: 'image' });
  node.setFunction(async (self: any) => {
    const incoming = self.inputs.find((port: any) => port.name === 'image')?.value;
    if (incoming === undefined) {
      log.push(`${id}: nothing wired to its image input`);
      throw new Error(`${id} has nothing wired to its image input`);
    }
    self.outputs.find((port: any) => port.name === 'image').value = `${id}.png`;
  });
  graph.addElement(node);
  return node;
}

function source(graph: Graph, id: string): Node {
  const node = new Node(id, 'project.source', graph);
  node.out('image', 'param', { type: 'image' });
  node.setFunction(async (self: any) => {
    self.outputs.find((port: any) => port.name === 'image').value = `${id}.png`;
  });
  graph.addElement(node);
  return node;
}

describe('pendingConnectionTargets', () => {
  it('names the nodes a pending edge points at', () => {
    const graph = new Graph();
    (graph as any)._connectionsToRestore = [
      [['ramp', 0, 'image'], ['noise', 0, 'image']],
      [['noise', 0, 'image'], ['hue', 0, 'image']],
    ];
    expect([...graph.pendingConnectionTargets()].sort()).toEqual(['hue', 'noise']);
    // Sources are not held back: nothing is pending INTO them.
    expect(graph.pendingConnectionTargets().has('ramp')).toBe(false);
  });

  it('is empty with no pending list at all', () => {
    expect(new Graph().pendingConnectionTargets().size).toBe(0);
  });

  it('is empty once the load has settled', () => {
    // Otherwise an edge that can never bind — a bypassed or unrunnable
    // upstream — would hold its target back forever, and the node would simply
    // never cook. That is worse than the false errors: nothing in the
    // interface would explain it.
    const graph = new Graph();
    (graph as any)._connectionsToRestore = [[['a', 0, 'image'], ['b', 0, 'image']]];
    expect(graph.pendingConnectionTargets().size).toBe(1);
    graph.markConnectionsSettled();
    expect(graph.pendingConnectionTargets().size).toBe(0);
  });

  it('ignores a malformed pending entry rather than throwing', () => {
    const graph = new Graph();
    (graph as any)._connectionsToRestore = [null, ['a'], [['a', 0], ['b', 0]], 'nonsense'];
    expect([...graph.pendingConnectionTargets()]).toEqual(['b']);
  });
});

describe('the load warm-up no longer logs false errors', () => {
  it('does not cook a node whose inbound edge has not bound', async () => {
    const log: string[] = [];
    const graph = new Graph();
    source(graph, 'ramp');
    const noise = consumer(graph, 'noise', log);
    const hue = consumer(graph, 'hue', log);
    // The state a freshly loaded file is in: the nodes exist, the edges do not
    // yet, and the file says where they go.
    (graph as any)._connectionsToRestore = [
      [['ramp', 0, 'image'], ['noise', 0, 'image']],
      [['noise', 0, 'image'], ['hue', 0, 'image']],
    ];
    for (const node of graph.nodes) node.setCookState('stale');

    await graph.scheduler.flush();

    // The point of the fix: neither consumer ran, so neither threw, so nothing
    // false reached the log.
    expect(log).toEqual([]);
    expect(noise.error).toBeNull();
    expect(hue.error).toBeNull();
  });

  it('cooks them once the edges bind, and the output is right', async () => {
    const log: string[] = [];
    const graph = new Graph();
    const ramp = source(graph, 'ramp');
    const noise = consumer(graph, 'noise', log);
    (graph as any)._connectionsToRestore = [
      [['ramp', 0, 'image'], ['noise', 0, 'image']],
    ];
    for (const node of graph.nodes) node.setCookState('stale');

    await graph.scheduler.flush();
    expect(log).toEqual([]);

    // What `cookGraph` does between passes: the ports exist now, so the edge
    // binds.
    graph.restoreConnections();
    expect(graph.pendingConnectionTargets().size).toBe(0);
    for (const node of graph.nodes) node.setCookState('stale');
    await graph.scheduler.flush();

    expect(log).toEqual([]);
    expect(noise.outputs.find(port => port.name === 'image')?.value).toBe('noise.png');
    expect(ramp.error).toBeNull();
  });

  it('a genuinely unwired node still errors after the load has settled', async () => {
    // The other half, and the reason this is a distinction rather than a mute:
    // "nothing wired to my image input" is a true and useful error once the
    // wiring is done. Silencing it would trade a false error for a silent one.
    const log: string[] = [];
    const graph = new Graph();
    const orphan = consumer(graph, 'orphan', log);
    (graph as any)._connectionsToRestore = [
      [['missing', 0, 'image'], ['orphan', 0, 'image']],
    ];
    graph.markConnectionsSettled();
    orphan.setCookState('stale');

    await graph.scheduler.flush();
    expect(log).toEqual(['orphan: nothing wired to its image input']);
    expect(orphan.error).toBeTruthy();
  });

  it('a node the file never wires anything into is not held back', async () => {
    // A pending edge into `b` must not stop `a` cooking. Blocking by node id
    // rather than by "anything is pending" is what keeps the sources running,
    // and the sources are what make the edges bindable.
    const graph = new Graph();
    const ramp = source(graph, 'ramp');
    (graph as any)._connectionsToRestore = [
      [['ramp', 0, 'image'], ['noise', 0, 'image']],
    ];
    ramp.setCookState('stale');
    await graph.scheduler.flush();
    expect(ramp.outputs.find(port => port.name === 'image')?.value).toBe('ramp.png');
  });
});
