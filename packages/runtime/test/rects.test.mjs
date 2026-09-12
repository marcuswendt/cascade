import assert from "node:assert/strict";
import test from "node:test";

import { rectsToGeometry, isRectLike } from "../dist/index.js";
import { executeFromRects, fromRectsRegistration } from "../dist/builtins/geo/index.js";

/**
 * `rects` into `geometry`.
 *
 * `rects` has been a declared core type with zero consumers: nothing converted
 * it, `SvgExport` takes only `geometry`, and `cloud-plots` rendered its rects
 * through its own Python export instead. Marcus decided on 2026-09-12 that the
 * conversion lands now.
 *
 * The two things worth testing are the two that can destroy data silently:
 * **the tag**, which carries the region label from `vision.label_regions` and
 * would show up as unlabelled marks in a poster rather than as an error; and
 * **the flip**, because raster rects passed through unflipped come out of the
 * SVG writer mirrored, which looks plausible.
 *
 * The shape of the incoming value was measured by MW-OBSERVATORY-ART as the
 * owner of the producing code, not remembered from the contract — and the two
 * disagree, which is why both are accepted.
 */

const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
const progress = { report() {} };

/** What `cloud-plots`' `node_cli.py` actually emits. */
const tagged = (x, y, w, h, tag) => ({ rect: [x, y, w, h], tag });
/** What `packages/contracts` declares. */
const declared = (x, y, width, height, tag) => ({ x, y, width, height, ...(tag ? { tag } : {}) });

function positions(geometry) {
  return Array.from(geometry.point.P.data);
}

function run(inputs = {}, props = {}) {
  const definition = fromRectsRegistration.definition;
  const values = {};
  const outputs = { geometry: { set: (value) => (values.geometry = value) } };
  const propDefaults = {};
  for (const [name, prop] of Object.entries(definition.props ?? {}))
    propDefaults[name] = prop.default;
  executeFromRects({
    nodeId: "test",
    inputs,
    outputs,
    props: { ...propDefaults, ...props },
    capabilities: {},
    signal,
    progress,
  });
  return values.geometry;
}

test("one closed four-point polygon per rect", () => {
  const geometry = rectsToGeometry({ rects: [declared(0, 0, 2, 1), declared(5, 5, 1, 1)] });
  assert.equal(geometry.primitiveCount, 2);
  assert.equal(geometry.pointCount, 8);
  // Closed is topology, not a repeated vertex — four points, not five.
  assert.equal(geometry.topology.closed[0], 1);
});

test("the producer's shape and the contract's shape give the same geometry", () => {
  // The contract declares {x, y, width, height} and cloud-plots emits
  // {rect: [x, y, w, h]}. Refusing either would mean the conversion works for
  // nothing that exists, or nothing that is written down.
  const fromTagged = rectsToGeometry([tagged(1, 2, 3, 4, "sky")]);
  const fromDeclared = rectsToGeometry([declared(1, 2, 3, 4, "sky")]);
  assert.deepEqual(positions(fromTagged), positions(fromDeclared));
  assert.deepEqual(
    Array.from(fromTagged.primitive.tag.data),
    Array.from(fromDeclared.primitive.tag.data),
  );
});

test("the tag survives as a primitive string attribute", () => {
  // The condition MW-OBSERVATORY-ART set, and the reason: a conversion that
  // keeps the four numbers and drops the tag destroys the labelling, and it
  // shows up as unlabelled marks in a poster rather than as an error.
  const geometry = rectsToGeometry([
    tagged(0, 0, 1, 1, "sky"),
    tagged(2, 0, 1, 1, "cloud form"),
  ]);
  assert.equal(geometry.primitive.tag.storage, "string");
  const read = (index) =>
    geometry.primitive.tag.table[geometry.primitive.tag.data[index]];
  assert.equal(read(0), "sky");
  assert.equal(read(1), "cloud form");
});

test("an untagged set carries no tag attribute at all", () => {
  // A column of empty strings on every primitive is noise in the Inspector and
  // in every exported file.
  const geometry = rectsToGeometry([declared(0, 0, 1, 1)]);
  assert.equal(geometry.primitive.tag, undefined);
});

