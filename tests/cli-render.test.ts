/**
 * `cascade render`: arguments, worker count, batching, progress and the
 * fixed-path check, without rendering anything. The real renders (worker
 * processes, ffmpeg) are in tests/e2e/cli-render.e2e.test.ts, the `e2e`
 * project, which `vitest related` leaves out.
 */
import { describe, expect, it } from 'vitest';
import { defaultWorkers, nextBatch, parseRenderArgs, progressLine, sharedOutputPaths } from '@/cli/render';

describe('cascade render arguments', () => {
  it('previews by default; --prores implies full size; unknown flags are fatal', () => {
    expect(parseRenderArgs(['g.cascade'])).toEqual({ file: 'g.cascade' });
    expect(parseRenderArgs(['g.cascade', '--prores'])).toMatchObject({ prores: true, final: true });
    expect(parseRenderArgs(['g.cascade', '--workers', '3', '--node', 'a', '--node', 'b', '--job', 'job_1']))
      .toMatchObject({ workers: 3, nodes: ['a', 'b'], job: 'job_1' });
    expect(() => parseRenderArgs(['g.cascade', '--worker', '3'])).toThrow(/Unknown render option/);
    expect(() => parseRenderArgs(['g.cascade', '--workers', '0'])).toThrow(/--workers/);
    expect(() => parseRenderArgs(['g.cascade', '--no-video', '--final'])).toThrow(/--no-video/);
  });

  it('leaves a few cores free', () => {
    expect(defaultWorkers(16)).toBe(12);
    expect(defaultWorkers(10)).toBe(7);
    expect(defaultWorkers(2)).toBe(1);
    expect(defaultWorkers(1)).toBe(1);
  });

  it('hands out big contiguous batches first and single frames at the end', () => {
    const remaining = Array.from({ length: 40 }, (_, index) => index + 1);
    expect(nextBatch(remaining, 4)).toEqual([1, 2, 3, 4, 5]);
    const sizes: number[] = [];
    while (remaining.length) sizes.push(nextBatch(remaining, 4).length);
    expect(sizes.at(-1)).toBe(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(35);
  });

  it('reports progress with an ETA', () => {
    expect(progressLine(48, 144, 16_000)).toBe('48/144 frames (33%) · 3.0 fps · 0:16 elapsed · ETA 0:32');
    expect(progressLine(144, 144, 48_000)).toMatch(/done$/);
  });

  it('calls two frames written to one file a fixed path', () => {
    const frame = (frame: number, source: string) => ({ frame, durationMs: 1, outputs: [{ nodeId: 'n', source, file: `r/n.${frame}.png` }] });
    expect(sharedOutputPaths(frame(1, 'w/n.png'), frame(2, 'w/n.png'))).toEqual([{ nodeId: 'n', source: 'w/n.png' }]);
    expect(sharedOutputPaths(frame(1, 'w/n.1.png'), frame(2, 'w/n.2.png'))).toEqual([]);
  });

  it('lets two frames share a content-named cache file: same name, same bytes (a piece on twos)', () => {
    const frame = (frame: number, source: string) => ({ frame, durationMs: 1, outputs: [{ nodeId: 'n', source, file: `r/n.${frame}.png` }] });
    expect(sharedOutputPaths(frame(0, '.cascade-cache/ripple.0123456789ab.png'), frame(1, '.cascade-cache/ripple.0123456789ab.png'))).toEqual([]);
    // A fixed name in the cache, or a hash-looking name outside it, is still a clobber.
    expect(sharedOutputPaths(frame(0, '.cascade-cache/ripple.png'), frame(1, '.cascade-cache/ripple.png'))).toHaveLength(1);
    expect(sharedOutputPaths(frame(0, 'out/ripple.0123456789ab.png'), frame(1, 'out/ripple.0123456789ab.png'))).toHaveLength(1);
  });
});
