/**
 * Keyframe channels: sampling, the third branch in evalParm, time dependence
 * and the serialised shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_INTERPOLATION,
  createChannel,
  deleteKey,
  deserializeChannel,
  isEmptyChannel,
  sampleChannel,
  serializeChannel,
  setKey
} from '../packages/runtime/src/animation/index.js';
import { expressionEngine } from '@/engine/expressions/index';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Channel construction', () => {
  it('sorts unordered keys by frame', () => {
    const channel = createChannel([
      { frame: 20, value: 2 },
      { frame: 1, value: 0 },
      { frame: 10, value: 1 }
    ]);
    expect(channel.keys.map(k => k.frame)).toEqual([1, 10, 20]);
  });

  it('defaults interpolation to smooth', () => {
    const channel = createChannel([{ frame: 1, value: 0 }]);
    expect(channel.keys[0].interpolation).toBe(DEFAULT_INTERPOLATION);
    expect(DEFAULT_INTERPOLATION).toBe('smooth');
  });

  it('keeps the last key when two land on the same frame', () => {
    const channel = createChannel([
      { frame: 5, value: 1 },
      { frame: 5, value: 9 }
    ]);
    expect(channel.keys).toHaveLength(1);
    expect(channel.keys[0].value).toBe(9);
  });

  it('drops keys that are not finite rather than poisoning the curve', () => {
    const channel = createChannel([
      { frame: 1, value: 0 },
      { frame: Number.NaN, value: 5 },
      { frame: 10, value: Number.POSITIVE_INFINITY }
    ]);
    expect(channel.keys).toHaveLength(1);
  });

  it('re-keying a frame keeps that key\'s interpolation unless told otherwise', () => {
    let channel = setKey(null, 4, 1, 'linear');
    channel = setKey(channel, 4, 7);
    expect(channel.keys[0].value).toBe(7);
    expect(channel.keys[0].interpolation).toBe('linear');
  });

  it('deleting the last key leaves an empty channel', () => {
    const channel = deleteKey(setKey(null, 3, 1), 3);
    expect(isEmptyChannel(channel)).toBe(true);
  });
});

describe('Sampling', () => {
  it('returns undefined with no keys, so the raw value still applies', () => {
    expect(sampleChannel(createChannel([]), 5)).toBeUndefined();
  });

  it('holds a single key everywhere', () => {
    const channel = createChannel([{ frame: 10, value: 3 }]);
    expect(sampleChannel(channel, -100)).toBe(3);
    expect(sampleChannel(channel, 10)).toBe(3);
    expect(sampleChannel(channel, 1000)).toBe(3);
  });

  it('holds the end values outside the range rather than extrapolating', () => {
    const channel = createChannel([
      { frame: 10, value: 0, interpolation: 'linear' },
      { frame: 20, value: 10, interpolation: 'linear' }
    ]);
    expect(sampleChannel(channel, 0)).toBe(0);
    expect(sampleChannel(channel, 99)).toBe(10);
  });

  it('returns exact key values at the keys, in every mode', () => {
    for (const interpolation of ['constant', 'linear', 'smooth'] as const) {
      const channel = createChannel([
        { frame: 1, value: 5, interpolation },
        { frame: 11, value: 25, interpolation },
        { frame: 21, value: -5, interpolation }
      ]);
      expect(sampleChannel(channel, 1)).toBeCloseTo(5, 10);
      expect(sampleChannel(channel, 11)).toBeCloseTo(25, 10);
      expect(sampleChannel(channel, 21)).toBeCloseTo(-5, 10);
    }
  });

  describe('constant', () => {
    it('holds the left value until the next key', () => {
      const channel = createChannel([
        { frame: 1, value: 0, interpolation: 'constant' },
        { frame: 11, value: 100, interpolation: 'constant' }
      ]);
      expect(sampleChannel(channel, 1.5)).toBe(0);
      expect(sampleChannel(channel, 10.999)).toBe(0);
      expect(sampleChannel(channel, 11)).toBe(100);
    });
  });

  describe('linear', () => {
    it('interpolates in a straight line, fractional frames included', () => {
      const channel = createChannel([
        { frame: 0, value: 0, interpolation: 'linear' },
        { frame: 10, value: 100, interpolation: 'linear' }
      ]);
      expect(sampleChannel(channel, 2.5)).toBeCloseTo(25, 10);
      expect(sampleChannel(channel, 5)).toBeCloseTo(50, 10);
      expect(sampleChannel(channel, 7.25)).toBeCloseTo(72.5, 10);
    });
  });

  describe('smooth', () => {
    it('eases in and out across a two-key channel', () => {
      const channel = createChannel([
        { frame: 0, value: 0 },
        { frame: 10, value: 100 }
      ]);
      // Symmetric about the midpoint, and slower than linear at both ends.
      expect(sampleChannel(channel, 5)).toBeCloseTo(50, 10);
      expect(sampleChannel(channel, 1)!).toBeLessThan(10);
      expect(sampleChannel(channel, 9)!).toBeGreaterThan(90);
    });

    it('stays inside the range of a monotonic two-key segment', () => {
      const channel = createChannel([
        { frame: 0, value: 0 },
        { frame: 10, value: 100 }
      ]);
      for (let f = 0; f <= 10; f += 0.25) {
        const v = sampleChannel(channel, f)!;
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(100 + 1e-9);
      }
    });

    it('passes through a middle key with continuous velocity', () => {
      const channel = createChannel([
        { frame: 0, value: 0 },
        { frame: 10, value: 10 },
        { frame: 20, value: 20 }
      ]);
      const eps = 1e-4;
      const before = (sampleChannel(channel, 10)! - sampleChannel(channel, 10 - eps)!) / eps;
      const after = (sampleChannel(channel, 10 + eps)! - sampleChannel(channel, 10)!) / eps;
      expect(after).toBeCloseTo(before, 3);
      // Evenly spaced, evenly valued keys make the middle tangent the slope.
      expect(before).toBeCloseTo(1, 3);
    });

    it('is not the same curve as linear between the same keys', () => {
      const keys = [{ frame: 0, value: 0 }, { frame: 10, value: 100 }];
      const smooth = createChannel(keys);
      const linear = createChannel(keys.map(k => ({ ...k, interpolation: 'linear' as const })));
      expect(sampleChannel(smooth, 2)).not.toBeCloseTo(sampleChannel(linear, 2)!, 3);
    });

    it('leaves a constant neighbour level rather than bulging to reach it', () => {
      const channel = createChannel([
        { frame: 0, value: 0, interpolation: 'constant' },
        { frame: 10, value: 10, interpolation: 'smooth' },
        { frame: 20, value: 20, interpolation: 'smooth' }
      ]);
      // The smooth segment starts flat because the hold arrives flat.
      const eps = 1e-4;
      const slopeAtStart = (sampleChannel(channel, 10 + eps)! - sampleChannel(channel, 10)!) / eps;
      expect(slopeAtStart).toBeCloseTo(0, 3);
    });
  });
});

describe('evalParm', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('n1', 'Test', graph);
    graph.addElement(node);
    node.props.angle = { value: 0 };
    expressionEngine.setGraph(graph);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });

  it('returns the raw value while the parameter is unkeyed', () => {
    node.props.angle.value = 7;
    expect(node.evalParm('angle')).toBe(7);
  });

  it('returns the sampled value once the parameter is keyed', () => {
    const parm = node.parm('angle')!;
    parm.setKey(1, 0, 'linear');
    parm.setKey(11, 100, 'linear');

    expressionEngine.setFrame(1);
    expect(node.evalParm('angle')).toBeCloseTo(0, 10);
    expressionEngine.setFrame(6);
    expect(node.evalParm('angle')).toBeCloseTo(50, 10);
    expressionEngine.setFrame(11);
    expect(node.evalParm('angle')).toBeCloseTo(100, 10);
  });

  it('samples fractional frames', () => {
    const parm = node.parm('angle')!;
    parm.setKey(1, 0, 'linear');
    parm.setKey(11, 100, 'linear');
    expressionEngine.setFrame(3.5);
    expect(node.evalParm('angle')).toBeCloseTo(25, 10);
  });

  it('keys at the current frame and current value when told neither', () => {
    node.props.angle.value = 42;
    expressionEngine.setFrame(9);
    node.parm('angle')!.setKey();

    const keys = node.parm('angle')!.keys();
    expect(keys).toHaveLength(1);
    expect(keys[0].frame).toBe(9);
    expect(keys[0].value).toBe(42);
  });

  it('falls back to the raw value when the channel is cleared', () => {
    node.props.angle.value = 7;
    const parm = node.parm('angle')!;
    parm.setKey(1, 99);
    expect(node.evalParm('angle')).toBe(99);
    parm.clearChannel();
    expect(parm.hasChannel()).toBe(false);
    expect(node.evalParm('angle')).toBe(7);
  });
});

describe('Channel and expression on the same parameter', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('n1', 'Test', graph);
    graph.addElement(node);
    node.props.angle = { value: 0 };
    expressionEngine.setGraph(graph);
    expressionEngine.setFps(25);
    expressionEngine.setFrame(1);
  });

  it('lets the channel win', () => {
    const parm = node.parm('angle')!;
    parm.setExpression('123');
    parm.setKey(1, 5);
    expect(node.evalParm('angle')).toBe(5);
  });

  it('keeps the expression inert rather than discarding it', () => {
    const parm = node.parm('angle')!;
    parm.setExpression('123');
    parm.setKey(1, 5);
    expect(parm.hasExpression()).toBe(true);
    expect(parm.expression()).toBe('123');
  });

  it('gives the expression back when the channel is deleted', () => {
    const parm = node.parm('angle')!;
    parm.setExpression('123');
    parm.setKey(1, 5);
    parm.clearChannel();
    expect(node.evalParm('angle')).toBe(123);
  });
});

describe('Time dependence', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('n1', 'Test', graph);
    graph.addElement(node);
    node.props.angle = { value: 0 };
    expressionEngine.setGraph(graph);
  });

  it('is false for an unkeyed parameter', () => {
    expect(node.isTimeDependent).toBe(false);
  });

  it('becomes true the moment a parameter is keyed', () => {
    node.parm('angle')!.setKey(1, 0);
    expect(node.isTimeDependent).toBe(true);
  });

  it('is true for a single key too — the value is still a function of frame', () => {
    node.parm('angle')!.setKey(5, 3);
    expect(node.parm('angle')!.keys()).toHaveLength(1);
    expect(node.isTimeDependent).toBe(true);
  });

  it('goes false again when the last key is removed', () => {
    const parm = node.parm('angle')!;
    parm.setKey(1, 0);
    parm.deleteKey(1);
    expect(node.isTimeDependent).toBe(false);
  });

  it('stays true while a time expression remains on another parameter', () => {
    node.props.radius = { value: 1 };
    node.parm('radius')!.setExpression('$T');
    node.parm('angle')!.setKey(1, 0);
    node.parm('angle')!.clearChannel();
    expect(node.isTimeDependent).toBe(true);
  });
});

describe('Serialisation', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('n1', 'Test', graph);
    graph.addElement(node);
    node.props.angle = { value: 0 };
    expressionEngine.setGraph(graph);
  });

  it('omits interpolation when it is the default', () => {
    const channel = createChannel([{ frame: 1, value: 0 }]);
    expect(serializeChannel(channel)).toEqual({ keys: [{ frame: 1, value: 0 }] });
  });

  it('writes interpolation when it is not', () => {
    const channel = createChannel([{ frame: 1, value: 0, interpolation: 'constant' }]);
    expect(serializeChannel(channel)).toEqual({
      keys: [{ frame: 1, value: 0, interpolation: 'constant' }]
    });
  });

  it('writes nothing at all for an empty channel', () => {
    expect(serializeChannel(createChannel([]))).toBeUndefined();
  });

  it('leaves an unkeyed, unexpressioned prop as a bare value', () => {
    expect(node.serializePropValue('angle', 5)).toBe(5);
  });

  it('writes the object form for a keyed prop', () => {
    node.parm('angle')!.setKey(1, 0, 'linear');
    expect(node.serializePropValue('angle', 0)).toEqual({
      value: 0,
      channel: { keys: [{ frame: 1, value: 0, interpolation: 'linear' }] }
    });
  });

  it('writes expression and channel together when a prop has both', () => {
    node.parm('angle')!.setExpression('$T');
    node.parm('angle')!.setKey(1, 0);
    expect(node.serializePropValue('angle', 0)).toEqual({
      value: 0,
      expression: '$T',
      channel: { keys: [{ frame: 1, value: 0 }] }
    });
  });

  it('round-trips through JSON with the curve unchanged', () => {
    const parm = node.parm('angle')!;
    parm.setKey(1, 0, 'linear');
    parm.setKey(11, 100);
    parm.setKey(21, 50, 'constant');

    const written = JSON.parse(JSON.stringify(node.serializePropValue('angle', 0)));

    const reloaded = new Node('n2', 'Test', graph);
    graph.addElement(reloaded);
    reloaded.props.angle = { value: written.value };
    reloaded.restorePropChannel('angle', written.channel);

    expect(reloaded.parm('angle')!.keys()).toEqual(parm.keys());
    expect(reloaded.isTimeDependent).toBe(true);
    for (let f = 0; f <= 25; f += 0.5) {
      expect(sampleChannel(reloaded.props.angle.channel!, f))
        .toBeCloseTo(sampleChannel(node.props.angle.channel!, f)!, 10);
    }
  });

  it('normalises unordered and duplicated keys on the way in', () => {
    const channel = deserializeChannel({
      keys: [{ frame: 9, value: 2 }, { frame: 1, value: 0 }, { frame: 9, value: 3 }]
    });
    expect(channel.keys.map(k => [k.frame, k.value])).toEqual([[1, 0], [9, 3]]);
  });

  it('survives a malformed channel rather than failing the load', () => {
    expect(deserializeChannel(null).keys).toEqual([]);
    expect(deserializeChannel({ keys: 'nope' }).keys).toEqual([]);
    node.restorePropChannel('angle', { keys: 'nope' });
    expect(node.parm('angle')!.hasChannel()).toBe(false);
  });
});
