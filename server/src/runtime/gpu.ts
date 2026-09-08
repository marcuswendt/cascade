/**
 * `cascade/gpu` — WebGPU's flag namespaces as plain values.
 *
 * Small, and it was load-bearing. TypeScript's DOM library declares the WebGPU
 * *interfaces* but not the constant objects, so the only way to reach
 * `GPUTextureUsage.RENDER_ATTACHMENT` was off `globalThis` — which
 * `architecture/ambient-state` correctly forbids inside a node module, because
 * an ambient read makes a node's inputs invisible to the static reader that
 * lets `cascade check` say anything without cooking.
 *
 * So a sketch had to choose between a rule and a working shader, and it chose
 * a project library file to hide the read in. Both stay honest now: the rule
 * keeps its teeth and a node imports these instead. That is the whole reason
 * this file exists, and it is why it had to land with the capability rather
 * than after it — a rule whose only workaround is removed at the same moment
 * is a rule; one enforced a release earlier is a nuisance.
 *
 * The values are fixed by the WebGPU specification, not by an implementation,
 * which is what makes writing them down safe rather than a guess. They are
 * checked against a real browser's own globals in `tests/gpu-usage-flags.test.ts`
 * — the numbers below were verified against Chrome rather than recalled.
 */

/** `GPUBufferUsage`. */
export const BufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const;

/** `GPUTextureUsage`. */
export const TextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
  /**
   * Chrome 147 has this and it is newer than the rest — verified present
   * 2026-09-08 alongside the others, but do not assume every implementation
   * carries it. Included rather than omitted deliberately: leaving it out
   * would send a node that wants it back to `globalThis`, which is the exact
   * ambient read this file exists to remove, so an honest constant with a
   * caveat beats an omission that forces a rule violation.
   */
  TRANSIENT_ATTACHMENT: 0x20,
} as const;

/** `GPUShaderStage`, for a bind group layout entry's `visibility`. */
export const ShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;

/** `GPUMapMode`, for `buffer.mapAsync`. */
export const MapMode = {
  READ: 0x1,
  WRITE: 0x2,
} as const;

/** `GPUColorWrite`, for a colour target's `writeMask`. */
export const ColorWrite = {
  RED: 0x1,
  GREEN: 0x2,
  BLUE: 0x4,
  ALPHA: 0x8,
  ALL: 0xf,
} as const;
