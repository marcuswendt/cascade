import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_DEFAULTS,
  EMPTY_SCENE,
  asScene,
  canConnectTypes,
  isScene,
  sceneFromGeometry,
} from "../../contracts/dist/index.js";
import { sceneBounds, sceneDimensionality } from "../dist/index.js";
import {
  lightRegistration,
  sceneNodeRegistrations,
  sceneRegistration,
} from "../dist/builtins/scene/index.js";
import { GeometryBuilder, rectangleGeometry } from "../dist/index.js";

/**
 * The scene assembly, tested as nodes and as measurements.
 *
 * The measurement half is the half that matters, because `sceneDimensionality`
 * decides which viewport a node opens in and a wrong answer there is a
 * viewport that shows a line where a drawing should be. Every case below was
 * checked against its own negative control — the assertion was confirmed to
 * fail with the condition it tests removed from the implementation — because
 * this session has now three times written a test whose inputs could not
 * discriminate the thing it claimed to test.
 */

const signal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
const progress = { report() {} };

function inputDefaults(definition) {
  const values = {};
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if (input.kind !== "data") continue;
    if (input.variadic) values[name] = [];
    else if ("default" in input) values[name] = input.default;
  }
  return values;
}

function propDefaults(definition) {
  const values = {};
  for (const [name, prop] of Object.entries(definition.props ?? {}))
    values[name] = prop.default;
  return values;
}

async function run(registration, options = {}) {
  const execute = await registration.loadExecute("server");
  const values = {};
  const outputs = {};
  for (const name of Object.keys(registration.definition.outputs ?? {}))
    outputs[name] = {
      set: (value) => {
        values[name] = value;
      },
    };
  await execute({
    nodeId: "test",
    inputs: { ...inputDefaults(registration.definition), ...options.inputs },
    outputs,
    props: { ...propDefaults(registration.definition), ...options.props },
    capabilities: {},
    signal,
    progress,
  });
  return values;
}

/** A 2D geometry: `P` has a size of 2, which is the common case in this vault. */
function flat2d() {
  return rectangleGeometry({ size: [2, 1] });
}

/** A 3D geometry with a real Z extent, built point by point. */
function boxCorners() {
  const builder = new GeometryBuilder({ positionSize: 3 });
  for (const z of [0, 4])
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
      builder.addPoint(x, y, z);
  return builder.build();
}

/** 3D positions that all share one Z. Flat, but not 2D by point size. */
function planeAtZ(z) {
  const builder = new GeometryBuilder({ positionSize: 3 });
  for (const [x, y] of [
    [0, 0],
    [3, 0],
    [3, 2],
    [0, 2],
  ])
    builder.addPoint(x, y, z);
  return builder.build();
}

test("both scene nodes register once each under one namespace", () => {
  assert.deepEqual(
    sceneNodeRegistrations.map((registration) => registration.moduleId),
    ["cascade.scene.Scene", "cascade.scene.Light"],
  );
});

test("an empty Scene is a scene, not a failure", async () => {
  const { scene } = await run(sceneRegistration);
  assert.deepEqual(scene, { geometry: [], camera: null, lights: [] });
  assert.equal(isScene(scene), true);
});

test("Scene sorts geometry, camera and lights out of one variadic port", async () => {
  const { light } = await run(lightRegistration);
  const camera = { ...CAMERA_DEFAULTS, translate: [0, 0, 9] };
  const { scene } = await run(sceneRegistration, {
    inputs: { inputs: [flat2d(), camera, light, flat2d()] },
  });
  assert.equal(scene.geometry.length, 2);
  assert.equal(scene.lights.length, 1);
  assert.deepEqual(scene.camera.translate, [0, 0, 9]);
});

test("order does not matter — the camera is found last as well as first", async () => {
  const camera = { ...CAMERA_DEFAULTS, translate: [1, 2, 3] };
  const { scene } = await run(sceneRegistration, {
    inputs: { inputs: [flat2d(), flat2d(), camera] },
  });
  assert.deepEqual(scene.camera.translate, [1, 2, 3]);
});

