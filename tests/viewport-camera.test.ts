/**
 * The Viewer's 3D mode — the camera state, the gestures and the grid.
 *
 * These are the tests that can exist without a browser, and they are the ones
 * that matter: the failures worth catching here are a gesture that moves the
 * wrong way and a view that disagrees with the projection, both of which are
 * arithmetic. What is left for the eye is whether the picture looks right.
 *
 * The recurring lesson of this session is in the choice of inputs: **agreement
 * is not evidence when the discriminating case is absent.** A camera at yaw and
 * pitch zero agrees with every rotation order and every sign convention, so
 * nothing below is tested only at zero.
 */
import { describe, expect, it } from 'vitest';

import { cameraBasis, projectionMatrix, viewMatrix } from '../packages/runtime/src/camera/index.js';
import { GeometryBuilder } from '../packages/runtime/src/geometry/builder.js';
import { sceneDimensionality } from '../packages/runtime/src/scene/index.js';
import {
  FRONT,
  THREE_QUARTER,
  defaultView,
  dolly,
  frameBounds,
  orbitOffset,
  standardView,
  toggleProjection,
  track,
  tumble,
  viewCameraFor,
  worldPerPixel,
  zoomLens,
} from '../src/editor/viewport/viewCamera';
import { gridGeometry, gridPlaneFor, gridSpacing } from '../src/editor/viewport/grid';

const SIZE = [800, 600] as const;

describe('the view camera', () => {
  it('places the camera so it looks back at the pivot', () => {
    // The discriminating case: a yaw AND a pitch, both non-zero. At zero the
    // offset is [0,0,d] whatever the signs are, which is how a rotation order
    // was got wrong twice on this project.
    const view = { ...defaultView(false), pivot: [1, 2, 3] as const, distance: 10 };
    const camera = viewCameraFor(view, SIZE);
    const { forward, eye } = cameraBasis(camera);
    // Eye plus forward times distance lands on the pivot, to floating error.
    for (const axis of [0, 1, 2])
      expect(eye[axis] + forward[axis] * view.distance).toBeCloseTo(view.pivot[axis], 6);
  });

  it('the three-quarter view looks down and from the right', () => {
    const offset = orbitOffset(THREE_QUARTER.yaw, THREE_QUARTER.pitch, 10);
    expect(offset[0]).toBeGreaterThan(0); // from +X
    expect(offset[1]).toBeGreaterThan(0); // from above
    expect(offset[2]).toBeGreaterThan(0); // from +Z, in front
  });

  it('the front view looks straight down -Z with +Y up', () => {
    const camera = viewCameraFor({ ...defaultView(true), ...FRONT }, SIZE);
    const { forward, up } = cameraBasis(camera);
    expect(forward[2]).toBeCloseTo(-1, 6);
    expect(up[1]).toBeCloseTo(1, 6);
  });

  it('tracking moves the pivot along the camera axes, not the world ones', () => {
    // At a yaw of 90 the camera's right is world -Z, so a horizontal drag must
    // move the pivot in Z and leave X alone. Tested at 90 rather than 0 because
    // at 0 a world-axis implementation gives the same answer.
    const view = { ...defaultView(false), yaw: 90, pitch: 0 };
    const moved = track(view, 100, 0, SIZE);
    expect(Math.abs(moved.pivot[2] - view.pivot[2])).toBeGreaterThan(0);
    expect(moved.pivot[0]).toBeCloseTo(view.pivot[0], 6);
  });

  it('tracking follows the tilt in Z once the view is pitched', () => {
    // The sign this catches was wrong on the first pass, and it is invisible at
    // pitch zero because the term carries a sin(pitch) factor.
    const view = { ...defaultView(false), yaw: 0, pitch: -30 };
    const moved = track(view, 0, 100, SIZE);
    // Dragging down with the view pitched down from above moves the pivot
    // towards the camera in Z as well as up in Y.
    expect(moved.pivot[1]).toBeGreaterThan(view.pivot[1]);
    expect(moved.pivot[2]).toBeLessThan(view.pivot[2]);
  });

  it('tracking moves a fixed number of world units per pixel', () => {
    const view = { ...defaultView(true), orthoWidth: 8 };
    const moved = track(view, 80, 0, [800, 600]);
    // 80 pixels of an 800-pixel frame across an 8-unit frame is 0.8 units.
    expect(Math.abs(moved.pivot[0] - view.pivot[0])).toBeCloseTo(0.8, 6);
  });

  it('dollying is multiplicative, so one notch is one proportion at any scale', () => {
    const near = dolly({ ...defaultView(false), distance: 1 }, 1);
    const far = dolly({ ...defaultView(false), distance: 1000 }, 1);
    expect(near.distance / 1).toBeCloseTo(far.distance / 1000, 6);
  });

  it('dollying never reaches zero distance', () => {
    let view = defaultView(false);
    for (let index = 0; index < 500; index += 1) view = dolly(view, -10);
    expect(view.distance).toBeGreaterThan(0);
    expect(Number.isFinite(worldPerPixel(view, SIZE))).toBe(true);
  });

  it('zoom changes the lens and nothing else — Houdini\'s sense of the word', () => {
    const view = defaultView(false);
    const zoomed = zoomLens(view, 3);
    expect(zoomed.focal).not.toBeCloseTo(view.focal, 3);
    expect(zoomed.distance).toBe(view.distance);
    expect(zoomed.pivot).toEqual(view.pivot);
  });

  it('zoom stays inside real focal lengths', () => {
    let view = defaultView(false);
    for (let index = 0; index < 200; index += 1) view = zoomLens(view, 10);
    expect(view.focal).toBeLessThanOrEqual(600);
    for (let index = 0; index < 400; index += 1) view = zoomLens(view, -10);
    expect(view.focal).toBeGreaterThanOrEqual(4);
  });

  it('tumbling keeps the view upright rather than rolling past the pole', () => {
    let view = defaultView(false);
    for (let index = 0; index < 100; index += 1) view = tumble(view, 0, 100);
    expect(Math.abs(view.pitch)).toBeLessThan(90);
    const { up } = cameraBasis(viewCameraFor(view, SIZE));
    // Upright means the up vector still has a positive Y component. A view that
    // rolled over the pole would have flipped it.
    expect(up[1]).toBeGreaterThan(0);
  });
});

