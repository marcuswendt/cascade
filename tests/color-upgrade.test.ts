/**
 * The class image nodes saved colours as `{ r, g, b, a? }`; definition-v1 reads
 * a `color` prop as four components only. `Color.upgrade` is the migration the
 * runtime applies to every stored colour on load.
 */
import { describe, expect, it } from 'vitest';
import { Color } from '../packages/contracts/src/index.js';
import { createBrowserRuntimeHost } from '../packages/runtime/src/browser.js';
import { createRuntime } from '../packages/runtime/src/index.js';

describe('Color.upgrade', () => {
  it('reads the older shapes as the one colour', () => {
    expect(Color.upgrade({ r: 0.3, g: 0.6, b: 0.9 })).toEqual([0.3, 0.6, 0.9, 1]);
    expect(Color.upgrade({ r: 1, g: 0, b: 0, a: 0.5 })).toEqual([1, 0, 0, 0.5]);
    expect(Color.upgrade({ r: 255, g: 51, b: 0, a: 255 })).toEqual([1, 51 / 255, 0, 1]);
    expect(Color.upgrade([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3, 1]);
    expect(Color.upgrade([255, 0, 0])).toEqual([1, 0, 0, 1]);
  });

  it('leaves everything else alone', () => {
    expect(Color.upgrade([0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(Color.upgrade('#ff0000')).toBe('#ff0000');
    expect(Color.upgrade({ r: 'x', g: 0, b: 0 })).toEqual({ r: 'x', g: 0, b: 0 });
    expect(Color.upgrade(null)).toBeNull();
  });

  it('lets a graph saved by the class nodes load in the runtime', async () => {
    const runtime = createRuntime({ host: createBrowserRuntimeHost({ modules: { resolve: async () => null } }) });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{ id: 'color', module: 'cascade.image.Color', props: { color: { r: 0.3, g: 0.6, b: 0.9 } } }],
      connections: [],
    } as never);
    expect(graph.inspect().nodes.find((node: { id: string }) => node.id === 'color')).toMatchObject({
      props: { color: { type: 'color', value: [0.3, 0.6, 0.9, 1] } },
    });
    await graph.dispose();
    await runtime.dispose();
  });
});
