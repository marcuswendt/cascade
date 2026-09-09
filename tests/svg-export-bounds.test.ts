/**
 * An explicit frame, because a derived one cannot animate.
 *
 * `SvgExport` derives its viewBox from the geometry's bounds, which is right
 * for a single export and wrong for a sequence: every frame gets its own
 * viewBox, so a growing drawing appears to zoom out over the animation.
 *
 * Found rendering 110 frames of a particle system on 2026-09-09 — the early
 * frames are sparse, so their bounds are tight, so the first strokes fill the
 * screen and the rest of the sequence pulls away from them. Nothing errored;
 * it read as a camera move nobody asked for.
 */
import { describe, expect, it } from 'vitest';

import { GeometryBuilder } from '../packages/runtime/src/geometry/builder.js';
import { geometryToSvg } from '../packages/runtime/src/geometry/svg.js';

function line(from: [number, number], to: [number, number]) {
  const builder = new GeometryBuilder({ positionSize: 2 });
  const a = builder.addPoint(from[0], from[1]);
  const b = builder.addPoint(to[0], to[1]);
  builder.addPrimitive([a, b], { closed: false, kind: 'poly' });
  return builder.build();
}

function viewBox(svg: string): number[] {
  return /viewBox="([^"]+)"/.exec(svg)![1]!.split(' ').map(Number);
}

describe('the viewBox', () => {
  it('derives from the geometry by default', () => {
    const svg = geometryToSvg(line([0, 0], [10, 20]), {});
    expect(viewBox(svg)).toEqual([0, -20, 10, 20]);
  });

  /** The property a sequence needs: two different drawings, one frame. */
  it('is identical across different drawings when bounds are explicit', () => {
    const options = { bounds: [-50, -50, 50, 50] as const };
    const small = geometryToSvg(line([0, 0], [1, 1]), options);
    const large = geometryToSvg(line([-40, -40], [40, 40]), options);
    expect(viewBox(small)).toEqual(viewBox(large));
    expect(viewBox(small)).toEqual([-50, -50, 100, 100]);
  });

  it('still applies the margin to an explicit frame', () => {
    const svg = geometryToSvg(line([0, 0], [1, 1]), { bounds: [-10, -10, 10, 10], margin: 5 });
    expect(viewBox(svg)).toEqual([-15, -15, 30, 30]);
  });

  /** An explicit frame smaller than the drawing crops rather than growing to
   *  fit: the caller stating a frame is a stronger signal than the content
   *  filling one, and a frame that silently grew would not be a frame. */
  it('crops rather than expanding to contain the drawing', () => {
    const svg = geometryToSvg(line([-100, -100], [100, 100]), { bounds: [-10, -10, 10, 10] });
    expect(viewBox(svg)).toEqual([-10, -10, 20, 20]);
  });
});
