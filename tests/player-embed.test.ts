// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mountPlayer } from '../src/player/embed.js';

describe('mountPlayer', () => {
  it('refuses cross-origin programmatic control before creating an iframe', async () => {
    const container = document.createElement('div');
    await expect(mountPlayer(container, { url: 'https://other.example/player.html' }))
      .rejects.toThrow(/same-origin/);
    expect(container.childElementCount).toBe(0);
  });

  it('passes controls in the same-origin URL and removes the iframe on dispose', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mounting = mountPlayer(container, {
      url: '/exports/demo/player.html',
      frame: 12,
      fps: 24,
      autoplay: true,
      output: { nodeId: 'render', port: 'image' },
    });
    const iframe = container.querySelector('iframe')!;
    const dispose = vi.fn();
    Object.assign(iframe.contentWindow!, {
      cascadePlayerReady: Promise.resolve({
        play() {}, pause() {}, seek: async () => {}, setInput: async () => {}, setProp: async () => {},
        getOutput: () => undefined, selectOutput: async () => {}, downloadOutput: async () => new Blob(),
        resize() {}, subscribe: () => () => {}, dispose,
        privateRuntime: 'must not escape the iframe',
      }),
    });
    iframe.dispatchEvent(new Event('load'));
    const controller = await mounting;
    expect(iframe.style.width).toBe('100%');
    expect(iframe.style.height).toBe('100%');
    expect(iframe.style.border).toBe('0px');
    expect(controller).not.toHaveProperty('privateRuntime');

    const url = new URL(iframe.src);
    expect(url.pathname).toBe('/exports/demo/player.html');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      frame: '12', fps: '24', autoplay: '1', outputNode: 'render', outputPort: 'image',
    });
    await controller.dispose();
    await controller.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
    container.remove();
  });

  it('removes a failed iframe rather than leaving a broken embed behind', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const mounting = mountPlayer(container, { url: '/failed/player.html' });
    const iframe = container.querySelector('iframe')!;
    Object.assign(iframe.contentWindow!, {
      cascadePlayerReady: Promise.reject(new Error('failed first cook')),
    });
    iframe.dispatchEvent(new Event('load'));

    await expect(mounting).rejects.toThrow('failed first cook');
    expect(container.childElementCount).toBe(0);
    container.remove();
  });
});
