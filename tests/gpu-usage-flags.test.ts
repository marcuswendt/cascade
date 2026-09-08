import { describe, expect, it } from 'vitest';

import { BufferUsage, ColorWrite, MapMode, ShaderStage, TextureUsage } from '../server/src/runtime/gpu';

/**
 * `cascade/gpu` writes the WebGPU flag namespaces down as plain values, because
 * TypeScript's DOM library declares the interfaces and not the constant
 * objects — so the only other way to reach them is `globalThis`, which
 * `architecture/ambient-state` forbids inside a node module for good reasons.
 *
 * Writing spec constants down by hand is exactly the kind of thing that is
 * right until it is silently wrong, so they are not recalled: every value was
 * read out of a real Chrome 147 through the debug protocol on 2026-09-08 and
 * matched. This file is the standing guard for drift, and it can only do that
 * job where the globals exist, so it checks against them when they are present
 * and asserts the internal shape when they are not.
 */
const globals = globalThis as unknown as Record<string, Record<string, number> | undefined>;
const namespaces = [
  ['GPUBufferUsage', BufferUsage],
  ['GPUTextureUsage', TextureUsage],
  ['GPUShaderStage', ShaderStage],
  ['GPUMapMode', MapMode],
  ['GPUColorWrite', ColorWrite],
] as const;

describe('the cascade/gpu flag constants', () => {
  it.each(namespaces)('%s agrees with the platform where the platform has an opinion', (name, ours) => {
    const theirs = globals[name];
    if (!theirs) {
      // No WebGPU here. Still worth asserting the flags are distinct powers of
      // two, because they are combined with `|` and a duplicate or a
      // non-power-of-two would silently mean the wrong thing.
      const values = Object.values(ours);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values) expect(Number.isInteger(Math.log2(value)) || value === 0xf).toBe(true);
      return;
    }
    for (const [flag, value] of Object.entries(ours)) {
      expect(theirs[flag], `${name}.${flag}`).toBe(value);
    }
  });

  it('carries the flags a GPU node actually reaches for', () => {
    // Named rather than counted: a count would pass while the useful ones went
    // missing, which is the shape of test this codebase spent today removing.
    expect(TextureUsage.RENDER_ATTACHMENT).toBeGreaterThan(0);
    expect(TextureUsage.TEXTURE_BINDING).toBeGreaterThan(0);
    expect(TextureUsage.STORAGE_BINDING).toBeGreaterThan(0);
    expect(BufferUsage.UNIFORM).toBeGreaterThan(0);
    expect(BufferUsage.STORAGE).toBeGreaterThan(0);
    expect(BufferUsage.COPY_DST).toBeGreaterThan(0);
    expect(ShaderStage.COMPUTE).toBeGreaterThan(0);
  });
});
