/**
 * A declaration that says it contains things has to reach the host.
 *
 * Marcus, 2026-09-09, opening a graph in Studio: *"how can i inspect the
 * subnet? double clicking on the node goes to the code view ... not the subnet
 * ... also the i and o keys are not doing anything."*
 *
 * **Two features, one cause.** `NodeUI`'s double-click handler dives into a
 * network and opens the code editor otherwise; `Canvas`'s `i` shortcut dives
 * in and `o` jumps out. Both gate on `isNetwork()`, both were correct, and
 * both were asking a question that could only ever answer no — because
 * `isNetwork` was a class override and a `definition-v1` node is a plain
 * `Node`, so `cascade.core.Subnet` created through the adapter reported false.
 *
 * The lesson worth the test: **a declaration is not information until
 * something reads it.** `container: "subnet"` had been in the definition since
 * the node was written.
 */
import { describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { attachDefinition } from '@/nodes/definition/DefinitionNode';
import { subnetRegistration } from '../packages/runtime/src/builtins/core/index.js';

function attached(registration: unknown): Node {
  const graph = new Graph();
  const node = new Node('subject', 'Test', graph);
  graph.addElement(node);
  attachDefinition(node, registration as never, {});
  return node;
}

describe('a node whose definition declares a container', () => {
  it('reports itself as a network', () => {
    const node = attached(subnetRegistration);
    expect(node.declaredContainer).toBe('subnet');
    expect(node.isNetwork()).toBe(true);
  });

  /** The two behaviours that were broken, at the level they branch on. */
  it('is what the dive-in and i/o shortcuts branch on', () => {
    const subnet = attached(subnetRegistration);
    const plain = attached({
      kind: 'definition-v1',
      moduleId: 'cascade.test.Plain',
      definition: {
        apiVersion: 1, label: 'Plain', runsOn: 'portable',
        inputs: {}, outputs: {}, props: {},
      },
      loadExecute: async () => () => {},
    });

    // `NodeUI.handleDoubleClick` dispatches diveInto for the first and edit
    // for the second; `Canvas` gates `i` on exactly this.
    expect(subnet.isNetwork()).toBe(true);
    expect(plain.isNetwork()).toBe(false);
  });
});

describe('a node with no declaration', () => {
  it('is not a network', () => {
    const graph = new Graph();
    const node = new Node('bare', 'Test', graph);
    expect(node.declaredContainer).toBeNull();
    expect(node.isNetwork()).toBe(false);
  });
});
