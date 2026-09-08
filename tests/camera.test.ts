/**
 * The `camera` core type, against Houdini's conventions.
 *
 * Marcus, 2026-09-08: *"the camera should follow Houdini conventions."* Which is
 * `AGENTS.md`'s existing rule — *follow Houdini's parameter names where Houdini
 * has an equivalent node* — restated for a type whose first design here did not.
 * Two things it got wrong, and both are what these tests pin:
 *
 *   - **there is no field of view.** `focal` and `aperture` in millimetres, and
 *     the angle comes out of the two. Houdini's own defaults, 50 mm on a
 *     41.4214 mm aperture, are exactly 45°, which makes that number the one
 *     assertion that proves formula and defaults agree.
 *   - **the orientation is `translate` and `rotate`,** not eye-and-target. A
 *     Houdini camera is an object with a transform, looking down its own **-Z**
 *     with **+Y** up; look-at is layered on top rather than being the primitive.
 *
 * The `-Z` convention is the one worth testing hardest, because getting it
 * backwards produces a picture of the wrong half of the scene and every
 * individual number still looks plausible.
 */
import { describe, expect, it } from 'vitest';

import { CAMERA_DEFAULTS, type Camera, type Vec3 } from '@cascade/contracts';
import {
  cameraBasis,
  frameAspect,
  horizontalFov,
  lookAtRotation,
  projectionMatrix,
  verticalFov,
  viewMatrix,
} from '../packages/runtime/src/camera/index.js';
import { cameraDefinition, executeCamera } from '../packages/runtime/src/builtins/core/camera.js';

function camera(overrides: Partial<Camera> = {}): Camera {
  return { ...CAMERA_DEFAULTS, ...overrides };
}

/** Component-wise, because a basis vector is never exactly integral once it has
 *  been through two trig calls. */
function expectVec(actual: Vec3 | readonly number[], expected: readonly number[]) {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
}

describe("Houdini's lens, not a field of view", () => {
  it('turns the default 50mm on a 41.4214mm aperture into 45 degrees', () => {
    expect(horizontalFov(camera())).toBeCloseTo(45, 4);
  });

  it('narrows as the focal length grows', () => {
    expect(horizontalFov(camera({ focal: 100 }))).toBeLessThan(horizontalFov(camera()));
    expect(horizontalFov(camera({ focal: 24 }))).toBeGreaterThan(horizontalFov(camera()));
  });

  /** The reason `resolution` is on the camera at all: Houdini stores no vertical
   *  aperture and derives one from the frame shape, so a camera that did not
   *  know its resolution could not produce a vertical angle. */
  it('derives the vertical angle from the resolution', () => {
    const wide = camera({ resolution: [1280, 720] });
    expect(verticalFov(wide)).toBeLessThan(horizontalFov(wide));

    const square = camera({ resolution: [1000, 1000] });
    expect(verticalFov(square)).toBeCloseTo(horizontalFov(square), 6);

    const tall = camera({ resolution: [720, 1280] });
    expect(verticalFov(tall)).toBeGreaterThan(horizontalFov(tall));
  });

  /** `aspect` is the aspect of one PIXEL, which is the half of Houdini's naming
   *  most likely to be read as the frame's. */
  it('treats aspect as a pixel aspect, separate from the frame aspect', () => {
    expect(frameAspect(camera({ resolution: [1000, 1000], aspect: 2 }))).toBeCloseTo(2, 6);
    expect(frameAspect(camera({ resolution: [1280, 720], aspect: 1 })))
      .toBeCloseTo(1280 / 720, 6);
  });
});

describe('a camera looks down its own -Z with +Y up', () => {
  it('at rest', () => {
    const basis = cameraBasis(camera({ translate: [0, 0, 5] }));
    expectVec(basis.forward, [0, 0, -1]);
    expectVec(basis.right, [1, 0, 0]);
    expectVec(basis.up, [0, 1, 0]);
    expectVec(basis.eye, [0, 0, 5]);
  });

  it('yawed a quarter turn to the left', () => {
    // +90 about Y from a -Z rest direction points down -X.
    const basis = cameraBasis(camera({ rotate: [0, 90, 0] }));
    expectVec(basis.forward, [-1, 0, 0]);
    expectVec(basis.up, [0, 1, 0]);
  });

  it('pitched down', () => {
    const basis = cameraBasis(camera({ rotate: [-90, 0, 0] }));
    expectVec(basis.forward, [0, -1, 0]);
  });

  it('keeps its axes orthonormal under a compound rotation', () => {
    const { forward, right, up } = cameraBasis(camera({ rotate: [23, -47, 11] }));
    for (const axis of [forward, right, up]) {
      expect(Math.hypot(axis[0], axis[1], axis[2])).toBeCloseTo(1, 6);
    }
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(forward, right)).toBeCloseTo(0, 6);
    expect(dot(forward, up)).toBeCloseTo(0, 6);
    expect(dot(right, up)).toBeCloseTo(0, 6);
  });
});

