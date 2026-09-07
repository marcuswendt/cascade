/**
 * Frame-range evaluation: the loop over setFrame / markTimeDependentDirty / cook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CascadeContext } from '@/engine/cascade';
import { evaluateFrameRange } from '@/engine/animation/frameRange';
import { frameRange, runFrameRange } from '../packages/runtime/src/animation/index.js';
import type { FrameClock, FrameInfo } from '../packages/runtime/src/animation/index.js';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('frameRange()', () => {
  it('is inclusive of both ends', () => {
    expect(frameRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('honours a step', () => {
    expect(frameRange(1, 9, 2)).toEqual([1, 3, 5, 7, 9]);
  });

  it('stops before overshooting the end', () => {
    expect(frameRange(1, 8, 3)).toEqual([1, 4, 7]);
  });

  it('supports a fractional step without drift', () => {
    const frames = frameRange(1, 3, 0.5);
    expect(frames).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('yields a single frame when start equals end', () => {
    expect(frameRange(7, 7)).toEqual([7]);
  });

  it('rejects a non-positive step', () => {
    expect(() => frameRange(1, 5, 0)).toThrow(/step/);
    expect(() => frameRange(1, 5, -1)).toThrow(/step/);
  });

  it('rejects an end before the start', () => {
    expect(() => frameRange(10, 5)).toThrow(/before start/);
  });
});

describe('runFrameRange()', () => {
  let clock: FrameClock & { dirtyCalls: number; setCalls: number[] };

  beforeEach(() => {
    let current = 1;
    const fps = 25;
    clock = {
      dirtyCalls: 0,
      setCalls: [],
      setFrame(frame: number) {
        current = frame;
        clock.setCalls.push(frame);
      },
      markTimeDependentDirty() {
        clock.dirtyCalls += 1;
      },
      getFrame: () => Math.floor(current),
      getFrameFraction: () => current,
      getTime: () => current / fps,
      getFps: () => fps
    };
  });

  it('calls back once per frame with the right frame numbers', async () => {
    const seen: number[] = [];
    const result = await runFrameRange(clock, {
      start: 10,
      end: 14,
      onFrame: (info) => { seen.push(info.frame); }
    });

    expect(seen).toEqual([10, 11, 12, 13, 14]);
    expect(result.frameCount).toBe(5);
    expect(result.frames).toEqual([10, 11, 12, 13, 14]);
    expect(result.aborted).toBe(false);
  });

  it('marks time-dependent nodes dirty once per frame', async () => {
    await runFrameRange(clock, {
      start: 1,
      end: 4,
      restoreFrame: false,
      onFrame: () => {}
    });
    expect(clock.dirtyCalls).toBe(4);
  });

  it('reports index, total, fractional frame, time and fps', async () => {
    const infos: FrameInfo[] = [];
    await runFrameRange(clock, {
      start: 1,
      end: 2,
      step: 0.5,
      onFrame: (info) => { infos.push(info); }
    });

    expect(infos.map(i => i.index)).toEqual([0, 1, 2]);
    expect(infos.every(i => i.total === 3)).toBe(true);
    expect(infos.map(i => i.fframe)).toEqual([1, 1.5, 2]);
    expect(infos.map(i => i.frame)).toEqual([1, 1, 2]);
    expect(infos[1].time).toBeCloseTo(1.5 / 25, 10);
    expect(infos[0].fps).toBe(25);
  });

  it('awaits an async callback before advancing', async () => {
    const order: string[] = [];
    await runFrameRange(clock, {
      start: 1,
      end: 3,
      onFrame: async (info) => {
        order.push(`start ${info.frame}`);
        await Promise.resolve();
        order.push(`end ${info.frame}`);
      }
    });

    expect(order).toEqual([
      'start 1', 'end 1',
      'start 2', 'end 2',
      'start 3', 'end 3'
    ]);
  });

  it('stops on an aborted signal and says so', async () => {
    const signal = { aborted: false };
    const seen: number[] = [];

    const result = await runFrameRange(clock, {
      start: 1,
      end: 100,
      signal,
      onFrame: (info) => {
        seen.push(info.frame);
        if (info.frame === 3) signal.aborted = true;
      }
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(result.aborted).toBe(true);
    expect(result.frameCount).toBe(3);
  });

  it('restores the previous frame by default', async () => {
    clock.setFrame(42);
    await runFrameRange(clock, { start: 1, end: 3, onFrame: () => {} });
    expect(clock.getFrameFraction()).toBe(42);
  });

  it('leaves the frame where the range ended when asked', async () => {
    await runFrameRange(clock, { start: 1, end: 3, restoreFrame: false, onFrame: () => {} });
    expect(clock.getFrameFraction()).toBe(3);
  });

  it('restores the frame even when the callback throws', async () => {
    clock.setFrame(7);
    await expect(runFrameRange(clock, {
      start: 1,
      end: 3,
      onFrame: () => { throw new Error('cook failed'); }
    })).rejects.toThrow('cook failed');
    expect(clock.getFrameFraction()).toBe(7);
  });
});

describe('evaluateFrameRange() against the Cascade context', () => {
  let context: CascadeContext;
  let graph: Graph;
  let animated: Node;
  let still: Node;

  beforeEach(() => {
    context = new CascadeContext();
    graph = new Graph();
    context.setGraph(graph);

    animated = new Node('animated', 'Test', graph);
    graph.addElement(animated);
    animated.props.angle = { name: 'angle', type: 'number', value: 0 };
    animated.parm('angle')?.setExpression('$T * 40');

    still = new Node('still', 'Test', graph);
    graph.addElement(still);
    still.props.angle = { name: 'angle', type: 'number', value: 0 };
  });

  it('detects the animated node as time-dependent', () => {
    expect(animated.isTimeDependent).toBe(true);
    expect(still.isTimeDependent).toBe(false);
    expect(context.getTimeDependentNodes().map(n => n.id)).toEqual(['animated']);
  });

  it('walks the range and reports each frame', async () => {
    const seen: number[] = [];
    const result = await evaluateFrameRange({
      context,
      start: 1,
      end: 5,
      fps: 25,
      onFrame: (info) => { seen.push(info.frame); }
    });

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(result.frameCount).toBe(5);
  });

  it('re-evaluates a $T expression per frame', async () => {
    const values: number[] = [];
    await evaluateFrameRange({
      context,
      start: 1,
      end: 4,
      fps: 10,
      onFrame: () => {
        values.push(animated.evaluateExpression('angle') as number);
      }
    });

    // $T = (frame - 1) / fps, so angle = (frame - 1) * 4 at 10fps and the
    // first frame is genuinely zero.
    expect(values).toEqual([0, 4, 8, 12]);
  });

  it('drives sub-frame time with a fractional step', async () => {
    const frames: number[] = [];
    await evaluateFrameRange({
      context,
      start: 1,
      end: 2,
      step: 0.25,
      fps: 25,
      onFrame: (info) => { frames.push(info.fframe); }
    });

    expect(frames).toEqual([1, 1.25, 1.5, 1.75, 2]);
  });

  it('restores the frame and the rate afterwards', async () => {
    context.setFps(30);
    context.setFrame(12);

    await evaluateFrameRange({
      context,
      start: 100,
      end: 103,
      fps: 25,
      onFrame: () => {}
    });

    expect(context.frame()).toBe(12);
    expect(context.fps()).toBe(30);
  });
});

describe('CascadeContext fractional frames', () => {
  let context: CascadeContext;

  beforeEach(() => {
    context = new CascadeContext();
  });

  it('keeps the fraction while frame() stays an integer', () => {
    context.setFrame(30.7);
    expect(context.frame()).toBe(30);
    expect(context.fframe()).toBeCloseTo(30.7, 10);
  });

  it('keeps sub-frame time through setTime', () => {
    context.setFps(30);
    context.setTime(0.51); // 15.3 frames past the first, so frame 16.3
    expect(context.frame()).toBe(16);
    expect(context.fframe()).toBeCloseTo(16.3, 10);
    expect(context.time()).toBeCloseTo(0.51, 10);
  });

  it('advances by a fractional step through nextFrame()', () => {
    context.setFrame(1);
    expect(context.nextFrame(0.5)).toBeCloseTo(1.5, 10);
    expect(context.frame()).toBe(1);
    expect(context.nextFrame(0.5)).toBeCloseTo(2, 10);
    expect(context.frame()).toBe(2);
  });

  it('still clamps to frame 1', () => {
    context.setFrame(0.25);
    expect(context.fframe()).toBe(1);
  });
});
