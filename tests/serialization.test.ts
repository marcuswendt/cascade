/**
 * Serialization Tests
 * Tests for graph save/load functionality (toJSON)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';
import { Annotation } from '@/nodes/annotations/Annotation';
import '@/nodes/core';

describe('Serialization', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('toJSON()', () => {
    it('should serialize empty graph', () => {
      const json = graph.toJSON();

      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('nodes');
      expect(json.nodes).toHaveLength(0);
    });

    it('should serialize nodes with positions', () => {
      const node = new Node('node1', 'Test', graph);
      node.position = { x: 100, y: 200 };
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes).toHaveLength(1);
      expect(json.nodes[0].id).toBe('node1');
      // Type is serialized as 'module' with full package path
      expect(json.nodes[0].module).toContain('Test');
      // Position is serialized as array [x, y]
      expect(json.nodes[0].position).toEqual([100, 200]);
    });

    it('should serialize node props', () => {
      const node = new Node('node1', 'Test', graph);
      node.props.value = {
        name: 'value',
        type: 'number',
        value: 42
      };
      node.props.label = {
        name: 'label',
        type: 'string',
        value: 'test'
      };
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].props).toBeDefined();
      expect(json.nodes[0].props.value).toBe(42);
      expect(json.nodes[0].props.label).toBe('test');
    });

    it('should serialize expressions in props', () => {
      const node = new Node('node1', 'Test', graph);
      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0,
        expression: 'time * 10'
      };
      graph.addElement(node);

      const json = graph.toJSON();

      // Expressions are stored inline in props as { value, expression }
      expect(json.nodes[0].props.value).toEqual({ value: 0, expression: 'time * 10' });
    });

    it('should serialize connections', () => {
      const nodeA = new Node('nodeA', 'Test', graph);
      const nodeB = new Node('nodeB', 'Test', graph);
      graph.addElement(nodeA);
      graph.addElement(nodeB);

      nodeA.out('output', 'param');
      nodeB.in('input', null);

      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      const json = graph.toJSON();

      expect(json.connections).toBeDefined();
      expect(json.connections.length).toBeGreaterThan(0);
    });

    it('should serialize node comments', () => {
      const node = new Node('node1', 'Test', graph);
      node.comment = 'This is a test node';
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].comment).toBe('This is a test node');
    });

    it('should serialize bypassed state', () => {
      const node = new Node('node1', 'Test', graph);
      node.bypass = true;
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].bypass).toBe(true);
    });

    it('should include version in output', () => {
      const json = graph.toJSON();
      expect(json.version).toBeDefined();
      expect(typeof json.version).toBe('string');
    });

    it('should include metadata', () => {
      const json = graph.toJSON();
      expect(json.metadata).toBeDefined();
      expect(json.metadata.created).toBeDefined();
      expect(json.metadata.modified).toBeDefined();
    });

    it('preserves the graph creation timestamp across saves', () => {
      const created = '2024-01-02T03:04:05.000Z';
      const loaded = Graph.fromJSON({
        version: '0.2',
        metadata: { name: 'Archive', created },
        nodes: [],
        connections: [],
      });

      expect(loaded.toJSON().metadata.created).toBe(created);
      expect(loaded.toJSON().metadata.created).toBe(created);
    });
  });

  describe('Graph.fromJSON() static method', () => {
    it('should create graph from empty JSON', () => {
      const json = {
        version: '0.2',
        nodes: [],
        connections: []
      };

      const newGraph = Graph.fromJSON(json);

      expect(newGraph).toBeInstanceOf(Graph);
      expect(newGraph.elements).toHaveLength(0);
    });

    it.each([
      'cascade.lens.Generate',
      'cascade.lens.Edit',
      'cascade.quill.Describe',
      'cascade.quill.Enhance',
      'cascade.quill.Chat',
      'cascade.quill.System',
      'cascade.lens.DoesNotExist',
    ])('rejects unknown standard-library module %s regardless of serialized source', (moduleId) => {
      for (const source of [undefined, 'stdlib', 'embedded', 'project'] as const) {
        const node = {
          id: `${moduleId}-${source ?? 'omitted'}`,
          module: moduleId,
          ...(source === undefined ? {} : { source }),
        };

        expect(
          () => Graph.fromJSON({ version: '0.2', nodes: [node], connections: [] }),
          `${moduleId} with source ${source ?? 'omitted'}`,
        ).toThrow(moduleId);
      }
    });

    it.each([undefined, 'stdlib', 'embedded', 'project'] as const)(
      'keeps local custom modules loadable when source is %s',
      (source) => {
        const loaded = Graph.fromJSON({
          version: '0.2',
          nodes: [{
            id: 'custom',
            module: 'local.Custom',
            ...(source === undefined ? {} : { source }),
          }],
          connections: [],
        });

        expect(loaded.getNode('custom')).toMatchObject({ modulePath: 'local.Custom' });
      },
    );

    // Note: Full node deserialization tests require registered node types
    // These are integration tests that would need the full node library loaded
  });

  describe('Hierarchical serialization', () => {
    it('should serialize subnet nodes', () => {
      const subnet = new SubnetNode('mySubnet', graph);
      graph.addElement(subnet);

      const json = graph.toJSON();

      const subnetData = json.nodes.find((n: any) => n.id === 'mySubnet');
      expect(subnetData).toBeDefined();
      // SubnetNode serializes with 'module' containing package path
      expect(subnetData.module).toContain('Subnet');
    });

    it('serializes node and annotation parents without nesting elements', () => {
      const subnet = new SubnetNode('mySubnet', graph);
      const child = new Node('child1', 'Test', graph);
      const note = new Annotation('note1', 'Text', graph);
      graph.addElement(subnet);
      graph.addElement(child);
      graph.addElement(note);
      subnet.addChild(child);
      subnet.addChild(note);

      const json = graph.toJSON();

      expect(json.nodes.find((n: any) => n.id === 'mySubnet')).not.toHaveProperty('parent');
      expect(json.nodes.find((n: any) => n.id === 'child1')).toMatchObject({ parent: 'mySubnet' });
      expect(json.annotations.find((a: any) => a.id === 'note1')).toMatchObject({ parent: 'mySubnet' });
    });

    it('restores nested hierarchy, relative positions, ports, and connections', () => {
      const loaded = Graph.fromJSON({
        version: '0.2',
        nodes: [
          { id: 'source', module: 'local.Source', source: 'embedded', position: [0, 0], outputs: [{ name: 'value' }] },
          { id: 'outer', module: 'cascade.core.Subnet', source: 'stdlib', position: [100, 200] },
          { id: 'inner', module: 'cascade.core.Subnet', source: 'stdlib', parent: 'outer', position: [20, 30] },
          { id: 'inner-input', module: 'cascade.core.Input', source: 'stdlib', parent: 'inner', position: [4, 5], props: { inputIndex: 2 } },
        ],
        annotations: [
          { id: 'note', type: 'text', parent: 'inner', position: [8, 9], content: 'nested' },
        ],
        connections: [[['source', 0, 'value'], ['inner', 2, 'input_2']]],
      });

      const outer = loaded.getNode('outer')!;
      const inner = loaded.getNode('inner')!;
      const input = loaded.getNode('inner-input')!;
      const note = loaded.getAnnotation('note')!;

      expect(inner.parent).toBe(outer);
      expect(input.parent).toBe(inner);
      expect(note.parent).toBe(inner);
      expect(inner.children()).toEqual([input, note]);
      expect(input.position).toEqual({ x: 4, y: 5 });
      expect(inner.inputs).toHaveLength(3);
      expect(loaded.connections).toHaveLength(1);
    });

    it.each([
      ['missing parent', 'missing', 'child'],
      ['non-network parent', 'plain', 'child'],
      ['self parent', 'child', 'child'],
    ])('keeps a child at root for a %s', (_case, parent, child) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = Graph.fromJSON({
        version: '0.2',
        nodes: [
          { id: 'plain', module: 'local.Plain', source: 'embedded', position: [0, 0] },
          { id: child, module: 'local.Child', source: 'embedded', parent, position: [1, 2] },
        ],
      });

      expect(loaded.getNode(child)?.parent).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"${child}"`));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"${parent}"`));
      warn.mockRestore();
    });

    it('breaks a parent cycle without dropping either node', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = Graph.fromJSON({
        version: '0.2',
        nodes: [
          { id: 'a', module: 'cascade.core.Subnet', source: 'stdlib', parent: 'b', position: [0, 0] },
          { id: 'b', module: 'cascade.core.Subnet', source: 'stdlib', parent: 'a', position: [0, 0] },
        ],
      });

      expect(loaded.nodes).toHaveLength(2);
      expect(loaded.getNode('a')?.parent).toBe(loaded.getNode('b'));
      expect(loaded.getNode('b')?.parent).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cycle'));
      warn.mockRestore();
    });

    it('does not add parent fields to a legacy flat document', () => {
      const loaded = Graph.fromJSON({
        version: '0.2',
        nodes: [{ id: 'flat', module: 'local.Flat', source: 'embedded', position: [12, 34] }],
      });

      expect(loaded.toJSON().nodes[0]).not.toHaveProperty('parent');
    });
  });

  describe('Project metadata', () => {
    /**
     * The name was read only from inside `if (json.project)` — the block that
     * carries npm packages — so a graph without packages, which is most of
     * them, lost its name on load and then wrote 'Cascade Graph' back over it
     * on the next save. The browser tab leads with this name, so the symptom
     * was every project's tab reading the same thing.
     */
    it('keeps metadata.name through a load with no project block', () => {
      const loaded = Graph.fromJSON({
        version: '0.2',
        metadata: { name: 'Cloud Posters' },
        nodes: [],
      });

      expect(loaded.project.name).toBe('Cloud Posters');
      expect(loaded.toJSON().metadata.name).toBe('Cloud Posters');
    });

    it('keeps metadata.name when a project block is present', () => {
      const loaded = Graph.fromJSON({
        version: '0.2',
        metadata: { name: 'My Artwork' },
        project: { packages: [] },
        nodes: [],
      });

      expect(loaded.project.name).toBe('My Artwork');
    });

    it('round-trips graph description, author, and creation timestamp', () => {
      const loaded = Graph.fromJSON({
        version: '0.2',
        metadata: { name: 'Print Study', description: 'A generative edition', author: 'Studio', created: '2024-01-02T03:04:05.000Z' },
        nodes: [],
      });

      expect(loaded.project).toMatchObject({ name: 'Print Study', description: 'A generative edition', author: 'Studio' });
      expect(loaded.created).toBe('2024-01-02T03:04:05.000Z');
      expect(loaded.toJSON().metadata).toMatchObject({
        name: 'Print Study', description: 'A generative edition', author: 'Studio', created: '2024-01-02T03:04:05.000Z',
      });
    });

    it('falls back to the default name when the file names none', () => {
      const loaded = Graph.fromJSON({ version: '0.2', nodes: [] });

      expect(loaded.toJSON().metadata.name).toBe('Cascade Graph');
    });
  });

  describe('Multiple nodes serialization', () => {
    it('should serialize multiple nodes', () => {
      for (let i = 0; i < 5; i++) {
        const node = new Node(`node${i}`, 'Test', graph);
        node.position = { x: i * 100, y: i * 50 };
        graph.addElement(node);
      }

      const json = graph.toJSON();

      expect(json.nodes).toHaveLength(5);
      expect(json.nodes[0].id).toBe('node0');
      expect(json.nodes[4].id).toBe('node4');
    });

    it('should preserve node order', () => {
      const nodes = ['alpha', 'beta', 'gamma'].map(id => {
        const node = new Node(id, 'Test', graph);
        graph.addElement(node);
        return node;
      });

      const json = graph.toJSON();
      const ids = json.nodes.map((n: any) => n.id);

      expect(ids).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});
