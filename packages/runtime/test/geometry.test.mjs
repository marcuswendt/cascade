import assert from "node:assert/strict";
import test from "node:test";

import {
  GeometryBuilder,
  attributeCreate,
  copyAttribute,
  emptyGeometry,
  geometryBounds,
  geometryLength,
  getPosition,
  groupIndices,
  mergeGeometry,
  primitiveLength,
  primitivePoints,
  promoteAttribute,
  readAttribute,
  removeAttribute,
  resampleGeometry,
  setGroup,
  transformGeometry,
  widerStorage,
} from "../dist/index.js";

/** A closed unit square as one polygon, plus one loose point. */
function square() {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 4, 0, 4, 4, 0, 4], { closed: true });
  builder.addPoint(9, 9);
  builder.setNumericAttribute("primitive", "width", [0.3]);
  builder.setStringAttribute("primitive", "tag", ["FORM_04"]);
  builder.setDetail("size", [420, 594]);
  builder.addToPrimitiveGroup("layer0", 0);
  return builder.build();
}

/** An open two-segment line, with a per-primitive colour and no width. */
function elbow() {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 10, 0, 10, 10]);
  builder.setNumericAttribute("primitive", "Cd", [1, 0.5, 0], 3);
  builder.addToPrimitiveGroup("layer1", 0);
  return builder.build();
}

test("the builder produces points, topology and attributes in one pass", () => {
  const geometry = square();
  assert.equal(geometry.pointCount, 5);
  assert.equal(geometry.vertexCount, 4);
  assert.equal(geometry.primitiveCount, 1);
  assert.deepEqual(Array.from(geometry.topology.offsets), [0, 4]);
  assert.deepEqual(primitivePoints(geometry, 0), [0, 1, 2, 3]);
  assert.deepEqual(getPosition(geometry, 4), [9, 9]);
  assert.equal(readAttribute(geometry.primitive.tag, 0), "FORM_04");
  assert.deepEqual(geometry.detail.size, [420, 594]);
  assert.deepEqual(geometryBounds(geometry), { min: [0, 0], max: [9, 9] });
  assert.equal(primitiveLength(geometry, 0), 16);
  assert.equal(geometryLength(geometry), 16);
});

test("a 3-component P carries through the builder and the operations", () => {
  const builder = new GeometryBuilder({ positionSize: 3 });
  builder.addPolygon([0, 0, 1, 2, 0, 1, 2, 2, 1]);
  const geometry = builder.build();
  assert.equal(geometry.point.P.size, 3);
  assert.deepEqual(getPosition(geometry, 0), [0, 0, 1]);

  // A mat3 is a 2D transform and leaves the third component alone.
  const scaled = transformGeometry(geometry, [2, 0, 0, 0, 2, 0, 0, 0, 1]);
  assert.deepEqual(getPosition(scaled, 2), [4, 4, 1]);

  // A mat4 moves all three. Column-major, so the translation is 12..14.
  const moved = transformGeometry(
    geometry,
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
  );
  assert.deepEqual(getPosition(moved, 0), [5, 6, 8]);
  assert.deepEqual(geometryBounds(geometry), { min: [0, 0, 1], max: [2, 2, 1] });
});

test("copy-on-write leaves the source untouched and shares what it did not touch", () => {
  const source = square();
  const before = Array.from(source.point.P.data);
  const moved = transformGeometry(source, [1, 0, 0, 0, 1, 0, 100, 200, 1]);

  assert.deepEqual(Array.from(source.point.P.data), before);
  assert.deepEqual(getPosition(moved, 0), [100, 200]);
  assert.notEqual(moved.point.P.data, source.point.P.data);
  // Everything the transform did not touch is the same object, not a copy.
  assert.equal(moved.topology, source.topology);
  assert.equal(moved.primitive, source.primitive);
  assert.equal(moved.point.pscale, source.point.pscale);
  assert.equal(moved.primitiveGroups, source.primitiveGroups);

  const tagged = attributeCreate(source, {
    level: "point",
    name: "pscale",
    value: 1.5,
  });
  assert.equal(source.point.pscale, undefined);
  assert.equal(tagged.point.P.data, source.point.P.data);
  assert.equal(removeAttribute(tagged, "point", "pscale").point.pscale, undefined);
  assert.notEqual(tagged.point.pscale, undefined);
  assert.throws(
    () => removeAttribute(source, "point", "P"),
    /geometry\/remove-position/,
  );
});

test("attributes survive a merge with disjoint attribute sets on each side", () => {
  const merged = mergeGeometry(square(), elbow());

  assert.equal(merged.pointCount, 8);
  assert.equal(merged.vertexCount, 7);
  assert.equal(merged.primitiveCount, 2);

  // The square knows nothing of Cd and the elbow nothing of width or tag.
  // Neither is dropped, and the side that lacked one reads as its zero.
  assert.equal(merged.primitive.width.size, 1);
  assert.deepEqual(Array.from(merged.primitive.width.data), [0.3, 0]);
  assert.equal(merged.primitive.Cd.size, 3);
  assert.deepEqual(Array.from(merged.primitive.Cd.data), [0, 0, 0, 1, 0.5, 0]);
  assert.equal(readAttribute(merged.primitive.tag, 0), "FORM_04");
  assert.equal(readAttribute(merged.primitive.tag, 1), "");
  assert.deepEqual(merged.detail.size, [420, 594]);

  // Topology is renumbered, so the elbow's vertices point at the new points.
  assert.deepEqual(Array.from(merged.topology.offsets), [0, 4, 7]);
  assert.deepEqual(primitivePoints(merged, 1), [5, 6, 7]);
  assert.deepEqual(getPosition(merged, 7), [10, 10]);
  assert.deepEqual(Array.from(merged.topology.closed), [1, 0]);
});

