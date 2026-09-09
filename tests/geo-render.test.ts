/**
 * `cascade.geo.Render` — the 3D-to-2D half of `PLAN viewport.md`.
 *
 * The plan's central rule is what these tests are really about: **a scene view
 * and a render node must agree, and the only way to guarantee that is both
 * going through `packages/runtime/src/camera`.** So the assertions are about
 * the camera's conventions showing up in pixels — a point in front of the
 * camera landing where the camera module says it should, and one behind it not
 * being drawn at all.
 *
 * Cooked through the neutral runtime, which is also the argument for building
 * the CPU path first: this gets real tests rather than screenshots.
 */
import { describe, expect, it } from 'vitest';

import { CAMERA_DEFAULTS, type Camera, type Geometry } from '@cascade/contracts';
import { createCanvas } from '@napi-rs/canvas';

import { GeometryBuilder } from '../packages/runtime/src/geometry/builder.js';
import { renderGeometry } from '../packages/runtime/src/geometry/render.js';

/**
 * The surface, injected. This is the payoff from the renderer taking a factory
 * rather than reaching for `OffscreenCanvas`: the first version did, and node
 * has no such global, so the whole file failed with "OffscreenCanvas is not
 * defined" — a renderer that can only be tested in a browser is the thing
 * `PLAN viewport` argues against building.
 */
const surface = (width: number, height: number) =>
  createCanvas(width, height) as unknown as never;

function camera(over: Partial<Camera> = {}): Camera {
  return { ...CAMERA_DEFAULTS, translate: [0, 0, 5], resolution: [200, 200], ...over };
}

/** A single segment between two world points. */
function segment(from: [number, number, number], to: [number, number, number]): Geometry {
  const builder = new GeometryBuilder({ positionSize: 3 });
  const a = builder.addPoint(...from);
  const b = builder.addPoint(...to);
  builder.addPrimitive([a, b], { closed: false, kind: 'poly' });
  return builder.build();
}

const options = {
  surface,
  size: [200, 200] as const,
  stroke: [1, 1, 1, 1] as never,
  strokeWidth: 2,
  opacity: 1,
  pointRadius: 2,
  drawPoints: false,
};

/** Non-transparent pixels, as a count and a centroid. Reading the raster is
 *  the only honest way to test a renderer. */
function ink(surface: any): { count: number; x: number; y: number } {
  const context = surface.getContext('2d');
  const data = context.getImageData(0, 0, surface.width, surface.height).data;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const pixel = index / 4;
    count += 1;
    sumX += pixel % surface.width;
    sumY += Math.floor(pixel / surface.width);
  }
  return count === 0
    ? { count: 0, x: NaN, y: NaN }
    : { count, x: sumX / count, y: sumY / count };
}

describe('rendering through a camera', () => {
  it('draws a segment in front of the camera', () => {
    const marks = ink(renderGeometry(segment([-1, 0, 0], [1, 0, 0]), { camera: camera(), ...options }));
    expect(marks.count).toBeGreaterThan(0);
  });

  /** A horizontal segment through the origin lands across the middle: the
   *  camera looks down its own -Z from +Z, which is the convention the camera
   *  module owns. */
  it('puts world origin at the centre of the frame', () => {
    const marks = ink(renderGeometry(segment([-1, 0, 0], [1, 0, 0]), { camera: camera(), ...options }));
    // Within a pixel, stated as a pixel rather than through toBeCloseTo's
    // digit semantics: the centre of a 200-pixel span is 100.0 in continuous
    // coordinates, so the ink centroid across symmetric pixels 99 and 100 is
    // 99.5 — correct, and outside `toBeCloseTo(100, 0)` by exactly nothing.
    expect(Math.abs(marks.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(marks.y - 100)).toBeLessThanOrEqual(1);
  });

  /** +Y is up in the world and rows run down the raster, so a segment above
   *  the origin draws in the upper half. Getting this backwards flips every
   *  render vertically and looks plausible. */
  it('draws +Y above the centre', () => {
    const marks = ink(renderGeometry(segment([-1, 1, 0], [1, 1, 0]), { camera: camera(), ...options }));
    expect(marks.y).toBeLessThan(100);
  });

  it('draws +X to the right of centre', () => {
    const marks = ink(renderGeometry(segment([1, -1, 0], [1, 1, 0]), { camera: camera(), ...options }));
    expect(marks.x).toBeGreaterThan(100);
  });

  /**
   * The clipping case, and the one that would otherwise look like a real line.
   * A vertex behind the camera has a negative clip w, and dividing by it
   * mirrors the point — so a segment from an on-screen vertex to one behind the
   * camera draws as a plausible stroke to the wrong place. It has to be
   * dropped rather than drawn.
   */
  it('draws nothing for geometry entirely behind the camera', () => {
    const behind = segment([-1, 0, 20], [1, 0, 20]);
    expect(ink(renderGeometry(behind, { camera: camera(), ...options })).count).toBe(0);
  });

  it('breaks a run rather than drawing across the camera plane', () => {
    // One vertex in front, one well behind. Neither a full line nor a mirrored
    // one: the run breaks, so nothing is drawn between them.
    const straddling = segment([0, 0, 0], [0, 0, 20]);
    expect(ink(renderGeometry(straddling, { camera: camera(), ...options })).count).toBe(0);
  });

  /** A longer lens magnifies, which is the lens model rather than a zoom
   *  parameter — the camera module derives the angle from focal and aperture. */
  it('magnifies with a longer focal length', () => {
    const short = ink(renderGeometry(segment([-1, 0, 0], [1, 0, 0]), { camera: camera({ focal: 24 }), ...options }));
    const long = ink(renderGeometry(segment([-1, 0, 0], [1, 0, 0]), { camera: camera({ focal: 100 }), ...options }));
    expect(long.count).toBeGreaterThan(short.count);
  });

  it('fills the background when one is asked for', () => {
    const surface = renderGeometry(segment([-1, 0, 0], [1, 0, 0]), {
      camera: camera(), ...options, background: [0, 0, 0, 1] as never,
    });
    // Every pixel opaque, because the ground covers the frame.
    expect(ink(surface).count).toBe(200 * 200);
  });

  /** Loose points are off by default: a trail system has thousands of vertices
   *  and a dot on every one buries the strokes. */
  it('draws loose points only when asked', () => {
    const builder = new GeometryBuilder({ positionSize: 3 });
    builder.addPoint(0, 0, 0);
    const cloud = builder.build();

    expect(ink(renderGeometry(cloud, { camera: camera(), ...options })).count).toBe(0);
    expect(ink(renderGeometry(cloud, { camera: camera(), ...options, drawPoints: true })).count)
      .toBeGreaterThan(0);
  });

  /** Refused rather than read as a colour with a missing channel. PLAN
   *  geometry's rule, and SvgExport already enforces it — a renderer that was
   *  laxer would draw what the exporter refuses. */
  it('refuses a primitive Cd that is not four components', () => {
    const builder = new GeometryBuilder({ positionSize: 3 });
    const a = builder.addPoint(-1, 0, 0);
    const b = builder.addPoint(1, 0, 0);
    builder.addPrimitive([a, b], { closed: false, kind: 'poly' });
    builder.setNumericAttribute('primitive', 'Cd', new Float32Array([1, 0, 0]), 3, 'f32');

    expect(() => renderGeometry(builder.build(), { camera: camera(), ...options }))
      .toThrow(/primitive.Cd has size 3/);
  });
});