test("an unwired slot in the middle is skipped, not classified", async () => {
  const { scene } = await run(sceneRegistration, {
    inputs: { inputs: [flat2d(), undefined, flat2d()] },
  });
  assert.equal(scene.geometry.length, 2);
  assert.equal(scene.camera, null);
});

test("two cameras throw, and the message names both ports", async () => {
  await assert.rejects(
    run(sceneRegistration, {
      inputs: { inputs: [CAMERA_DEFAULTS, flat2d(), CAMERA_DEFAULTS] },
    }),
    /two cameras, on inputs 0 and 2/,
  );
});

test("a nested scene is flattened, and Scene is therefore associative", async () => {
  const camera = { ...CAMERA_DEFAULTS, translate: [0, 5, 0] };
  const { light } = await run(lightRegistration);
  const inner = await run(sceneRegistration, {
    inputs: { inputs: [flat2d(), camera] },
  });
  const outer = await run(sceneRegistration, {
    inputs: { inputs: [inner.scene, flat2d(), light] },
  });
  const flatly = await run(sceneRegistration, {
    inputs: { inputs: [flat2d(), camera, flat2d(), light] },
  });
  assert.equal(outer.scene.geometry.length, flatly.scene.geometry.length);
  assert.equal(outer.scene.lights.length, flatly.scene.lights.length);
  assert.deepEqual(outer.scene.camera, flatly.scene.camera);
});

test("a nested scene's camera still collides with a sibling camera", async () => {
  const inner = await run(sceneRegistration, {
    inputs: { inputs: [CAMERA_DEFAULTS] },
  });
  await assert.rejects(
    run(sceneRegistration, {
      inputs: { inputs: [inner.scene, CAMERA_DEFAULTS] },
    }),
    /two cameras/,
  );
});

test("something that is not scene material throws rather than being dropped", async () => {
  await assert.rejects(
    run(sceneRegistration, { inputs: { inputs: ["a string"] } }),
    /input 0 is not geometry, a camera, a light or a scene \(received a string\)/,
  );
  await assert.rejects(
    run(sceneRegistration, { inputs: { inputs: [flat2d(), { kind: "volume" }] } }),
    /input 1 .*an object of kind "volume"/,
  );
});

test("Light carries Houdini's names through, including distant", async () => {
  const { light } = await run(lightRegistration, {
    inputs: { intensity: 2.5, color: [1, 0, 0, 1] },
    props: { type: "distant", coneangle: 30 },
  });
  assert.equal(light.type, "distant");
  assert.equal(light.intensity, 2.5);
  assert.deepEqual(light.color, [1, 0, 0, 1]);
  assert.equal(light.coneangle, 30);
});

test("an unknown light type falls back to point rather than escaping the union", async () => {
  const { light } = await run(lightRegistration, { props: { type: "kleig" } });
  assert.equal(light.type, "point");
});

// ------------------------------------------------------------------ promotion

test("geometry widens to scene, so an existing wire stays legal", () => {
  assert.equal(canConnectTypes("geometry", "scene"), true);
  // And not the reverse: a scene is not geometry, and narrowing is never implicit.
  assert.equal(canConnectTypes("scene", "geometry"), false);
});

test("asScene promotes a geometry and passes a scene through untouched", () => {
  const geometry = flat2d();
  const promoted = asScene(geometry);
  assert.equal(promoted.geometry.length, 1);
  assert.equal(promoted.camera, null);
  const scene = sceneFromGeometry(geometry);
  assert.equal(asScene(scene), scene);
});

test("asScene gives an empty scene for nothing, and for nonsense", () => {
  assert.equal(asScene(undefined), EMPTY_SCENE);
  assert.equal(asScene(null), EMPTY_SCENE);
  assert.equal(asScene("not a scene"), EMPTY_SCENE);
  assert.equal(asScene(42), EMPTY_SCENE);
});

test("isScene distinguishes a scene from an object that merely has geometry", () => {
  assert.equal(isScene({ geometry: [], lights: [], camera: null }), true);
  // No `camera` key at all: this is the case a looser check gets wrong.
  assert.equal(isScene({ geometry: [], lights: [] }), false);
  assert.equal(isScene(flat2d()), false);
});