describe('the projection toggle', () => {
  it('keeps the picture the same size across a toggle', () => {
    const view = { ...defaultView(false), distance: 12 };
    const ortho = toggleProjection(view);
    expect(ortho.ortho).toBe(true);
    // The orthographic frame matches the perspective frame at the pivot, so
    // the drawing does not jump. Derived from nothing it would.
    expect(ortho.orthoWidth).toBeCloseTo((12 * 41.4214) / 50, 6);
  });

  it('round-trips back to where it started', () => {
    const view = { ...defaultView(false), distance: 7.5 };
    const back = toggleProjection(toggleProjection(view));
    expect(back.ortho).toBe(false);
    expect(back.distance).toBeCloseTo(view.distance, 6);
  });

  it('an orthographic camera produces a w of one, so nothing is clipped by the divide', () => {
    const camera = viewCameraFor({ ...defaultView(true), orthoWidth: 4 }, SIZE);
    const projection = projectionMatrix(camera);
    // Column-major: the last row's w term. A perspective matrix carries -1 in
    // element 11 and 0 here; an orthographic one is the other way round.
    expect(projection[15]).toBe(1);
  });
});

describe('framing', () => {
  const bounds = { min: [-2, -1, 0] as const, max: [2, 1, 0] as const };

  it('centres the pivot on the bounds', () => {
    const framed = frameBounds(defaultView(true), { min: [0, 0, 0], max: [4, 2, 0] }, SIZE);
    expect(framed.pivot).toEqual([2, 1, 0]);
  });

  it('fits the whole extent, with a margin', () => {
    const framed = frameBounds(defaultView(true), bounds, SIZE);
    // The bounds are 4 wide; the frame must be wider, and not by an order of
    // magnitude.
    expect(framed.orthoWidth).toBeGreaterThan(4);
    expect(framed.orthoWidth).toBeLessThan(8);
  });

  it('frames without rotating unless asked — Space+F against Space+G', () => {
    const view = { ...defaultView(false), yaw: 12, pitch: -3 };
    const kept = frameBounds(view, bounds, SIZE);
    expect(kept.yaw).toBe(12);
    expect(kept.pitch).toBe(-3);
    const rotated = frameBounds(view, bounds, SIZE, { rotate: true });
    expect(rotated.yaw).toBe(THREE_QUARTER.yaw);
  });

  it('a rotating frame of a 2D view goes to Front, not to three-quarters', () => {
    // The whole point of the 2D default: homing must not put a drawing at an
    // angle, whatever Houdini's own homing preference does.
    const rotated = frameBounds(defaultView(true), bounds, SIZE, { rotate: true });
    expect(rotated.yaw).toBe(FRONT.yaw);
    expect(rotated.pitch).toBe(FRONT.pitch);
  });

  it('a single point does not collapse the camera onto it', () => {
    const framed = frameBounds(defaultView(true), { min: [3, 3, 0], max: [3, 3, 0] }, SIZE);
    expect(framed.orthoWidth).toBeGreaterThan(0);
    expect(Number.isFinite(framed.distance)).toBe(true);
    expect(framed.distance).toBeGreaterThan(0);
  });

  it('fits the tighter axis, so a wide scene in a tall panel is not cropped', () => {
    const wide = { min: [-50, -1, 0] as const, max: [50, 1, 0] as const };
    const tall = frameBounds(defaultView(true), wide, [400, 1200]);
    const square = frameBounds(defaultView(true), wide, [800, 800]);
    // A tall panel needs a wider orthographic frame to show the same width.
    expect(tall.orthoWidth).toBeGreaterThan(square.orthoWidth);
  });

  it('framing nothing is a view, not a NaN', () => {
    const framed = frameBounds(defaultView(false), undefined, SIZE);
    expect(Number.isFinite(framed.distance)).toBe(true);
    expect(framed.pivot).toEqual([0, 0, 0]);
  });
});

