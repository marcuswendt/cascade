/**
 * Retargeting a node onto a different VERSION of a definition.
 *
 * The move retargetModule already handled — same code, new location — needs no
 * reconciliation. Switching versions does: the code differs, so parameters may
 * have been added, removed or retyped, and the settings someone typed have to
 * be matched against the new declaration. These tests pin the policy, and in
 * particular that a setting is never lost silently.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { setEmbeddedCompiler } from '@/engine/nodeModuleLoader';

/** A node standing in for the definition being switched away from. */
function nodeWithOldDefinition(graph: Graph): Node {
  const node = new Node('node1', 'Dots', graph);
  (node as any).modulePath = 'local.DotsV1';
  (node as any).sourceType = 'embedded';
  node.code = 'export function execute() {}';
  graph.addElement(node);
  return node;
}

describe('Retargeting a node while keeping its parameter settings', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('reconciling against a known declaration list', () => {
    it('keeps a parameter whose name and type both survive', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });
      node.setParameter('spacing', 17);

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'spacing', type: 'int', defaultValue: 4 }],
      });

      expect(result.ok).toBe(true);
      expect(result.deferred).toBe(false);
      expect(result.kept).toEqual(['spacing']);
      expect(result.dropped).toEqual([]);
      expect(node.parameters.find(p => p.name === 'spacing')?.value).toBe(17);
    });

    it('reports a dropped parameter with the value it held, and removes it', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });
      node.param('weight', 0.5, { type: 'float' });
      node.setParameter('weight', 0.9);

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'spacing', type: 'int', defaultValue: 4 }],
      });

      expect(result.kept).toEqual(['spacing']);
      expect(result.dropped).toEqual([{ name: 'weight', value: 0.9 }]);
      // Reported AND gone: a ghost parameter the new definition never declares
      // would sit in the Inspector doing nothing.
      expect(node.parameters.map(p => p.name)).toEqual(['spacing']);
    });

    it('drops a promoted parameter without leaving its pin behind', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('weight', 0.5, { type: 'float' });
      node.setParameterPromoted('weight', true);
      expect(node.inputs.map(p => p.name)).toContain('weight');

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'spacing', type: 'int', defaultValue: 4 }],
      });

      expect(result.dropped.map(d => d.name)).toEqual(['weight']);
      expect(node.inputs.map(p => p.name)).not.toContain('weight');
    });

    it('gives a parameter the new definition adds its declared default', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [
          { name: 'spacing', type: 'int', defaultValue: 4 },
          { name: 'jitter', type: 'float', defaultValue: 0.25 },
        ],
      });

      expect(result.kept).toEqual(['spacing']);
      expect(result.defaulted).toEqual(['jitter']);
      expect(node.parameters.find(p => p.name === 'jitter')?.value).toBe(0.25);
    });

    it('carries a value across int and float, because that type came from inference', () => {
      // `inferParamType` reads param('weight', 1) as int purely because
      // Number.isInteger(1) is true, so a v2 declaring param('weight', 1.5)
      // would reset a tuned value over an inference artefact rather than over
      // anybody's decision. The numeric family carries; everything else stays
      // strict, which the conflict test below still proves.
      const node = nodeWithOldDefinition(graph);
      node.param('weight', 1, { type: 'int' });
      node.setParameter('weight', 3);

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'weight', type: 'float', defaultValue: 1.5 }],
      });

      expect(result.kept).toEqual(['weight']);
      expect(result.retyped).toEqual([]);
      expect(node.parameters.find(p => p.name === 'weight')?.value).toBe(3);
    });

    it('treats same name different type as a conflict, taking the new default', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('mode', 'soft', { type: 'string' });
      node.setParameter('mode', 'hard');

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'mode', type: 'int', defaultValue: 2 }],
      });

      expect(result.kept).toEqual([]);
      expect(result.retyped).toEqual([{ name: 'mode', from: 'string', to: 'int' }]);
      // No coercion: 'hard' is not turned into a number, the new type wins with
      // its default, and the conflict is the caller's to explain.
      const mode = node.parameters.find(p => p.name === 'mode');
      expect(mode?.value).toBe(2);
      expect(mode?.dataType).toBe('int');
    });

    it('carries an expression across with the value it belongs to', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('radius', 1.5, { type: 'float' });
      node.setParameter('radius', 8);
      node.props['radius'] = { value: 8, expression: "ch('../timer1/value') * 2" };

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'radius', type: 'float', defaultValue: 1.5 }],
      });

      expect(result.kept).toEqual(['radius']);
      expect(node.parameters.find(p => p.name === 'radius')?.value).toBe(8);
      expect(node.props['radius'].expression).toBe("ch('../timer1/value') * 2");
    });

    it('reports a dropped parameter that carried an expression, expression included', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('radius', 1.5, { type: 'float' });
      node.props['radius'] = { value: 3, expression: '$T * 2' };

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [{ name: 'spacing', type: 'int', defaultValue: 4 }],
      });

      expect(result.dropped).toEqual([{ name: 'radius', value: 1.5, expression: '$T * 2' }]);
      expect(node.props['radius']).toBeUndefined();
    });

    it('carries a prop value and its expression the same way', () => {
      const node = nodeWithOldDefinition(graph);
      node.addParm('threshold', { value: 0.2, type: 'slider' });
      node.updateProp('threshold', 0.75);
      node.props['threshold'] = { ...node.props['threshold'], expression: '$T' };

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        // A slider and a float are the same setting wearing different clothes.
        parameters: [{ name: 'threshold', kind: 'prop', type: 'number', defaultValue: 0.2 }],
      });

      expect(result.kept).toEqual(['threshold']);
      expect(node.props['threshold'].value).toBe(0.75);
      expect(node.props['threshold'].expression).toBe('$T');
    });

    it('reports a miss rather than throwing when the node is gone', () => {
      const result = graph.retargetDefinition('missing', 'local.DotsV2', 'embedded', '');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('missing');
      expect(result.dropped).toEqual([]);
    });

    it('produces a result a panel can render straight from JSON', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });
      node.param('weight', 0.5, { type: 'float' });
      node.param('mode', 'soft', { type: 'string' });

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', 'export function execute() {}', {
        parameters: [
          { name: 'spacing', type: 'int', defaultValue: 4 },
          { name: 'mode', type: 'int', defaultValue: 1 },
          { name: 'jitter', type: 'float', defaultValue: 0.25 },
        ],
      });

      expect(JSON.parse(JSON.stringify(result))).toEqual({
        ok: true,
        deferred: false,
        kept: ['spacing'],
        defaulted: ['jitter'],
        dropped: [{ name: 'weight', value: 0.5 }],
        retyped: [{ name: 'mode', from: 'string', to: 'int' }],
      });
    });
  });

  describe('reconciling on the next cook, when the declarations are not known', () => {
    afterEach(() => {
      setEmbeddedCompiler(null);
    });

    it('defers, then reports what the new code actually declared', async () => {
      // The compiler is injected rather than reached over HTTP; the code here is
      // already valid JS, so it passes through unchanged.
      setEmbeddedCompiler(async (code: string) => code);

      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });
      node.setParameter('spacing', 17);
      node.param('weight', 0.5, { type: 'float' });
      node.setParameter('weight', 0.9);

      const newCode = `export function execute(node) {
        node.param('spacing', 4, { type: 'int' });
        node.param('jitter', 0.25, { type: 'float' });
      }`;

      const result = graph.retargetDefinition('node1', 'local.DotsV2', 'embedded', newCode);
      expect(result.ok).toBe(true);
      expect(result.deferred).toBe(true);
      // Nothing is claimed before the code has run.
      expect(result.kept).toEqual([]);
      expect(node.hasPendingParameterCarryOver()).toBe(true);

      await node.execute();

      const report = graph.getRetargetReport('node1');
      expect(report).not.toBeNull();
      expect(report!.kept).toEqual(['spacing']);
      expect(report!.defaulted).toEqual(['jitter']);
      expect(report!.dropped).toEqual([{ name: 'weight', value: 0.9 }]);
      expect(node.parameters.find(p => p.name === 'spacing')?.value).toBe(17);
      expect(node.parameters.find(p => p.name === 'jitter')?.value).toBe(0.25);
      expect(node.hasPendingParameterCarryOver()).toBe(false);
    });

    it('keeps every setting when the new definition fails to compile', async () => {
      setEmbeddedCompiler(async () => 'this is not a module (');

      const node = nodeWithOldDefinition(graph);
      node.param('weight', 0.5, { type: 'float' });
      node.setParameter('weight', 0.9);

      graph.retargetDefinition('node1', 'local.Broken', 'embedded', 'broken');
      await node.execute();
      await Promise.resolve();

      // The compile failure abandons the reconciliation outright rather than
      // leaving it pending against a definition that will never declare anything.
      expect(node.hasPendingParameterCarryOver()).toBe(false);

      // A retarget that did not happen may not report anything as dropped, and
      // must not remove the value it was going to carry.
      expect(graph.getRetargetReport('node1')).toBeNull();
      expect(node.parameters.find(p => p.name === 'weight')?.value).toBe(0.9);
    });
  });

  describe('the identical-code callers retargetModule already served', () => {
    it('still returns a boolean and leaves parameters alone', () => {
      const node = nodeWithOldDefinition(graph);
      node.param('spacing', 4, { type: 'int' });
      node.setParameter('spacing', 17);

      expect(graph.retargetModule('node1', 'local.DotsCopy', 'embedded', 'export function execute() {}')).toBe(true);

      expect((node as any).modulePath).toBe('local.DotsCopy');
      expect(node.parameters.find(p => p.name === 'spacing')?.value).toBe(17);
      // No reconciliation was asked for, so none is pending and none is reported.
      expect(node.hasPendingParameterCarryOver()).toBe(false);
      expect(graph.getRetargetReport('node1')).toBeNull();
    });

    it('reports a miss rather than throwing when the node is gone', () => {
      expect(graph.retargetModule('missing', 'local.DotsCopy', 'embedded', '')).toBe(false);
    });
  });
});
