/**
 * Geometry operations. Environment-neutral arithmetic over the `geometry`
 * contract type: no DOM, no Node, no dependencies.
 *
 * The types, the interchange form and the codec live in
 * `packages/contracts/src/geometry.ts`, and its header carries the
 * copy-on-write rule and the one runtime interaction worth knowing about.
 * Everything that computes lives here, so that a Studio preview or a
 * compatibility node adapts these semantics rather than forking them.
 */
export * from "./attributes.js";
export * from "./builder.js";
export * from "./copy.js";
export * from "./generate.js";
export * from "./groups.js";
export * from "./matrix.js";
export * from "./merge.js";
export * from "./primitives.js";
export * from "./promote.js";
export * from "./rects.js";
export * from "./resample.js";
export * from "./svg.js";
export * from "./transform.js";
