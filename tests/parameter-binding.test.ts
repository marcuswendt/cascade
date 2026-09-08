/**
 * One binding layer: parameters declared with `param()` reach every binding.
 *
 * These tests exist because the suite could not have caught the fault they
 * cover. Measured 2026-09-08: `param('scale', 1)` wrote to `node.parameters`,
 * left `node.props` empty, and `parm('scale')` returned null — so no parameter
 * in any sketch could hold an expression or a keyframe. Every existing test
 * passed because every existing test declared its parameters with `addParm`,
 * which writes the other store. So: nothing here uses `addParm`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { expressionEngine } from '@/engine/expressions/index';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { setKeyAtPlayhead } from '@/editor/keyframeGesture';

/** A dynamic sketch node: it declares its parameters inside execute(), which
 *  means the declaration is re-run on every cook. */
function sketch(graph: Graph, id = 'logo-1'): Node {
  const node = new Node(id, 'project.field-io-gradient-logo', graph);
  graph.addElement(node);
  return node;
}

function declare(node: Node): void {
  node.param('size', 1024, { min: 16, max: 4096, step: 16, type: 'int' });
  node.param('scale', 1.0, { min: 0.1, max: 3, step: 0.01, type: 'float' });
  node.param('angle', 0, { min: -180, max: 180, step: 0.5, type: 'float' });
}

describe('a parameter declared with param()', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = sketch(graph);
    declare(node);
    expressionEngine.setGraph(graph);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });

  it('is reachable through parm() and evalParm() — the fault this fixes', () => {
    expect(node.parameters.map(p => p.name)).toEqual(['size', 'scale', 'angle']);
    expect(Object.keys(node.props)).toEqual(['size', 'scale', 'angle']);
    expect(node.parm('scale')).not.toBeNull();
    expect(node.evalParm('scale')).toBe(1.0);
  });

  it('carries its declaration onto the control that renders it', () => {
    const scale = node.props.scale;
    expect(scale.type).toBe('number');
    expect(scale.params).toMatchObject({ min: 0.1, max: 3, step: 0.01 });
    expect(node.props.size.params?.integer).toBe(true);
    // Rendered by the Parameters section, so it must not also appear in the
    // props section.
    expect(scale.fromParameter).toBe('scale');
    expect(scale.hidden).toBe(true);
  });

  it('holds a value across a re-declaration, which happens on every cook', () => {
    node.setParameter('scale', 2.5);
    declare(node);
    declare(node);
    expect(node.rawParameterValue('scale')).toBe(2.5);
    expect(node.parameters.find(p => p.name === 'scale')!.value).toBe(2.5);
    expect(node.parameters).toHaveLength(3);
  });

  it('holds an expression across a re-declaration, and resolves it into .value', () => {
    node.parm('angle')!.setExpression('$F * 3');
    expressionEngine.setFrame(4);
    declare(node);

    expect(node.props.angle.expression).toBe('$F * 3');
    expect(node.evalParm('angle')).toBe(12);
    // The reason the whole unification matters: the sketch reads `.value`
    // inside execute() and gets the expression's result without knowing there
    // is an expression.
    expect(node.param('angle', 0, { type: 'float' }).value).toBe(12);
    // And the raw value the author set is still the raw value.
    expect(node.rawParameterValue('angle')).toBe(0);
  });

  it('holds a channel across a re-declaration, and changes with the frame', () => {
    const angle = node.parm('angle')!;
    angle.setKey(1, 0, 'linear');
    angle.setKey(11, 100, 'linear');
    declare(node);

    expect(angle.hasChannel()).toBe(true);
    expressionEngine.setFrame(6);
    expect(node.param('angle', 0, { type: 'float' }).value).toBeCloseTo(50, 10);
    expressionEngine.setFrame(11);
    expect(node.param('angle', 0, { type: 'float' }).value).toBeCloseTo(100, 10);
  });

  it('becomes time-dependent when keyed or given a time expression', () => {
    expect(node.isTimeDependent).toBe(false);
    node.parm('angle')!.setExpression('$T * 0.25');
    expect(node.isTimeDependent).toBe(true);
    node.parm('angle')!.deleteExpression();
    expect(node.isTimeDependent).toBe(false);
    node.parm('angle')!.setKey(5, 1);
    expect(node.isTimeDependent).toBe(true);
  });

  it('keys the raw value when a key already sits on this frame', () => {
    // The gesture contract from keyframeGesture: once a channel exists,
    // evaluating resolves it, so re-keying must take the raw value or an edit
    // typed a moment ago is silently discarded. That depends on the raw value
    // still living somewhere after unification — it lives in the prop.
    expressionEngine.setFrame(1);
    expect(setKeyAtPlayhead(node, 'angle')).toBe('set');
    expect(node.parm('angle')!.keys()[0].value).toBe(0);

    node.setParameter('angle', 55);
    expect(setKeyAtPlayhead(node, 'angle')).toBe('set');
    expect(node.parm('angle')!.keys()).toHaveLength(1);
    expect(node.parm('angle')!.keys()[0].value).toBe(55);
  });

  it('still promotes to an input pin', () => {
    node.setParameterPromoted('angle', true);
    expect(node.parameters.find(p => p.name === 'angle')!.promoted).toBe(true);
    expect(node.inputs.map(port => port.name)).toContain('angle');
    node.setParameterPromoted('angle', false);
    expect(node.inputs.map(port => port.name)).not.toContain('angle');
  });
});