test("merging a 2-component P with a 3-component P widens and zero-fills z", () => {
  const flat = new GeometryBuilder();
  flat.addPoint(1, 2);
  const deep = new GeometryBuilder({ positionSize: 3 });
  deep.addPoint(3, 4, 5);
  const merged = mergeGeometry(flat.build(), deep.build());
  assert.equal(merged.point.P.size, 3);
  assert.deepEqual(getPosition(merged, 0), [1, 2, 0]);
  assert.deepEqual(getPosition(merged, 1), [3, 4, 5]);
});

test("groups survive a merge with the indices remapped", () => {
  const left = setGroup(square(), "point", "corners", [0, 1, 2, 3]);
  const right = setGroup(elbow(), "point", "ends", [0, 2]);
  const merged = mergeGeometry(left, right);

  assert.deepEqual(groupIndices(merged.pointGroups.corners), [0, 1, 2, 3]);
  assert.deepEqual(groupIndices(merged.pointGroups.ends), [5, 7]);
  assert.deepEqual(groupIndices(merged.primitiveGroups.layer0), [0]);
  assert.deepEqual(groupIndices(merged.primitiveGroups.layer1), [1]);
  assert.equal(merged.pointGroups.corners.length, 8);
  assert.equal(merged.primitiveGroups.layer1.length, 2);
});

test("merge widens storage rather than losing values, and refuses a real conflict", () => {
  assert.equal(widerStorage("f32", "f32"), "f32");
  assert.equal(widerStorage("u8", "i32"), "i32");
  assert.equal(widerStorage("u8", "f32"), "f32");
  assert.equal(widerStorage("i32", "f32"), "f64");
  assert.equal(widerStorage("f64", "u8"), "f64");

  const left = attributeCreate(square(), {
    level: "primitive",
    name: "pen",
    value: 3,
    storage: "i32",
  });
  const right = attributeCreate(elbow(), {
    level: "primitive",
    name: "pen",
    value: 0.5,
    storage: "f32",
  });
  const merged = mergeGeometry(left, right);
  assert.equal(merged.primitive.pen.storage, "f64");
  assert.deepEqual(Array.from(merged.primitive.pen.data), [3, 0.5]);

  const stringy = attributeCreate(elbow(), {
    level: "primitive",
    name: "pen",
    value: "black",
  });
  assert.throws(
    () => mergeGeometry(left, stringy),
    /geometry\/attribute-conflict/,
  );
});

test("merge is the identity on one input and empty on none", () => {
  const one = square();
  assert.equal(mergeGeometry(one), one);
  assert.equal(mergeGeometry().pointCount, 0);
  assert.equal(mergeGeometry().point.P.size, 2);
});

test("resample rewrites each primitive at a uniform spacing", () => {
  const geometry = elbow();
  const resampled = resampleGeometry(geometry, { spacing: 5 });

  // 20 units of open chain at a spacing of 5 is five stations.
  assert.equal(resampled.primitiveCount, 1);
  assert.equal(resampled.vertexCount, 5);
  assert.deepEqual(getPosition(resampled, 0), [0, 0]);
  assert.deepEqual(getPosition(resampled, 1), [5, 0]);
  assert.deepEqual(getPosition(resampled, 2), [10, 0]);
  assert.deepEqual(getPosition(resampled, 3), [10, 5]);
  assert.deepEqual(getPosition(resampled, 4), [10, 10]);
  // The primitive count is unchanged, so its attributes are shared outright.
  assert.equal(resampled.primitive, geometry.primitive);
  assert.deepEqual(Array.from(geometry.point.P.data), [0, 0, 10, 0, 10, 10]);
});

test("resample keeps a closed primitive closed and preserves loose points", () => {
  const geometry = square();
  const resampled = resampleGeometry(geometry, { count: 8 });

  assert.equal(resampled.primitiveCount, 1);
  assert.equal(resampled.vertexCount, 8);
  assert.deepEqual(Array.from(resampled.topology.closed), [1]);
  // The loose point is untouched, and it keeps the lowest index because kept
  // points are renumbered before the new stations are appended.
  assert.equal(resampled.pointCount, 9);
  assert.deepEqual(getPosition(resampled, 0), [9, 9]);
  assert.deepEqual(getPosition(resampled, 1), [0, 0]);
  assert.deepEqual(getPosition(resampled, 2), [2, 0]);
  assert.equal(primitiveLength(resampled, 0), 16);
  assert.equal(readAttribute(resampled.primitive.tag, 0), "FORM_04");
});