// ---------------------------------------------------------------- measurement

test("sceneBounds is undefined for an empty scene and three components otherwise", () => {
  assert.equal(sceneBounds(EMPTY_SCENE), undefined);
  const bounds = sceneBounds(sceneFromGeometry(flat2d()));
  assert.equal(bounds.min.length, 3);
  assert.equal(bounds.max.length, 3);
  // A 2D geometry's P has a size of 2; the third component is 0, not undefined.
  assert.equal(bounds.min[2], 0);
  assert.equal(bounds.max[2], 0);
});

test("sceneBounds unions across geometries rather than taking the first", () => {
  const scene = {
    geometry: [planeAtZ(0), planeAtZ(7)],
    camera: null,
    lights: [],
  };
  const bounds = sceneBounds(scene);
  assert.equal(bounds.min[2], 0);
  assert.equal(bounds.max[2], 7);
});

test("a 2D geometry opens flat", () => {
  const { is2d, reason } = sceneDimensionality(sceneFromGeometry(flat2d()));
  assert.equal(is2d, true);
  assert.equal(reason, "flat");
});

test("a real Z extent opens in 3D", () => {
  const { is2d, reason } = sceneDimensionality(sceneFromGeometry(boxCorners()));
  assert.equal(is2d, false);
  assert.equal(reason, "depth");
});

test("a wired camera forces 3D even when the geometry is flat", () => {
  const scene = { geometry: [flat2d()], camera: CAMERA_DEFAULTS, lights: [] };
  const { is2d, reason } = sceneDimensionality(scene);
  assert.equal(is2d, false);
  assert.equal(reason, "camera");
});

test("a point N attribute forces 3D on flat geometry", () => {
  const builder = new GeometryBuilder({ positionSize: 3 });
  builder.addPoint(0, 0, 0);
  builder.addPoint(1, 1, 0);
  builder.setNumericAttribute("point", "N", [0, 0, 1, 0, 0, 1], 3);
  const scene = sceneFromGeometry(builder.build());
  // The bounds alone would say flat, so this is the discriminating case: only a
  // check on N can produce this answer.
  assert.equal(sceneBounds(scene).max[2] - sceneBounds(scene).min[2], 0);
  const { is2d, reason } = sceneDimensionality(scene);
  assert.equal(is2d, false);
  assert.equal(reason, "normals");
});

test("3D positions that share one non-zero Z are still flat", () => {
  // The failure this catches: testing depth as `max[2] !== 0` rather than as an
  // extent. A plane at z=12 is a drawing, and a viewport that tumbles it is
  // wrong about it.
  const { is2d } = sceneDimensionality(sceneFromGeometry(planeAtZ(12)));
  assert.equal(is2d, true);
});

test("flatness is relative to the scene's own size, not an absolute epsilon", () => {
  // The discriminating pair, and getting it wrong the first time is why the
  // numbers are spelled out. A fixed epsilon of 1e-6 agrees with the relative
  // rule on both a small deep scene and a small flat one — the case that
  // separates them has to be a LARGE scene carrying proportionally tiny noise.
  const small = new GeometryBuilder({ positionSize: 3 });
  small.addPoint(0, 0, 0);
  small.addPoint(0.001, 0.001, 0.0004);
  assert.equal(sceneDimensionality(sceneFromGeometry(small.build())).is2d, false);

  // 1e-4 of depth across a 1000-wide scene is float noise on a plane, and the
  // relative rule calls it flat. A 1e-6 absolute epsilon calls it 3D and
  // tumbles a drawing, which is the bug this asserts against.
  const large = new GeometryBuilder({ positionSize: 3 });
  large.addPoint(0, 0, 0);
  large.addPoint(1000, 1000, 1e-4);
  assert.equal(sceneDimensionality(sceneFromGeometry(large.build())).is2d, true);
});

test("an empty scene opens flat rather than refusing to decide", () => {
  const { is2d, reason } = sceneDimensionality(EMPTY_SCENE);
  assert.equal(is2d, true);
  assert.equal(reason, "empty");
});