describe('look-at is an override of the transform, not a second orientation', () => {
  /** It returns degrees in XYZ order precisely so it can be written into
   *  `rotate` — which is what keeps there being one way to orient a camera. */
  it('gives a rotation that aims the camera at the point', () => {
    const from: Vec3 = [0, 0, 5];
    const rotate = lookAtRotation(from, [0, 0, 0]);
    expectVec(rotate, [0, 0, 0]);
    expectVec(cameraBasis(camera({ translate: from, rotate })).forward, [0, 0, -1]);
  });

  it('aims from any direction', () => {
    for (const from of [[5, 0, 0], [0, 5, 0], [3, 4, 5], [-2, -7, 1]] as Vec3[]) {
      const rotate = lookAtRotation(from, [0, 0, 0]);
      const { forward } = cameraBasis(camera({ translate: from, rotate }));
      const length = Math.hypot(from[0], from[1], from[2]);
      // Aimed at the origin means forward is the direction back down the
      // position vector.
      expectVec(forward, [-from[0] / length, -from[1] / length, -from[2] / length]);
    }
  });

  it('aims at a target that is not the origin', () => {
    const from: Vec3 = [10, 2, 10];
    const to: Vec3 = [1, -3, 4];
    const rotate = lookAtRotation(from, to);
    const { forward } = cameraBasis(camera({ translate: from, rotate }));
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(delta[0], delta[1], delta[2]);
    expectVec(forward, [delta[0] / length, delta[1] / length, delta[2] / length]);
  });

  it('returns a rest rotation when there is no direction to face', () => {
    expectVec(lookAtRotation([1, 2, 3], [1, 2, 3]), [0, 0, 0]);
  });
});

describe('the matrices', () => {
  it('put the camera at the view origin', () => {
    const view = viewMatrix(camera({ translate: [4, -2, 9] }));
    // Column-major: the translation is elements 12, 13, 14.
    expectVec([view[12], view[13], view[14]], [-4, 2, -9]);
  });

  /** A point in front of the camera must land at negative view-space Z, which
   *  is the whole -Z convention expressed as the thing a renderer relies on. */
  it('put what the camera faces in front of it', () => {
    const view = viewMatrix(camera({ translate: [0, 0, 5] }));
    const apply = (p: Vec3) => [0, 1, 2].map(row =>
      view[row] * p[0] + view[4 + row] * p[1] + view[8 + row] * p[2] + view[12 + row]);
    expect(apply([0, 0, 0])[2]).toBeCloseTo(-5, 6);
    expect(apply([0, 0, 10])[2]).toBeGreaterThan(0);
  });

  it('scale the perspective projection from the lens rather than a stored angle', () => {
    const wide = projectionMatrix(camera({ focal: 24 }));
    const long = projectionMatrix(camera({ focal: 100 }));
    // A longer lens magnifies, so its horizontal scale is larger.
    expect(long[0]).toBeGreaterThan(wide[0]);
    expect(projectionMatrix(camera())[0]).toBeCloseTo((2 * 50) / 41.4214, 6);
  });

  it('use orthowidth for an orthographic camera', () => {
    const ortho = projectionMatrix(camera({ projection: 'orthographic', orthowidth: 4 }));
    expect(ortho[0]).toBeCloseTo(0.5, 6);
    // Orthographic has no perspective divide: the w row stays [0,0,0,1].
    expect(ortho[15]).toBe(1);
    expect(ortho[11]).toBe(0);
  });
});

describe('cascade.core.Camera', () => {
  function run(inputs: Record<string, unknown>, props: Record<string, unknown> = {}) {
    let output: Camera | undefined;
    const defaults = Object.fromEntries(
      Object.entries(cameraDefinition.props).map(([name, prop]) => [name, (prop as any).default]),
    );
    executeCamera({
      inputs: {
        translate: [0, 0, 5], rotate: [0, 0, 0], focal: 50,
        lookat: [0, 0, 0], up: [0, 1, 0], spin: 0,
        ...inputs,
      },
      props: { ...defaults, ...props },
      outputs: { camera: { set: (value: Camera) => { output = value; } } },
    } as any);
    return output!;
  }

  it('passes its transform and lens straight through', () => {
    const result = run({ translate: [1, 2, 3], rotate: [10, 20, 30], focal: 85 });
    expectVec(result.translate, [1, 2, 3]);
    expectVec(result.rotate, [10, 20, 30]);
    expect(result.focal).toBe(85);
    expect(result.aperture).toBeCloseTo(41.4214, 6);
  });

  it('replaces rotate with the look-at rotation when Look At is on', () => {
    const result = run({ translate: [5, 0, 0], rotate: [99, 99, 99] }, { lookAt: true });
    expectVec(cameraBasis(result).forward, [-1, 0, 0]);
  });

  /**
   * `spin` is added AFTER look-at, so a turntable keeps pointing at its subject
   * while it goes round rather than sliding off it. And it is **degrees**: it
   * was turns on `volume-render`, and adding turns to a `rotate` measured in
   * degrees is the kind of trap that reads correct at zero.
   */
  it('adds spin to the Y rotation after look-at', () => {
    const still = run({ translate: [0, 0, 5] }, { lookAt: true });
    const spun = run({ translate: [0, 0, 5], spin: 90 }, { lookAt: true });
    expectVec(still.rotate, [0, 0, 0]);
    expectVec(spun.rotate, [0, 90, 0]);
    expectVec(cameraBasis(spun).forward, [-1, 0, 0]);
  });

  it('carries the frame props onto the camera it emits', () => {
    const result = run({}, { resolution: [1920, 1080], aspect: 2, near: 0.5, far: 200 });
    expectVec(result.resolution, [1920, 1080]);
    expect(result.aspect).toBe(2);
    expect(result.near).toBe(0.5);
    expect(result.far).toBe(200);
  });

  it('emits an orthographic camera when asked', () => {
    expect(run({}, { projection: 'orthographic' }).projection).toBe('orthographic');
    // Anything unrecognised falls back rather than reaching a renderer as a
    // projection it has no branch for.
    expect(run({}, { projection: 'nonsense' }).projection).toBe('perspective');
  });
});
