/**
 * `cascade parity` on a GPU node, under the Dawn hardware gate: a seeded node
 * draws 400 overlapping, alpha-blended triangles into an rgba8unorm target and
 * reports a hash of the pixels. Blending in a render pass is applied in draw
 * order, so the result must repeat headless and match through Studio's path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parity } from '@/cli/parity';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const gpuModule = path.resolve('server/src/runtime/gpu.ts');
const triangles = `
import { BufferUsage, readTexture, TextureUsage } from ${JSON.stringify(gpuModule)};
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['gpu'],
  outputs: { pixels: { kind: 'data', type: 'string' } },
} as const;
export async function execute(context) {
  const shader = \`
struct V { @builtin(position) p: vec4f, @location(0) c: vec4f };
@vertex fn vs(@location(0) p: vec2f, @location(1) c: vec4f) -> V { return V(vec4f(p, 0, 1), c); }
@fragment fn fs(v: V) -> @location(0) vec4f { return v.c; }\`;
  const gpu = context.capabilities.gpu;
  const device = gpu.device;
  const target = gpu.cache('target', (d) => d.createTexture({ size: [96, 96], format: 'rgba8unorm',
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC }), (t) => t.destroy());
  const count = 400;
  const data = new Float32Array(count * 3 * 6);
  for (let i = 0; i < data.length; i += 6) {
    data[i] = context.random() * 2 - 1; data[i + 1] = context.random() * 2 - 1;
    data[i + 2] = context.random(); data[i + 3] = context.random(); data[i + 4] = context.random(); data[i + 5] = 0.3;
  }
  const buffer = device.createBuffer({ size: data.byteLength, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  const module = device.createShaderModule({ code: shader });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
    clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setVertexBuffer(0, buffer); pass.draw(count * 3); pass.end();
  device.queue.submit([encoder.finish()]);
  const pixels = await readTexture(device, target);
  buffer.destroy();
  let hash = 0x811c9dc5;
  for (const byte of pixels.data) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  context.outputs.pixels.set(hash.toString(16));
}
`;

describe.skipIf(process.env.CASCADE_TEST_DAWN !== '1')('parity on a GPU node (Dawn)', () => {
  it('repeats headless and agrees with the Studio path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-parity-gpu-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'nodes', 'Triangles'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nodes', 'Triangles', 'index.ts'), triangles);
    const file = path.join(root, 'index.cascade');
    fs.writeFileSync(file, JSON.stringify({ version: '0.2', seed: 12, nodes: [{ id: 'tri', module: 'project.Triangles', source: 'project' }], connections: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await parity({ file, tolerance: 0, json: false, studio: true });
    expect(report.failures).toEqual({});
    expect(report.ports).toEqual([expect.objectContaining({ node: 'tri', port: 'pixels', repeat: { verdict: 'same' }, studio: { verdict: 'same' } })]);
  }, 60_000);
});
