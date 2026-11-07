/**
 * The image library's resolution helpers (`packages/runtime/src/builtins/image/planar.ts`):
 * which input decides an output size, and how an input is fitted to it.
 * Ported with the nodes from `ImageNodeBase`, with the same cases.
 */
import { describe, it, expect } from 'vitest';
import { Planar, resizeToFit, resolveOutputSize } from '../packages/runtime/src/builtins/image/planar.js';

describe('Planar dimensions', () => {
  it.each([
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid dimensions %s x %s', (width, height) => {
    expect(() => Planar.rgba(width, height)).toThrow(/positive safe integers/);
  });
});

describe('resolveOutputSize()', () => {
  it.each([
    ['input', [[800, 600], [400, 300]], [800, 600]],
    ['input1', [[1920, 1080], [640, 480]], [1920, 1080]],
    ['input2', [[800, 600], [1024, 768]], [1024, 768]],
    ['input2', [[800, 600], null], [800, 600]],
    ['largest', [[100, 100], [500, 400], [200, 300]], [500, 400]],
    ['smallest', [[100, 100], [500, 400], [200, 300]], [100, 100]],
    ['input', [null, null], [512, 512]],
  ] as const)('%s of %j is %j', (mode, sizes, expected) => {
    const inputs = sizes.map((size) => (size ? Planar.rgba(size[0], size[1]) : null));
    expect(resolveOutputSize(mode, inputs)).toEqual({ width: expected[0], height: expected[1] });
  });

  it('uses the custom size in custom mode', () => {
    expect(resolveOutputSize('custom', [Planar.rgba(800, 600)], [1280, 720])).toEqual({ width: 1280, height: 720 });
  });
});

describe('resizeToFit()', () => {
  it('returns the source when the size already matches', () => {
    const source = Planar.rgba(100, 100);
    expect(resizeToFit(source, 100, 100, 'fill')).toBe(source);
  });

  it('crops to fill', () => {
    for (const [width, height] of [[200, 100], [100, 200]]) {
      const result = resizeToFit(Planar.rgba(width, height), 100, 100, 'fill');
      expect([result.width, result.height]).toEqual([100, 100]);
    }
  });

  it('letterboxes a wide source and pillarboxes a tall one in black', () => {
    const wide = Planar.solid(200, 100, { r: 1, g: 0, b: 0, a: 1 });
    const boxed = resizeToFit(wide, 100, 100, 'fit');
    expect([boxed.channels[0]![0], boxed.channels[1]![0], boxed.channels[2]![0]]).toEqual([0, 0, 0]);
    expect(boxed.channels[0]![50 * 100 + 50]).toBeGreaterThan(0);
    const tall = resizeToFit(Planar.solid(100, 200, { r: 0, g: 1, b: 0, a: 1 }), 100, 100, 'fit');
    expect([tall.channels[0]![0], tall.channels[1]![0], tall.channels[2]![0]]).toEqual([0, 0, 0]);
  });

  it('stretches to the exact size', () => {
    const result = resizeToFit(Planar.rgba(50, 100), 200, 50, 'stretch');
    expect([result.width, result.height]).toEqual([200, 50]);
  });

  it('centres at 1:1 in native mode', () => {
    const result = resizeToFit(Planar.solid(50, 50, { r: 1, g: 0, b: 0, a: 1 }), 100, 100, 'native');
    expect(result.channels[0]![0]).toBe(0);
    expect(result.channels[0]![50 * 100 + 50]).toBe(1);
    const cropped = resizeToFit(Planar.rgba(200, 200), 100, 100, 'native');
    expect([cropped.width, cropped.height]).toEqual([100, 100]);
  });
});
