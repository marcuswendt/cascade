import assert from "node:assert/strict";
import test from "node:test";

import {
  GeometryBuilder,
  circleGeometry,
  copyToPoints,
  emptyGeometry,
  geometryToSvg,
  mergeGeometry,
  primitiveKind,
  primitivePoints,
  rectangleGeometry,
  readAttribute,
  resampleGeometry,
  setGroup,
} from "../dist/index.js";
import { createGeometry } from "../../contracts/dist/index.js";
import { createRuntime } from "../dist/index.js";
import { createNodeRuntimeHost } from "../dist/node.js";
import {
  circleRegistration,
  copyToPointsRegistration,
  geoNodeRegistrations,
  mergeRegistration,
  rectangleRegistration,
  svgExportRegistration,
  transformRegistration,
} from "../dist/builtins/geo/index.js";

/**
 * The six nodes, exercised as nodes rather than as the operations underneath
 * them: a definition is a contract about defaults, prop names and output types,
 * and none of that is tested by calling the op directly.
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
    inputs: { ...inputDefaults(registration.definition), ...options.inputs },
    outputs,
    props: { ...propDefaults(registration.definition), ...options.props },
    capabilities: options.capabilities ?? {},
    signal,
    progress,
  });
  return values;
}

function assetCapability(written = []) {
  return {
    written,
    assets: {
      write: async (data, metadata) => {
        written.push({ data, metadata });
        return {
          path: `/assets/${metadata.suggestedName}`,
          mediaType: metadata.mediaType,
        };
      },
      read: async () => new Uint8Array(0),
    },
  };
}

test("the six nodes register once each under one namespace", () => {
  assert.deepEqual(
    geoNodeRegistrations.map((registration) => registration.moduleId),
    [
      "cascade.geo.Rectangle",
      "cascade.geo.Circle",
      "cascade.geo.Transform",
      "cascade.geo.Merge",
      "cascade.geo.CopyToPoints",
      "cascade.geo.SvgExport",
    ],
  );
  for (const registration of geoNodeRegistrations) {
    assert.equal(registration.definition.apiVersion, 1);
    assert.equal(registration.definition.runsOn, "portable");
  }
  // Only the export touches the world, and it declares exactly one capability.
  assert.deepEqual(
    geoNodeRegistrations
      .filter((item) => item.definition.capabilities)
      .map((item) => [item.moduleId, item.definition.capabilities]),
    [["cascade.geo.SvgExport", ["assets"]]],
  );
});

test("Rectangle is a closed four-point polygon around its centre", async () => {
  const { geometry } = await run(rectangleRegistration, {
    inputs: { size: [4, 2], center: [1, 1] },
  });
  assert.equal(geometry.pointCount, 4);
  assert.equal(geometry.primitiveCount, 1);
  assert.equal(geometry.vertexCount, 4);
  assert.equal(geometry.topology.closed[0], 1);
  assert.equal(primitiveKind(geometry, 0), "poly");
  assert.deepEqual(Array.from(geometry.point.P.data), [
    -1, 0, 3, 0, 3, 2, -1, 2,
  ]);
});

test("a Circle is a Bezier by default, and +1 is above the origin", async () => {
  const { geometry } = await run(circleRegistration);
  // Four cubic segments: four anchors on the axes, two handles between each.
  assert.equal(geometry.pointCount, 12);
  assert.equal(geometry.vertexCount, 12);
  assert.equal(geometry.primitiveCount, 1);
  assert.equal(primitiveKind(geometry, 0), "bezier");
  assert.equal(geometry.topology.closed[0], 1);
  const points = primitivePoints(geometry, 0);
  const at = (index) => [
    geometry.point.P.data[points[index] * 2],
    geometry.point.P.data[points[index] * 2 + 1],
  ];
  assert.deepEqual(at(0), [1, 0]);
  // Geometry is +Y up: the second anchor is above the origin, not below it.
  assert.deepEqual(at(3), [0, 1]);
  assert.deepEqual(at(6), [-1, 0]);
  assert.deepEqual(at(9), [0, -1]);
});

test("a polygonal Circle has the divisions its parameter claims", async () => {
  const { geometry } = await run(circleRegistration, {
    inputs: { divisions: 6, radius: [2, 2] },
    props: { type: "poly" },
  });
  assert.equal(geometry.pointCount, 6);
  assert.equal(geometry.vertexCount, 6);
  assert.equal(primitiveKind(geometry, 0), "poly");
  // Closed is topology, not a repeated vertex: six segments from six vertices.
  assert.equal(geometry.topology.closed[0], 1);
  assert.deepEqual(Array.from(geometry.point.P.data.slice(0, 2)), [2, 0]);
});

test("a malformed Bezier chain is refused rather than stored", () => {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 1, 1, 2, 0, 3, 1, 4, 0], { kind: "bezier" });
  assert.throws(
    () => builder.build(),
    (error) => /geometry\/bezier-arity/.test(error.message),
  );
});

test("Merge takes the union of disjoint attribute sets and zero-fills", async () => {
  const withWidth = new GeometryBuilder();
  withWidth.addPolygon([0, 0, 1, 0], {});
  withWidth.setNumericAttribute("primitive", "width", [0.4]);
  withWidth.setStringAttribute("primitive", "tag", ["FORM_04"]);
  const withColour = new GeometryBuilder();
  withColour.addPolygon([2, 0, 3, 0], {});
  withColour.setNumericAttribute("primitive", "Cd", [1, 0, 0], 3);

  const { geometry } = await run(mergeRegistration, {
    inputs: { inputs: [withWidth.build(), withColour.build()] },
  });
  assert.equal(geometry.primitiveCount, 2);
  assert.equal(geometry.pointCount, 4);
  // Neither operand had heard of the other's attribute, and nothing was lost:
  // absent is zero-filled, which is the whole argument for the attribute table.
  assert.deepEqual(Object.keys(geometry.primitive).sort(), [
    "Cd",
    "tag",
    "width",
  ]);
  assert.deepEqual(Array.from(geometry.primitive.width.data), [0.4, 0]);
  assert.deepEqual(Array.from(geometry.primitive.Cd.data), [0, 0, 0, 1, 0, 0]);
  assert.equal(readAttribute(geometry.primitive.tag, 0), "FORM_04");
  assert.equal(readAttribute(geometry.primitive.tag, 1), "");
});

test("Merge widens a colliding name in size and in storage", async () => {
  const narrow = new GeometryBuilder();
  narrow.addPolygon([0, 0, 1, 0], {});
  narrow.setNumericAttribute("primitive", "mark", [7], 1, "i32");
  const wide = new GeometryBuilder();
  wide.addPolygon([2, 0, 3, 0], {});
  wide.setNumericAttribute("primitive", "mark", [0.5, 1.5], 2, "f32");

  const { geometry } = await run(mergeRegistration, {
    inputs: { inputs: [narrow.build(), wide.build()] },
  });
  const mark = geometry.primitive.mark;
  // The widening rules belong to the merge op; this asserts them rather than
  // re-deciding them. i32 meeting f32 goes to f64 because f32's 24-bit mantissa
  // cannot hold every i32 exactly.
  assert.equal(mark.size, 2);
  assert.equal(mark.storage, "f64");
  assert.deepEqual(Array.from(mark.data), [7, 0, 0.5, 1.5]);
});

test("Merge refuses a name that is a string on one side and numeric on the other", () => {
  const numeric = new GeometryBuilder();
  numeric.addPolygon([0, 0, 1, 0], {});
  numeric.setNumericAttribute("primitive", "tag", [3]);
  const strings = new GeometryBuilder();
  strings.addPolygon([2, 0, 3, 0], {});
  strings.setStringAttribute("primitive", "tag", ["LOBE_11"]);
  assert.throws(
    () => mergeGeometry(numeric.build(), strings.build()),
    (error) => /geometry\/attribute-conflict/.test(error.message),
  );
});

test("CopyToPoints puts a copy at every target point and carries its attributes", async () => {
  const source = new GeometryBuilder();
  source.addPolygon([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], {
    closed: true,
  });
  source.setNumericAttribute("primitive", "width", [0.2]);
  source.setStringAttribute("primitive", "tag", ["FORM_04"]);
  const target = new GeometryBuilder();
  target.addPoint(0, 0);
  target.addPoint(10, 0);
  target.addPoint(10, 10);

  const { geometry } = await run(copyToPointsRegistration, {
    inputs: { source: source.build(), target: target.build() },
  });
  assert.equal(geometry.primitiveCount, 3);
  assert.equal(geometry.pointCount, 12);
  assert.equal(geometry.vertexCount, 12);
  // The source's own primitive attributes ride along onto every copy.
  assert.deepEqual(Array.from(geometry.primitive.width.data), [0.2, 0.2, 0.2]);
  for (let primitive = 0; primitive < 3; primitive += 1)
    assert.equal(readAttribute(geometry.primitive.tag, primitive), "FORM_04");
  // Houdini's name for which point a copy came from.
  assert.deepEqual(Array.from(geometry.primitive.copynum.data), [0, 1, 2]);
  assert.deepEqual(Array.from(geometry.point.P.data.slice(0, 2)), [-0.5, -0.5]);
  assert.deepEqual(Array.from(geometry.point.P.data.slice(8, 10)), [9.5, -0.5]);
});

test("CopyToPoints reads pscale and N, and honours a target group", () => {
  const source = rectangleGeometry({ size: [2, 2] });
  const builder = new GeometryBuilder();
  builder.addPoint(0, 0);
  builder.addPoint(4, 0);
  builder.setNumericAttribute("point", "pscale", [0.5, 2]);
  builder.setNumericAttribute("point", "N", [1, 0, 0, 1], 2);
  const target = setGroup(builder.build(), "point", "second", [1]);

  const scaled = copyToPoints(source, target);
  assert.equal(scaled.primitiveCount, 2);
  // First copy at half size around the origin.
  assert.deepEqual(Array.from(scaled.point.P.data.slice(0, 2)), [-0.5, -0.5]);
  // Second copy is doubled and turned a quarter turn by N = (0, 1).
  assert.deepEqual(Array.from(scaled.point.P.data.slice(8, 10)), [6, -2]);
  // The target's own point attributes transfer onto the copies' points.
  assert.deepEqual(Array.from(scaled.point.pscale.data), [
    0.5, 0.5, 0.5, 0.5, 2, 2, 2, 2,
  ]);

  const restricted = copyToPoints(source, target, { targetGroup: "second" });
  assert.equal(restricted.primitiveCount, 1);
  assert.deepEqual(Array.from(restricted.primitive.copynum.data), [1]);
  assert.equal(copyToPoints(source, emptyGeometry(2)).primitiveCount, 0);
});

test("SvgExport emits one group per group, the Y flip, and per-primitive Cd", async () => {
  const builder = new GeometryBuilder();
  builder.addPolygon([0, 0, 4, 0, 4, 2, 0, 2], { closed: true });
  builder.addPolygon([0, 4, 4, 4]);
  builder.addPolygon([0, 6, 4, 6]);
  builder.addPoint(2, 8);
  builder.setNumericAttribute("primitive", "Cd", [
    1, 0.5, 0, 0, 0, 0, 0, 0, 0,
  ], 3);
  builder.setNumericAttribute("primitive", "width", [3, 1, 1]);
  builder.addToPrimitiveGroup("pen1", 0);
  builder.addToPrimitiveGroup("pen2", 1);
  const geometry = builder.build();

  const written = [];
  const { svg, asset } = await run(svgExportRegistration, {
    inputs: { geometry },
    props: { filename: "plate.svg", strokeWidth: 0.5 },
    capabilities: assetCapability(written),
  });

  // One <g id> per primitive group, in insertion order, plus the leftovers.
  assert.deepEqual(svg.match(/<g id="[^"]+"/g), [
    '<g id="pen1"',
    '<g id="pen2"',
    '<g id="ungrouped"',
  ]);
  // The flip is one transform on the root group and nothing upstream knows.
  assert.match(svg, /<g transform="scale\(1,-1\)"/);
  assert.match(svg, /viewBox="0 -8 4 8"/);
  // +Y up geometry lands at negative SVG y after the flip.
  assert.match(svg, /<path d="M 0 4 L 4 4"/);
  // The prop is the fallback and the attribute wins where it exists.
  assert.match(svg, /stroke="#000000" stroke-width="0.5"/);
  assert.match(svg, /stroke="#ff8000" stroke-width="3"/);
  // A loose point is a dot, drawn at the prop's radius.
  assert.match(svg, /<circle cx="2" cy="8" r="0.5"/);
  assert.deepEqual(asset, {
    path: "/assets/plate.svg",
    mediaType: "image/svg+xml",
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].data.length, Buffer.byteLength(svg, "utf8"));
});

test("SvgExport writes C commands for a curve and L commands for a polyline", () => {
  const curve = geometryToSvg(circleGeometry({ radius: [1, 1] }), {
    precision: 4,
  });
  assert.equal((curve.match(/ C /g) ?? []).length, 4);
  assert.doesNotMatch(curve, / L /);
  assert.match(curve, /d="M 1 0 C 1 0\.5523 0\.5523 1 0 1/);
  assert.match(curve, /Z"/);

  const polygon = geometryToSvg(
    circleGeometry({ radius: [1, 1], type: "poly", divisions: 4 }),
  );
  assert.equal((polygon.match(/ L /g) ?? []).length, 3);
  assert.doesNotMatch(polygon, / C /);
});

test("resample refuses a curve rather than reading its handles as vertices", () => {
  assert.throws(
    () => resampleGeometry(circleGeometry({}), { count: 16 }),
    (error) => /geometry\/curve-resample/.test(error.message),
  );
  // A geometry with no curve in it resamples as before.
  const line = new GeometryBuilder();
  line.addPolygon([0, 0, 4, 0]);
  assert.equal(resampleGeometry(line.build(), { count: 5 }).pointCount, 5);
});

test("an operation that only reads positions is untouched by a curve", () => {
  const curve = circleGeometry({ center: [1, 1], radius: [1, 1] });
  const moved = copyToPoints(curve, rectangleGeometry({ size: [10, 10] }));
  assert.equal(moved.primitiveCount, 4);
  assert.equal(primitiveKind(moved, 0), "bezier");
  const merged = mergeGeometry(curve, rectangleGeometry({ size: [2, 2] }));
  assert.equal(primitiveKind(merged, 0), "bezier");
  assert.equal(primitiveKind(merged, 1), "poly");
  // createGeometry is the one place the arity is checked, so a merge that
  // renumbered a Bezier chain wrongly would fail here rather than downstream.
  assert.equal(merged.pointCount, 16);
});

test("createGeometry keeps a hand-built curve honest about its closure", () => {
  assert.throws(
    () =>
      createGeometry({
        pointCount: 4,
        point: {
          P: { storage: "f64", size: 2, data: Float64Array.of(0, 0, 1, 1, 2, 1, 3, 0) },
        },
        topology: {
          vertexPoints: Int32Array.of(0, 1, 2, 3),
          offsets: Int32Array.of(0, 4),
          kinds: Uint8Array.of(1),
          closed: Uint8Array.of(1),
        },
      }),
    (error) => /geometry\/bezier-arity/.test(error.message),
  );
});

test("four of the six compose into one SVG through the runtime", async () => {
  const written = [];
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async () => null },
      ...assetCapability(written),
    }),
  });
  const graph = await runtime.load({
    version: "0.2",
    nodes: [
      {
        id: "plate",
        module: "cascade.geo.Rectangle",
        inputs: { size: [8, 4], center: [0, 0] },
      },
      {
        id: "dot",
        module: "cascade.geo.Circle",
        inputs: { radius: [1, 1], divisions: 4 },
        props: { type: "poly" },
      },
      { id: "copies", module: "cascade.geo.CopyToPoints" },
      { id: "all", module: "cascade.geo.Merge" },
      {
        id: "moved",
        module: "cascade.geo.Transform",
        inputs: { translate: [4, 2] },
      },
      {
        id: "out",
        module: "cascade.geo.SvgExport",
        props: { filename: "composed.svg", precision: 2 },
      },
    ],
    connections: [
      [["dot", 0, "geometry"], ["copies", 0, "source"]],
      [["plate", 0, "geometry"], ["copies", 0, "target"]],
      [["plate", 0, "geometry"], ["all", 0, "inputs"]],
      [["copies", 0, "geometry"], ["all", 0, "inputs"]],
      [["all", 0, "geometry"], ["moved", 0, "input"]],
      [["moved", 0, "geometry"], ["out", 0, "geometry"]],
    ],
  });
  const result = await graph.run({
    target: { kind: "output", nodeId: "out", outputName: "svg" },
  });
  assert.equal(result.status, "completed");

  // The claim the whole slice makes: a plate, a shape copied onto each of its
  // corners, merged, moved, and written out as one file.
  assert.equal(
    graph.getOutput("out", "svg"),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="-1 -5 10 6">',
      "  <!-- Geometry is +Y up; SVG is +Y down. This is the one flip. -->",
      '  <g transform="scale(1,-1)" fill="none" stroke="#000000" stroke-width="1">',
      '    <path d="M 0 0 L 8 0 L 8 4 L 0 4 Z" />',
      '    <path d="M 1 0 L 0 1 L -1 0 L 0 -1 Z" />',
      '    <path d="M 9 0 L 8 1 L 7 0 L 8 -1 Z" />',
      '    <path d="M 9 4 L 8 5 L 7 4 L 8 3 Z" />',
      '    <path d="M 1 4 L 0 5 L -1 4 L 0 3 Z" />',
      "  </g>",
      "</svg>",
      "",
    ].join("\n"),
  );
  assert.equal(written.length, 1);
  assert.equal(written[0].metadata.suggestedName, "composed.svg");
  await runtime.dispose();
});

test("Transform rotates counter-clockwise about its pivot", async () => {
  const { geometry } = await run(transformRegistration, {
    inputs: {
      input: rectangleGeometry({ size: [2, 4], center: [1, 2] }),
      rotate: 90,
      pivot: [1, 2],
    },
  });
  const rounded = Array.from(geometry.point.P.data).map((value) =>
    Number(value.toFixed(6)),
  );
  // The bottom-left corner turns a quarter turn to the bottom-right.
  assert.deepEqual(rounded.slice(0, 2), [3, 1]);
  assert.deepEqual(rounded.slice(2, 4), [3, 3]);
});
