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

/** Read one single-sample rgba8unorm 2D texture into owned, tightly packed
 * top-left RGBA bytes. No colour conversion, PNG encoding or graph transport.
 * The caller owns the source texture and must give it COPY_SRC usage.
 */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  options: { signal?: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  } } = {},
): Promise<{ data: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const { signal } = options;
  if (signal?.aborted) throw new Error('GPU readback aborted');
  if (texture.format !== 'rgba8unorm' || texture.dimension !== '2d'
    || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1
    || !(texture.usage & TextureUsage.COPY_SRC)) {
    throw new Error('GPU readback requires a single-sample rgba8unorm 2D texture with COPY_SRC usage');
  }
  const { width, height } = texture;
  const rowBytes = width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  let buffer: GPUBuffer | undefined;
  let mapped = false;
  let abort: (() => void) | undefined;
  let errorScopeOpen = false;
  try {
    device.pushErrorScope('validation');
    errorScopeOpen = true;
    buffer = device.createBuffer({
      label: 'Cascade RGBA readback', size: bytesPerRow * height,
      usage: BufferUsage.COPY_DST | BufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    const validation = device.popErrorScope();
    errorScopeOpen = false;
    const completion = Promise.allSettled([buffer.mapAsync(MapMode.READ), validation]);
    let completed: Awaited<typeof completion>;
    if (signal) {
      completed = await Promise.race([completion, new Promise<never>((_, reject) => {
        abort = () => reject(new Error('GPU readback aborted'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } else completed = await completion;
    const mappingResult = completed[0];
    const validationResult = completed[1];
    if (validationResult.status === 'rejected') throw validationResult.reason;
    const validationError = validationResult.value;
    if (validationError) throw new Error(`GPU readback validation failed: ${validationError.message}`);
    if (mappingResult.status === 'rejected') throw mappingResult.reason;
    mapped = true;
    if (signal?.aborted) throw new Error('GPU readback aborted');
    const source = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) data.set(source.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
    return { data, width, height };
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    if (errorScopeOpen) {
      try { await device.popErrorScope(); }
      catch { /* Preserve the operation's original failure. */ }
    }
    if (mapped) buffer?.unmap();
    buffer?.destroy();
  }
}
