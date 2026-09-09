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
import { renderGeometry, renderScene } from '../packages/runtime/src/geometry/render.js';
import { executeRender, renderDefinition } from '../packages/runtime/src/builtins/geo/render.js';
import type { Scene } from '@cascade/contracts';

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

/** The alpha at one pixel. Counting ink cannot tell one stroke from two on top
 *  of each other; the composite is only visible in the channel. */
function alphaAt(surface: any, x: number, y: number): number {
  return surface.getContext('2d').getImageData(x, y, 1, 1).data[3];
}

function sceneOf(geometry: Geometry[], withCamera: Camera | null): Scene {
  return { geometry, camera: withCamera, lights: [] };
}

/**
 * Cook the node itself, not the renderer under it.
 *
 * `hostSurface` reads `OffscreenCanvas` off the global, which is the one host
 * assumption in the node — so the harness supplies it the way a host would
 * rather than the node being changed to make it testable.
 */
async function cook(inputs: Record<string, unknown>): Promise<{
  image: any;
  marks: number;
}> {
  const previous = (globalThis as any).OffscreenCanvas;
  (globalThis as any).OffscreenCanvas = class {
    constructor(width: number, height: number) {
      return createCanvas(width, height) as never;
    }
  };
  try {
    const values: Record<string, any> = {};
    const outputs: Record<string, { set: (value: unknown) => void }> = {};
    for (const name of Object.keys(renderDefinition.outputs))
      outputs[name] = { set: (value) => { values[name] = value; } };
    const props: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(renderDefinition.props))
      props[name] = (prop as { default: unknown }).default;
    props.size = [200, 200];
    let bytes = new Uint8Array(0);
    await executeRender({
      nodeId: 'test',
      inputs: inputs as never,
      outputs: outputs as never,
      props: props as never,
      capabilities: {
        assets: {
          write: async (data: Uint8Array) => {
            bytes = data;
            return { path: '/assets/render.png', mediaType: 'image/png' };
          },
          read: async () => new Uint8Array(0),
        },
      } as never,
      signal: { aborted: false, addEventListener() {}, removeEventListener() {} } as never,
      progress: { report() {} } as never,
    });
    // Marks read back out of the PNG the node actually wrote, so the assertion
    // is about the delivered bytes rather than an intermediate surface.
    return { image: values.image, marks: bytes.length };
  } finally {
    (globalThis as any).OffscreenCanvas = previous;
  }
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

/**
 * The scene half, added 2026-09-09 when `Render` started taking a `scene`.
 *
 * Marcus's reason for the type is what these are checking: *"a 'scene' node
 * with a camera, lights and geometry attached becomes a '3d scene'."* Once the
 * viewport and this node read the same object, they cannot frame a graph two
 * ways — so the assertions are that a scene draws all of its geometry, that the
 * promotion is transparent, and that a camera is still never invented.
 */
describe('rendering a scene', () => {
  it('draws every geometry in the scene, not just the first', () => {
    const one = ink(renderScene([segment([-1, 1, 0], [1, 1, 0])], { camera: camera(), ...options }));
    const both = ink(
      renderScene(
        [segment([-1, 1, 0], [1, 1, 0]), segment([-1, -1, 0], [1, -1, 0])],
        { camera: camera(), ...options },
      ),
    );
    expect(both.count).toBeGreaterThan(one.count * 1.8);
    // Two segments either side of the axis average back onto it. A renderer
    // that drew only the first would put the centroid on the first line, so
    // this is the assertion that actually discriminates.
    // Within a pixel of the frame's centre line; the half-pixel is the pixel
    // centre offset, not a framing error.
    expect(Math.abs(both.y - 100)).toBeLessThan(1);
    expect(one.y).toBeLessThan(90);
  });

  it('composites onto one surface rather than one per geometry', () => {
    // Overlapping strokes at half opacity: drawn onto one surface the overlap
    // is one alpha; composited per geometry it is darker, and the pixel count
    // is identical either way — so the test reads the alpha, not the count.
    const overlapping = renderScene(
      [segment([-1, 0, 0], [1, 0, 0]), segment([-1, 0, 0], [1, 0, 0])],
      { camera: camera(), ...options, opacity: 0.5 },
    );
    const single = renderScene([segment([-1, 0, 0], [1, 0, 0])], {
      camera: camera(), ...options, opacity: 0.5,
    });
    expect(alphaAt(overlapping, 100, 100)).toBeGreaterThan(alphaAt(single, 100, 100));
  });

  it('an empty scene renders an empty frame rather than throwing', () => {
    expect(ink(renderScene([], { camera: camera(), ...options })).count).toBe(0);
  });

  it('renderGeometry is renderScene of one, so the old path is the same code', () => {
    const viaGeometry = ink(renderGeometry(segment([-1, 0, 0], [1, 0, 0]), { camera: camera(), ...options }));
    const viaScene = ink(renderScene([segment([-1, 0, 0], [1, 0, 0])], { camera: camera(), ...options }));
    expect(viaScene).toEqual(viaGeometry);
  });
});

describe('the Render node resolves its camera', () => {
  it('takes the scene\'s camera when no camera is wired', async () => {
    const { image } = await cook({ scene: sceneOf([segment([-1, 0, 0], [1, 0, 0])], camera()) });
    expect(image.size).toEqual([200, 200]);
  });

  it('lets a wired camera override the scene\'s', async () => {
    // A 24 mm lens draws the same segment wider than a 100 mm one. If the
    // override were ignored the two would be identical, which is what makes
    // this the discriminating case rather than a smoke test.
    const scene = sceneOf([segment([-1, 0, 0], [1, 0, 0])], camera({ focal: 100 }));
    const wide = await cook({ scene, camera: camera({ focal: 24 }) });
    const narrow = await cook({ scene });
    expect(wide.marks).toBeGreaterThan(narrow.marks);
  });

  it('refuses to invent a camera, and says what to wire', async () => {
    await expect(cook({ scene: sceneOf([segment([-1, 0, 0], [1, 0, 0])], null) }))
      .rejects.toThrow(/no camera — wire a cascade.core.Camera/);
  });

  it('accepts a bare geometry, because geometry widens to scene', async () => {
    const { marks } = await cook({ scene: segment([-1, 0, 0], [1, 0, 0]), camera: camera() });
    expect(marks).toBeGreaterThan(0);
  });
});