test("resample interpolates point attributes and takes the nearer string", () => {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 10, 0]);
  builder.setNumericAttribute("point", "pscale", [0, 10]);
  builder.setStringAttribute("point", "label", ["a", "b"]);
  const resampled = resampleGeometry(builder.build(), { count: 5 });

  assert.deepEqual(Array.from(resampled.point.pscale.data), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => readAttribute(resampled.point.label, index)),
    ["a", "a", "b", "b", "b"],
  );
});

test("resample restricted to a group leaves the rest alone", () => {
  const merged = mergeGeometry(square(), elbow());
  const resampled = resampleGeometry(merged, { count: 3, group: "layer1" });
  assert.equal(resampled.primitiveCount, 2);
  assert.deepEqual(Array.from(resampled.topology.offsets), [0, 4, 7]);
  assert.deepEqual(getPosition(resampled, 6), [10, 0]);
  assert.throws(
    () => resampleGeometry(merged, { count: 3, group: "nope" }),
    /geometry\/missing-group/,
  );
  assert.throws(
    () => resampleGeometry(merged, { count: 3, spacing: 1 }),
    /geometry\/resample-options/,
  );
  assert.throws(() => resampleGeometry(merged, {}), /geometry\/resample-options/);
  assert.equal(resampleGeometry(emptyGeometry(), { count: 3 }).pointCount, 0);
});

test("promote moves an attribute between levels with a stated reduction", () => {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 4, 0, 4, 4], { closed: true });
  builder.setNumericAttribute("point", "pscale", [1, 2, 6]);
  const geometry = builder.build();

  const mean = promoteAttribute(geometry, {
    name: "pscale",
    from: "point",
    to: "primitive",
    reduction: "mean",
  });
  assert.equal(mean.primitive.pscale.data[0], 3);
  assert.equal(mean.point.pscale, undefined);

  const max = promoteAttribute(geometry, {
    name: "pscale",
    from: "point",
    to: "primitive",
    reduction: "max",
    keepSource: true,
  });
  assert.equal(max.primitive.pscale.data[0], 6);
  assert.notEqual(max.point.pscale, undefined);

  // Fan-out copies, so every vertex reads its own point's value.
  const perVertex = promoteAttribute(geometry, {
    name: "pscale",
    from: "point",
    to: "vertex",
    reduction: "first",
  });
  assert.deepEqual(Array.from(perVertex.vertex.pscale.data), [1, 2, 6]);

  // Detail is a level like any other.
  const total = promoteAttribute(geometry, {
    name: "pscale",
    from: "point",
    to: "detail",
    reduction: "sum",
    as: "pscaleTotal",
  });
  assert.equal(total.detail.pscaleTotal, 9);
  const broadcast = promoteAttribute(total, {
    name: "pscaleTotal",
    from: "detail",
    to: "point",
    reduction: "first",
  });
  assert.deepEqual(Array.from(broadcast.point.pscaleTotal.data), [9, 9, 9]);
  assert.equal(broadcast.detail.pscaleTotal, undefined);

  assert.throws(
    () =>
      promoteAttribute(square(), {
        name: "tag",
        from: "primitive",
        to: "point",
        reduction: "mean",
      }),
    /geometry\/string-reduction/,
  );
  assert.throws(
    () =>
      promoteAttribute(geometry, {
        name: "missing",
        from: "point",
        to: "primitive",
        reduction: "first",
      }),
    /geometry\/missing-attribute/,
  );
});

test("copyAttribute takes an attribute from another geometry by index", () => {
  const source = attributeCreate(elbow(), {
    level: "point",
    name: "Cd",
    value: [1, 0, 0],
  });
  const target = copyAttribute(square(), source, { level: "point", name: "Cd" });

  assert.equal(target.point.Cd.size, 3);
  assert.equal(target.pointCount, 5);
  // The square has five points to the elbow's three; the surplus is zeroed
  // rather than wrapped, because wrapping invents values that look like data.
  assert.deepEqual(Array.from(target.point.Cd.data).slice(0, 9), [
    1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  assert.deepEqual(Array.from(target.point.Cd.data).slice(9), [0, 0, 0, 0, 0, 0]);
  assert.throws(
    () => copyAttribute(square(), elbow(), { level: "point", name: "nope" }),
    /geometry\/missing-attribute/,
  );
});

test("attributeCreate reaches all four levels", () => {
  const geometry = square();
  assert.equal(
    attributeCreate(geometry, { level: "vertex", name: "uv", value: [0, 1] })
      .vertex.uv.data.length,
    8,
  );
  assert.equal(
    readAttribute(
      attributeCreate(geometry, {
        level: "primitive",
        name: "pen",
        value: "black",
      }).primitive.pen,
      0,
    ),
    "black",
  );
  assert.equal(
    attributeCreate(geometry, { level: "detail", name: "seed", value: 7 }).detail
      .seed,
    7,
  );
  assert.equal(
    attributeCreate(geometry, {
      level: "point",
      name: "flag",
      value: 1,
      storage: "u8",
    }).point.flag.storage,
    "u8",
  );
});