describe('the standard views', () => {
  it('the number keys land in orthographic except perspective', () => {
    const view = defaultView(false);
    expect(standardView(view, 'top').ortho).toBe(true);
    expect(standardView(view, 'front').ortho).toBe(true);
    expect(standardView(view, 'side').ortho).toBe(true);
    expect(standardView(view, 'perspective').ortho).toBe(false);
  });

  it('Top looks down -Y, Side looks along -X', () => {
    const top = cameraBasis(viewCameraFor(standardView(defaultView(false), 'top'), SIZE));
    expect(top.forward[1]).toBeCloseTo(-1, 5);
    const side = cameraBasis(viewCameraFor(standardView(defaultView(false), 'side'), SIZE));
    expect(side.forward[0]).toBeCloseTo(-1, 5);
  });

  it('a standard view keeps the pivot and the scale', () => {
    const view = { ...defaultView(false), pivot: [5, 6, 7] as const, orthoWidth: 33 };
    const top = standardView(view, 'top');
    expect(top.pivot).toEqual([5, 6, 7]);
    expect(top.orthoWidth).toBe(33);
  });
});

describe('the grid', () => {
  it('snaps spacing to a power of ten, so squares stay a readable size', () => {
    expect(gridSpacing(0.02)).toBe(1);
    expect(gridSpacing(2)).toBe(100);
    expect(gridSpacing(0.0002)).toBe(0.01);
  });

  it('spacing survives a nonsense scale rather than returning NaN', () => {
    expect(gridSpacing(0)).toBe(1);
    expect(gridSpacing(Number.NaN)).toBe(1);
    expect(gridSpacing(-1)).toBe(1);
  });

  it('follows the view, so the grid is never edge-on', () => {
    expect(gridPlaneFor(defaultView(true))).toBe('xy');
    expect(gridPlaneFor({ ...defaultView(false), pitch: -90, yaw: 0 })).toBe('xz');
    expect(gridPlaneFor({ ...defaultView(false), pitch: 0, yaw: 90 })).toBe('zy');
    // The three-quarter default is closest to the front, so XY.
    expect(gridPlaneFor(defaultView(false))).toBe('xy');
  });

  it('carries its colours as primitive attributes, the same vocabulary as SvgExport', () => {
    const grid = gridGeometry(defaultView(true), 0.01);
    expect(grid.primitive.Cd?.size).toBe(4);
    expect(grid.primitive.width?.size).toBe(1);
    // One colour and one width per primitive, or the renderer reads past the end.
    expect(grid.primitive.Cd!.data.length).toBe(grid.primitiveCount * 4);
    expect(grid.primitive.width!.data.length).toBe(grid.primitiveCount);
  });

  it('draws all three axes whichever plane the grid is in', () => {
    // The axis not in the plane is what tells you which plane you are on, and
    // dropping it is how an orthographic view loses its only depth cue.
    for (const view of [
      defaultView(true),
      { ...defaultView(false), pitch: -90 },
      { ...defaultView(false), yaw: 90 },
    ]) {
      const grid = gridGeometry(view, 0.01);
      const bounds = { x: false, y: false, z: false };
      const position = grid.point.P!;
      for (let point = 0; point < grid.pointCount; point += 1) {
        const [x, y, z] = [0, 1, 2].map((axis) => Number(position.data[point * 3 + axis]));
        if (y === 0 && z === 0 && x !== 0) bounds.x = true;
        if (x === 0 && z === 0 && y !== 0) bounds.y = true;
        if (x === 0 && y === 0 && z !== 0) bounds.z = true;
      }
      expect(bounds).toEqual({ x: true, y: true, z: true });
    }
  });

  it('the grid is geometry, so it goes through the same projection as the scene', () => {
    // Not a behavioural test — a structural one. If the grid ever stops being
    // geometry this fails, and the guarantee it protects is that a grid line
    // and a geometry line at one world position land on one pixel.
    const grid = gridGeometry(defaultView(true), 0.01);
    expect(grid.kind).toBe('geometry');
    expect(grid.primitiveCount).toBeGreaterThan(0);
    const camera = viewCameraFor(defaultView(true), SIZE);
    expect(viewMatrix(camera).length).toBe(16);
  });
});

describe('what the viewport opens in', () => {
  it('a flat drawing opens orthographic and a solid opens perspective', () => {
    const flat = new GeometryBuilder({ positionSize: 3 });
    flat.addPoint(0, 0, 0);
    flat.addPoint(2, 1, 0);
    const solid = new GeometryBuilder({ positionSize: 3 });
    solid.addPoint(0, 0, 0);
    solid.addPoint(2, 1, 3);

    const flatView = defaultView(
      sceneDimensionality({ geometry: [flat.build()], camera: null, lights: [] }).is2d,
    );
    const solidView = defaultView(
      sceneDimensionality({ geometry: [solid.build()], camera: null, lights: [] }).is2d,
    );
    expect(flatView.ortho).toBe(true);
    expect(flatView.yaw).toBe(FRONT.yaw);
    expect(solidView.ortho).toBe(false);
    expect(solidView.yaw).toBe(THREE_QUARTER.yaw);
  });
});
