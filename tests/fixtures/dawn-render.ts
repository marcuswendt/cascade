import assert from 'node:assert/strict';
import { createDawnGpuHost } from '../../src/cli/headlessGpu';
import { readTexture, TextureUsage } from '../../server/src/runtime/gpu';

// Executed in a child with a hard timeout. Never process.exit(): natural exit
// after repeated disposal is the regression this test needs to detect.
for (let cycle = 0; cycle < 3; cycle++) {
  const host = createDawnGpuHost();
  try {
    await host.ensure();
    const texture = host.forNode('render').cache('target', (device) => device.createTexture({
      size: [65, 3], format: 'rgba8unorm', usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC,
    }), (texture) => texture.destroy());
    for (let frame = 0; frame < 2; frame++) {
      const encoder = host.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(),
        clearValue: { r: frame, g: cycle / 2, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.end();
      host.device.queue.submit([encoder.finish()]);
      const pixels = await readTexture(host.device, texture);
      assert.equal(pixels.data.length, 65 * 3 * 4);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        assert.deepEqual([...pixels.data.subarray(offset, offset + 4)], [frame * 255, Math.round(cycle * 255 / 2), 0, 255]);
      }
    }
    console.log(JSON.stringify({ cycle, adapter: host.adapterInfo }));
  } finally { await host.dispose(); }
}
