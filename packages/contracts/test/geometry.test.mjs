import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_TYPES,
  createGeometry,
  emptyGeometry,
  geometryFileRefFromPath,
  geometryFromJson,
  geometryToJson,
  isGeometryFileRef,
  isGeometryJson,
  isGeometrySerialized,
  validateNodeDefinition,
} from "../dist/index.js";

function sample({ positionSize = 2 } = {}) {
  const positions =
    positionSize === 2
      ? [880.8163934260064, -12.5, 3.25, 4.5, 0, 1]
      : [880.8163934260064, -12.5, 7, 3.25, 4.5, -7, 0, 1, 0];
  return createGeometry({
    pointCount: 3,
    point: {
      P: {
        storage: "f64",
        size: positionSize,
        data: Float64Array.from(positions),
      },
      pscale: { storage: "f32", size: 1, data: Float32Array.of(0.5, 0.25, 2) },
    },
    vertex: {
      seam: { storage: "i32", size: 1, data: Int32Array.of(4, 5, 6) },
    },
    primitive: {
      width: { storage: "f64", size: 1, data: Float64Array.of(0.3) },
      tag: {
        storage: "string",
        size: 1,
        table: ["FORM_04"],
        data: Int32Array.of(0),
      },
    },
    detail: { size: [420, 594], name: "plate", seed: 7 },
    topology: {
      vertexPoints: Int32Array.of(0, 1, 2),
      offsets: Int32Array.of(0, 3),
      kinds: Uint8Array.of(0),
      closed: Uint8Array.of(1),
    },
    pointGroups: { ends: Uint8Array.of(1, 0, 1) },
    primitiveGroups: { layer0: Uint8Array.of(1) },
  });
}

test("geometry is a core type with a serialized and an in-memory form", () => {
  assert.ok(CORE_TYPES.includes("geometry"));
  const geometry = sample();
  assert.equal(geometry.pointCount, 3);
  assert.equal(geometry.vertexCount, 3);
  assert.equal(geometry.primitiveCount, 1);
  assert.ok(Object.isFrozen(geometry));
  assert.ok(Object.isFrozen(geometry.point));
});

test("the JSON codec round-trips losslessly through real JSON, f64 included", () => {
  const geometry = sample();
  const decoded = geometryFromJson(
    JSON.parse(JSON.stringify(geometryToJson(geometry))),
  );

  assert.equal(decoded.point.P.data[0], 880.8163934260064);
  assert.deepEqual(
    Array.from(decoded.point.P.data),
    Array.from(geometry.point.P.data),
  );
  assert.equal(decoded.point.pscale.storage, "f32");
  assert.deepEqual(
    Array.from(decoded.point.pscale.data),
    Array.from(geometry.point.pscale.data),
  );
  assert.deepEqual(
    Array.from(decoded.vertex.seam.data),
    Array.from(geometry.vertex.seam.data),
  );
  assert.deepEqual(decoded.primitive.tag.table, ["FORM_04"]);
  assert.deepEqual(decoded.detail, { size: [420, 594], name: "plate", seed: 7 });
  assert.deepEqual(
    Array.from(decoded.topology.vertexPoints),
    [0, 1, 2],
  );
  assert.deepEqual(Array.from(decoded.topology.closed), [1]);
  assert.deepEqual(Array.from(decoded.pointGroups.ends), [1, 0, 1]);
  assert.deepEqual(Array.from(decoded.primitiveGroups.layer0), [1]);
  assert.deepEqual(geometryToJson(decoded), geometryToJson(geometry));
});

test("groups travel as index lists and kinds are omitted when every kind is poly", () => {
  const json = geometryToJson(sample());
  assert.deepEqual(json.pointGroups.ends, [0, 2]);
  assert.equal(json.topology.kinds, undefined);
  assert.deepEqual(json.topology.closed, [1]);
});

test("a 2-component and a 3-component P both round-trip", () => {
  for (const positionSize of [2, 3]) {
    const geometry = sample({ positionSize });
    assert.equal(geometry.point.P.size, positionSize);
    const decoded = geometryFromJson(
      JSON.parse(JSON.stringify(geometryToJson(geometry))),
    );
    assert.equal(decoded.point.P.size, positionSize);
    assert.deepEqual(
      Array.from(decoded.point.P.data),
      Array.from(geometry.point.P.data),
    );
  }
  assert.equal(emptyGeometry().point.P.size, 2);
  assert.equal(emptyGeometry(3).point.P.size, 3);
  assert.equal(emptyGeometry().pointCount, 0);
});

test("createGeometry enforces the invariants the operations rely on", () => {
  const position = {
    storage: "f64",
    size: 2,
    data: Float64Array.of(0, 0, 1, 1),
  };
  assert.throws(
    () => createGeometry({ pointCount: 2, point: {} }),
    /geometry\/missing-position/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 2,
        point: {
          P: { storage: "f64", size: 4, data: Float64Array.of(0, 0, 0, 0, 1, 1, 1, 1) },
        },
      }),
    /geometry\/position-size/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 2,
        point: { P: position, Cd: { storage: "f32", size: 3, data: new Float32Array(3) } },
      }),
    /geometry\/attribute-length/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 2,
        point: { P: position },
        topology: {
          vertexPoints: Int32Array.of(0, 5),
          offsets: Int32Array.of(0, 2),
          kinds: Uint8Array.of(0),
          closed: Uint8Array.of(0),
        },
      }),
    /geometry\/vertex-point/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 2,
        point: { P: position },
        pointGroups: { bad: Uint8Array.of(1) },
      }),
    /geometry\/group-length/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 1,
        point: {
          P: { storage: "f64", size: 2, data: Float64Array.of(0, Number.NaN) },
        },
      }),
    /geometry\/non-finite/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 1,
        point: {
          P: { storage: "f64", size: 2, data: Float32Array.of(0, 0) },
        },
      }),
    /geometry\/attribute-storage/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 1,
        point: { P: { storage: "f64", size: 2, data: Float64Array.of(0, 0) } },
        pointGroups: { bad: Uint8Array.of(2) },
      }),
    /geometry\/group-mask/,
  );
  assert.throws(
    () =>
      createGeometry({
        pointCount: 1,
        point: { P: { storage: "f64", size: 2, data: Float64Array.of(0, 0) } },
        topology: {
          vertexPoints: Int32Array.of(0),
          offsets: Int32Array.of(0, 1),
          kinds: Uint8Array.of(0),
          closed: Uint8Array.of(2),
        },
      }),
    /geometry\/closed-mask/,
  );
});