describe('the document a bound parameter writes', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = sketch(graph);
    declare(node);
    expressionEngine.setGraph(graph);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });

  function saved() {
    return graph.toJSON().nodes.find((n: any) => n.id === 'logo-1');
  }

  it('records nothing for a parameter left at its default', () => {
    expect(saved().params).toBeUndefined();
    expect(saved().props).toBeUndefined();
  });

  it('records a changed parameter in params, and only there', () => {
    node.setParameter('scale', 2.5);
    expect(saved().params).toEqual([{ name: 'scale', value: 2.5 }]);
    expect(saved().props).toBeUndefined();
  });

  it('writes the raw value, never the value the frame happened to sample', () => {
    node.setParameter('angle', 30);
    node.parm('angle')!.setKey(1, 0, 'linear');
    node.parm('angle')!.setKey(11, 100, 'linear');
    expressionEngine.setFrame(6);

    expect(node.evalParm('angle')).toBeCloseTo(50, 10);
    const params = saved().params.find((p: any) => p.name === 'angle');
    expect(params.value).toBe(30);
  });

  it('gives a bound parameter a props entry, because params cannot hold a binding', () => {
    node.parm('scale')!.setExpression('$T * 0.25');
    const props = saved().props;
    expect(props.scale.expression).toBe('$T * 0.25');
    expect(props.scale.value).toBe(1);
  });

  it('round-trips an expression and a channel on a parameter', () => {
    node.setParameter('angle', 30);
    node.parm('angle')!.setKey(1, 0, 'linear');
    node.parm('angle')!.setKey(11, 100, 'linear');
    node.parm('scale')!.setExpression('$T * 0.25');

    const reloaded = Graph.fromJSON(JSON.parse(JSON.stringify(graph.toJSON())));
    const restored = reloaded.getNode('logo-1')!;
    // The code has not run yet: the values are seeded, and declaring them is
    // what a cook does next.
    declare(restored);
    expressionEngine.setGraph(reloaded);

    expect(restored.rawParameterValue('angle')).toBe(30);
    expect(restored.parm('angle')!.keys().map(k => k.frame)).toEqual([1, 11]);
    expect(restored.props.scale.expression).toBe('$T * 0.25');
    expect(restored.isTimeDependent).toBe(true);
    expressionEngine.setFrame(6);
    expect(restored.param('angle', 0, { type: 'float' }).value).toBeCloseTo(50, 10);
  });

  it('loads a document written before any of this existed', () => {
    // Two shapes from the old world, in one node: a param value in `params`
    // and an unrelated prop in `props`, the latter written as a bare value.
    const legacy = {
      version: '0.2',
      nodes: [{
        id: 'logo-1',
        module: 'project.field-io-gradient-logo',
        position: [0, 0],
        source: 'project',
        params: [{ name: 'scale', value: 1.75 }],
        props: { note: 'kept' },
      }],
      connections: [],
    };
    const loaded = Graph.fromJSON(legacy as any);
    const restored = loaded.getNode('logo-1')!;
    declare(restored);

    expect(restored.rawParameterValue('scale')).toBe(1.75);
    expect(restored.parameters.find(p => p.name === 'scale')!.value).toBe(1.75);
    expect(restored.props.note.value).toBe('kept');
  });
});
