/**
 * End to end, against a real sketch document rather than a fixture:
 * ~/Documents/Cascade/field-logo/index.cascade, which is what Marcus was
 * looking at when he asked how to set a keyframe and the answer was "you
 * cannot".
 *
 * The document is outside the repo, so these are skipped when it is absent.
 * The node's real `execute()` cannot run here — it draws with OffscreenCanvas
 * and imports the project's own modules — so the parameter declarations are
 * replayed below, and the layer under test is what a sketch reads out of
 * `node.param(...).value` inside a cook: the stored value, the expression and
 * the keyframe channel resolving in the right order.
 *
 * That replay is the *legacy* declaration shape, and since the sketch was
 * converted to definition-v1 on 2026-09-08 it is no longer a copy of what the
 * module writes. It is kept deliberately: the parameter layer it exercises is
 * still what the class-based nodes use, and these are the only tests that run
 * it against real stored values rather than a fixture. The thing that must not
 * drift is the *document*, which is why the assertions below read the file and
 * the definition rather than trusting the replay.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractNodeDefinition } from '../packages/runtime/src/definition/extract.js';
import { expressionEngine } from '@/engine/expressions/index';
import { Graph } from '@/nodes/Graph';
import type { Node } from '@/nodes/Node';

const DOCUMENT = path.join(os.homedir(), 'Documents/Cascade/field-logo/index.cascade');
const present = fs.existsSync(DOCUMENT);

/** The declarations from the sketch, copied as they are written there. */
function declareGradientLogo(node: Node) {
  return {
    size: node.param('size', 1024, { min: 16, max: 4096, step: 16, type: 'int' }).value,
    scale: node.param('scale', 1.0, { min: 0.1, max: 3, step: 0.01, type: 'float' }).value,
    offset: node.param('offset', [0, 0], { min: -1, max: 1, step: 0.005, type: 'vec2' }).value,
    angle: node.param('angle', 0, { min: -180, max: 180, step: 0.5, type: 'float' }).value,
    focus: node.param('focus', 1.0, { min: 0, max: 1.4, step: 0.01, type: 'float' }).value,
  };
}

function loaded() {
  const graph = Graph.fromJSON(JSON.parse(fs.readFileSync(DOCUMENT, 'utf8')));
  expressionEngine.setGraph(graph);
  expressionEngine.setFps(25);
  expressionEngine.setFrame(1);
  return graph;
}

describe.skipIf(!present)('field-logo/index.cascade', () => {
  it('seeds the values the file records onto the parameters the code declares', () => {
    const graph = loaded();
    // logo-128 carries one authored parameter: size 128.
    const node = graph.getNode('logo-128')!;
    expect(declareGradientLogo(node).size).toBe(128);
    expect(declareGradientLogo(node).scale).toBe(1.0);
  });

  it('keeps logo-1024\'s angle driven by another node', () => {
    // This asserted `promoted === true` until the sketch converted to
    // definition-v1, and it went red without anything being lost. "A prop
    // promoted to a pin" and "a declared input" are two spellings of one
    // capability, and v1 only has the second — `parameterOptions` sets
    // `promotable: false` and the v1 context reads a prop from the parameter,
    // never from a connected port.
    //
    // So the assertion is the behaviour rather than the flag: `sine-1` drives
    // this angle, and it is declared in a way that permits that. Both halves
    // are needed — a connection to a prop would load and silently never
    // arrive, which is the failure this protects against.
    const document = JSON.parse(fs.readFileSync(DOCUMENT, 'utf8'));
    expect(document.connections).toContainEqual([['sine-1', 0, 'value'], ['logo-1024', 0, 'angle']]);

    const source = fs.readFileSync(path.join(path.dirname(DOCUMENT), 'nodes/field-io-gradient-logo/index.ts'), 'utf8');
    const extracted = extractNodeDefinition(source, 'index.ts', ts);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.definition.inputs?.angle).toMatchObject({ kind: 'data', type: 'float' });
    expect(extracted.definition.props ?? {}).not.toHaveProperty('angle');
  });

  it('stores a size only where it differs from the default', () => {
    // 1024 is the definition's own default, so `logo-1024` carrying no props
    // is correct rather than a dropped value — worth pinning, because "a node
    // with an empty props object" is exactly what the `params` fault looked
    // like from the outside.
    const document = JSON.parse(fs.readFileSync(DOCUMENT, 'utf8'));
    const node = (id: string) => document.nodes.find((entry: any) => entry.id === id);
    expect(node('logo-1024').props ?? {}).not.toHaveProperty('size');
    expect(node('logo-128').props).toMatchObject({ size: 128 });
  });

  it('carries an expression on angle into the value the cook reads', () => {
    const graph = loaded();
    const node = graph.getNode('logo-128')!;
    declareGradientLogo(node);

    node.parm('angle')!.setExpression('$T * 90');
    expect(node.isTimeDependent).toBe(true);

    // 25 fps, and `$T` is 0 at frame 1.
    const at = (frame: number) => {
      expressionEngine.setFrame(frame);
      return declareGradientLogo(node).angle as number;
    };
    expect(at(1)).toBeCloseTo(0, 6);
    expect(at(26)).toBeCloseTo(90, 6);
    expect(at(51)).toBeCloseTo(180, 6);
  });

  it('carries a keyframed scale into the value the cook reads', () => {
    const graph = loaded();
    const node = graph.getNode('logo-128')!;
    declareGradientLogo(node);

    node.parm('scale')!.setKey(1, 1, 'linear');
    node.parm('scale')!.setKey(11, 2, 'linear');

    expressionEngine.setFrame(6);
    expect(declareGradientLogo(node).scale).toBeCloseTo(1.5, 6);
    // Re-declaring, which is what the next cook does, must not lose the keys.
    expect(node.parm('scale')!.keys()).toHaveLength(2);
  });

  it('saves the raw value and the binding, and reloads both', () => {
    const graph = loaded();
    const node = graph.getNode('logo-128')!;
    declareGradientLogo(node);
    node.parm('angle')!.setExpression('$T * 90');

    const written = JSON.parse(JSON.stringify(graph.toJSON()));
    const saved = written.nodes.find((n: any) => n.id === 'logo-128');
    expect(saved.params).toEqual([{ name: 'size', value: 128 }]);
    expect(saved.props.angle).toEqual({ value: 0, expression: '$T * 90' });

    const reopened = Graph.fromJSON(written).getNode('logo-128')!;
    declareGradientLogo(reopened);
    expect(reopened.parm('angle')!.expression()).toBe('$T * 90');
    expect(reopened.rawParameterValue('size')).toBe(128);
  });
});