test("createGeometry freezes ordinary nested metadata", () => {
  const table = ["FORM_04"];
  const page = [420, 594];
  const geometry = createGeometry({
    pointCount: 1,
    point: { P: { storage: "f64", size: 2, data: Float64Array.of(0, 0) } },
    primitive: {
      tag: { storage: "string", size: 1, table, data: new Int32Array(0) },
    },
    detail: { page },
  });
  assert.ok(Object.isFrozen(geometry.primitive.tag.table));
  assert.ok(Object.isFrozen(geometry.detail.page));
});

test("a geometry file reference is declared rather than guessed", () => {
  const ref = geometryFileRefFromPath("/cache/stipple-points.npy", {
    attribute: { level: "point", name: "P", size: 2, storage: "f64" },
    pointCount: 7000,
  });
  assert.equal(ref.kind, "geometry-file");
  assert.equal(ref.format, "npy");
  assert.ok(isGeometryFileRef(ref));
  assert.ok(isGeometrySerialized(ref));
  assert.equal(isGeometryJson(ref), false);
  assert.equal(
    isGeometryFileRef({ kind: "geometry-file", path: "a.npy", format: "npz" }),
    false,
  );
  assert.equal(
    isGeometryFileRef({ kind: "geometry-file", path: "a.npy", format: "npy" }),
    false,
  );
  assert.equal(
    isGeometryFileRef({
      kind: "geometry-file",
      path: "a.npy",
      format: "npy",
      attribute: { level: "point", name: "P", size: 2, storage: "f64" },
      pointCount: -1,
    }),
    false,
  );
  assert.throws(
    () => geometryFileRefFromPath("/cache/points.bin"),
    /geometry\/unknown-format/,
  );
});

test("defaultMatches rejects a geometry default that is not geometry", () => {
  const withDefault = (value) =>
    validateNodeDefinition({
      apiVersion: 1,
      runsOn: "portable",
      inputs: { shape: { kind: "data", type: "geometry", default: value } },
      outputs: { result: { kind: "data", type: "geometry" } },
    }).map(({ code }) => code);

  assert.deepEqual(withDefault(geometryToJson(emptyGeometry())), []);
  assert.deepEqual(
    withDefault(geometryFileRefFromPath("/cache/points.json")),
    [],
  );
  for (const value of [
    42,
    "geometry",
    null,
    [],
    {},
    { kind: "points", points: [[0, 0]] },
    { kind: "geometry", pointCount: 1 },
    { kind: "geometry", pointCount: 1, point: { P: { storage: "f64", size: 4, data: [0, 0, 0, 0] } } },
    { kind: "geometry", pointCount: -1, point: { P: { storage: "f64", size: 2, data: [] } } },
    { kind: "geometry", pointCount: 1, point: { P: { storage: "f128", size: 2, data: [0, 0] } } },
  ])
    assert.deepEqual(
      withDefault(value),
      ["definition/default-type"],
      `expected ${JSON.stringify(value)} to be rejected`,
    );
});

test("the interchange guard accepts only a well-formed geometry", () => {
  assert.ok(isGeometryJson(geometryToJson(sample())));
  assert.equal(isGeometryJson(undefined), false);
  assert.equal(
    isGeometryJson({
      kind: "geometry",
      pointCount: 1,
      point: { P: { storage: "f64", size: 2, data: [0, Number.NaN] } },
    }),
    false,
  );
  for (const malformed of [
    {
      kind: "geometry",
      pointCount: 2,
      point: { P: { storage: "f64", size: 2, data: [0, 0] } },
    },
    {
      kind: "geometry",
      pointCount: 1,
      point: { P: { storage: "f64", size: 2, data: [0, 0] } },
      topology: { vertexPoints: [0.5], offsets: [0, 1] },
    },
    {
      kind: "geometry",
      pointCount: 1,
      point: { P: { storage: "f64", size: 2, data: [0, 0] } },
      pointGroups: { bad: [2] },
    },
    {
      kind: "geometry",
      pointCount: 1,
      point: {
        P: { storage: "f64", size: 2, data: [0, 0] },
        index: { storage: "i32", size: 1, data: [0.5] },
      },
    },
    {
      kind: "geometry",
      pointCount: 1,
      point: {
        P: { storage: "f64", size: 2, data: [0, 0] },
        tag: { storage: "string", table: ["a"], data: [0.5] },
      },
    },
    {
      kind: "geometry",
      pointCount: 1,
      point: { P: { storage: "f64", size: 2, data: [0, 0] } },
      topology: { vertexPoints: [2147483648], offsets: [0, 1] },
    },
  ]) assert.equal(isGeometryJson(malformed), false, JSON.stringify(malformed));
  assert.throws(
    () => geometryFromJson({ kind: "points", pointCount: 0 }),
    /geometry\/not-geometry/,
  );
});
