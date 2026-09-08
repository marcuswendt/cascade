/**
 * End to end, against a real sketch document rather than a fixture:
 * ~/Documents/Cascade/field-logo/index.cascade, which is what Marcus was
 * looking at when he asked how to set a keyframe and the answer was "you
 * cannot".
 *
 * The document is outside the repo, so these are skipped when it is absent.
 * The node's real `execute()` cannot run here — it draws with OffscreenCanvas
 * and imports the project's own modules — so the parameter declarations are
 * replayed verbatim from `nodes/field-io-gradient-logo/index.ts`, which is the
 * layer under test anyway: what a sketch reads out of `node.param(...).value`
 * inside a cook.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('keeps a promoted parameter promoted through the declaration', () => {
    const node = loaded().getNode('logo-1024')!;
    declareGradientLogo(node);
    expect(node.parameters.find(p => p.name === 'angle')!.promoted).toBe(true);
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