test("a partly tagged set keeps the gaps rather than shifting the labels", () => {
  // The failure this catches would be the worst available: labels silently
  // moving to the wrong marks.
  const geometry = rectsToGeometry([
    tagged(0, 0, 1, 1, "sky"),
    declared(2, 0, 1, 1),
    tagged(4, 0, 1, 1, "horizon"),
  ]);
  const read = (index) =>
    geometry.primitive.tag.table[geometry.primitive.tag.data[index]];
  assert.equal(read(0), "sky");
  assert.equal(read(1), "");
  assert.equal(read(2), "horizon");
});

test("top-left flips about the frame, so raster rects are not mirrored", () => {
  // A rect 10 tall whose top edge is at y=20, in a 100-tall image, has its
  // bottom edge 70 above the origin once flipped.
  const geometry = rectsToGeometry([declared(0, 20, 5, 10)], {
    origin: "top-left",
    height: 100,
  });
  const ys = positions(geometry).filter((_, index) => index % 2 === 1);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [70, 80]);
});

test("bottom-left passes the numbers through", () => {
  const geometry = rectsToGeometry([declared(0, 20, 5, 10)], { origin: "bottom-left" });
  const ys = positions(geometry).filter((_, index) => index % 2 === 1);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [20, 30]);
});

test("the flip is about the frame, not about the rects", () => {
  // Flipping about the tallest rect would look right on a full-height mark and
  // be wrong on every other one — which is why the height is required rather
  // than inferred.
  const short = rectsToGeometry([declared(0, 0, 1, 1)], { origin: "top-left", height: 100 });
  const ys = positions(short).filter((_, index) => index % 2 === 1);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [99, 100]);
});

test("a malformed rect is skipped and counted, not fatal and not silent", () => {
  const geometry = rectsToGeometry([
    declared(0, 0, 1, 1),
    { rect: [0, Number.NaN, 1, 1] },
    { nonsense: true },
    declared(2, 0, 1, 1),
  ]);
  assert.equal(geometry.primitiveCount, 2);
  assert.equal(geometry.detail.rects_skipped, 2);
});

test("a clean set carries no skipped detail", () => {
  const geometry = rectsToGeometry([declared(0, 0, 1, 1)]);
  assert.equal(geometry.detail.rects_skipped, undefined);
});

test("nothing in gives empty geometry rather than a throw", () => {
  for (const value of [null, undefined, [], { rects: [] }])
    assert.equal(rectsToGeometry(value).primitiveCount, 0);
});

test("isRectLike accepts both shapes and refuses the rest", () => {
  assert.equal(isRectLike(tagged(0, 0, 1, 1, "x")), true);
  assert.equal(isRectLike(declared(0, 0, 1, 1)), true);
  assert.equal(isRectLike({ rect: [0, 0] }), false);
  assert.equal(isRectLike({ x: 0, y: 0 }), false);
  assert.equal(isRectLike("rect"), false);
});

test("the node refuses a raster conversion with no height", () => {
  // The one mistake worth refusing: it produces a mirrored picture that looks
  // plausible, and a silently upside down poster is harder to notice than a
  // red node.
  assert.throws(
    () => run({ rects: [declared(0, 0, 1, 1)], height: 0 }, { origin: "top-left" }),
    /needs the image height to flip raster rects/,
  );
});

test("the node is fine with no height when there is nothing to convert", () => {
  // A half-built graph should not be red for a decision that has no effect yet.
  assert.equal(run({ rects: [], height: 0 }, { origin: "top-left" }).primitiveCount, 0);
});

test("the node is fine with no height in bottom-left", () => {
  assert.equal(
    run({ rects: [declared(0, 0, 1, 1)], height: 0 }, { origin: "bottom-left" }).primitiveCount,
    1,
  );
});

test("the node declares rects in and geometry out, and nothing else learns about rects", () => {
  assert.equal(fromRectsRegistration.definition.inputs.rects.type, "rects");
  assert.equal(fromRectsRegistration.definition.outputs.geometry.type, "geometry");
});
