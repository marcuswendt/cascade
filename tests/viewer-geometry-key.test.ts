/**
 * The viewer's geometry key, which is why moving a parameter on a geometry node
 * changed nothing on screen.
 *
 * Reported against `cascade-logo` on kuro:3031: "none of the parameter changes
 * in dot-scatter, compose-frame, line-repel, line-events seem to have any
 * effect on the output". Those four are exactly the nodes in that graph whose
 * output port carries the core `geometry` type, and the cook chain was fine —
 * a headless `cascade run` with `min_distance` at 180 rather than 26 produces
 * different pixels. What was broken was the viewer's cache key.
 *
 * `Geometry` has no `width`, `height` or `size` property, so the viewer's
 * `valueFingerprint` fell through to its generic object branch and returned the
 * literal string `object:x:` for every geometry ever made. The raster is drawn
 * "once per value", the key said every value was the same value, and the first
 * raster stayed on screen for the rest of the session.
 *
 * The counts are not enough on their own and that is the substance of these
 * tests: `line-repel` and `compose-frame` move points without adding or
 * removing one, so a key made of `pointCount` would have been as constant as
 * the one it replaced.
 */
import { describe, expect, it } from 'vitest';
import { GeometryBuilder } from '../packages/runtime/src/index';
import { geometryRasterKey, hashNumericArray, valueFingerprint } from '@/editor/viewerKeys';

/** The shape `lib/geometry.ts` in cascade-logo builds: polylines, loose dots,
 *  and a `size` detail. `shift` stands in for a parameter change that moves
 *  points and leaves every count alone — which is what line-repel does. */
function logoGeometry(shift: number) {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 100 + shift, 10, 200, 300]);
  builder.addPolygon([10, 400, 120 - shift, 410, 220, 700]);
  builder.addPoint(5, 5);
  builder.addPoint(900, 900);
  builder.setDetail('size', [1024, 1024]);
  return builder.build();
}

describe('the geometry fingerprint', () => {
  it('is not the same string for two different geometries', () => {
    const before = valueFingerprint(logoGeometry(0));
    const after = valueFingerprint(logoGeometry(500));
    // The regression: both of these used to be exactly 'object:x:'.
    expect(before).not.toBe('object:x:');
    expect(after).not.toBe(before);
  });

  it('changes when points move and no count does', () => {
    const before = logoGeometry(0);
    const after = logoGeometry(37);
    expect(after.pointCount).toBe(before.pointCount);
    expect(after.vertexCount).toBe(before.vertexCount);
    expect(after.primitiveCount).toBe(before.primitiveCount);
    expect(valueFingerprint(after)).not.toBe(valueFingerprint(before));
  });

  it('is stable for the same geometry, so an unchanged cook does not redraw', () => {
    expect(valueFingerprint(logoGeometry(12))).toBe(valueFingerprint(logoGeometry(12)));
  });

  it('still reports an image ref by path and size', () => {
    const image = { path: 'renders/render-1024-1024.png', size: [1024, 1024], channels: 'rgba' };
    expect(valueFingerprint(image)).toBe('image:renders/render-1024-1024.png:1024x1024');
  });

  it('keeps the primitive and array cases it already had', () => {
    expect(valueFingerprint(undefined)).toBe('undefined');
    expect(valueFingerprint(null)).toBe('null');
    expect(valueFingerprint(0.028)).toBe('number:0.028');
    expect(valueFingerprint([1, 2, 3])).toBe('array:3');
  });

  it('does not treat an out-of-band geometry path as the geometry itself', () => {
    const ref = {
      kind: 'geometry-file',
      path: 'renders/points.npy',
      format: 'npy',
      pointCount: 7000,
      attribute: { level: 'point', name: 'P' },
    };
    expect(valueFingerprint(ref)).toContain('geometry-file:');
    expect(valueFingerprint(ref)).toContain('7000');
  });
});

describe('the geometry raster key', () => {
  const port = { id: 'line-repel_out_0' };

  it('changes when the geometry changes', () => {
    const key = (value: unknown) =>
      geometryRasterKey({ nodeId: 'line-repel', portId: port.id, kind: 'geometry', value, cookVersion: 1 });
    expect(key(logoGeometry(180))).not.toBe(key(logoGeometry(26)));
  });

  it('changes on a new cook even when the value looks identical', () => {
    // The belt to the fingerprint's braces: a strided hash on a very large
    // attribute can miss, and an .npy path rewritten in place always does.
    const value = logoGeometry(0);
    const first = geometryRasterKey({ nodeId: 'line-repel', portId: port.id, kind: 'geometry', value, cookVersion: 1 });
    const second = geometryRasterKey({ nodeId: 'line-repel', portId: port.id, kind: 'geometry', value, cookVersion: 2 });
    expect(second).not.toBe(first);
  });

  it('is stable within one cook, so the raster is drawn once', () => {
    const value = logoGeometry(0);
    const args = { nodeId: 'line-repel', portId: port.id, kind: 'geometry' as const, value, cookVersion: 4 };
    expect(geometryRasterKey(args)).toBe(geometryRasterKey(args));
  });
});

describe('hashNumericArray', () => {
  it('separates arrays that differ by one value', () => {
    expect(hashNumericArray(new Float64Array([1, 2, 3]))).not.toBe(hashNumericArray(new Float64Array([1, 2, 4])));
  });

  it('separates arrays of different length', () => {
    expect(hashNumericArray(new Float64Array([1, 2]))).not.toBe(hashNumericArray(new Float64Array([1, 2, 0])));
  });

  it('reports an absent or empty attribute rather than throwing', () => {
    expect(hashNumericArray(undefined)).toBe('none');
    expect(hashNumericArray(new Float64Array(0))).toBe('empty');
  });

  it('survives a non-finite value', () => {
    expect(() => hashNumericArray(new Float64Array([NaN, Infinity, 1]))).not.toThrow();
  });
});
