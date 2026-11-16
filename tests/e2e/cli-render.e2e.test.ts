/**
 * `cascade render` end to end: a frame range across worker processes, then a
 * preview through ffmpeg.
 *
 * The workers are real processes running the TypeScript CLI under tsx, because
 * the thing being tested is the hand-off between them: the batches, the probe
 * that refuses a fixed work path before any other worker renders, and the
 * merged sequence. About 4.5 s, so this file is in the `e2e` project
 * (vitest.config.ts): full `verify` and `vitest run` include it, `vitest
 * related` for a runtime edit does not. The argument and batching cases are
 * in tests/cli-render.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraph } from '@/cli/runner';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderGraph, type RenderOptions } from '@/cli/render';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

const workerEntry = { script: path.resolve('src/cli/index.ts'), execArgv: ['--import', 'tsx'] };

/** A 4×4 grey frame whose level is the frame number: written through assets, so content-addressed. */
const rampSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: { level: { type: 'float', default: 0 } }
} as const;
export async function execute(context) {
  const level = Math.max(0, Math.min(255, Math.round(context.props.level * 10)));
  const header = 'P6\\n4 4\\n255\\n';
  const bytes = new Uint8Array(header.length + 48);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes.fill(level, header.length);
  context.outputs.image.set(await context.capabilities.assets.write(bytes, { mediaType: 'image/x-portable-pixmap', suggestedName: 'ramp.ppm' }, { signal: context.signal }));
}
`;

/** The same frame written to one fixed file every time, as ripple-plot did. */
const fixedSource = `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const definition = {
  apiVersion: 1,
  runsOn: 'server',
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: { level: { type: 'float', default: 0 } }
} as const;
export async function execute(context) {
  const here = fileURLToPath(import.meta.url);
  const root = here.slice(0, here.indexOf('/.cascade-cache/'));
  const header = 'P6\\n4 4\\n255\\n';
  const bytes = Buffer.alloc(header.length + 48, Math.round(context.props.level * 10));
  bytes.write(header, 0, 'latin1');
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, 'work', 'fixed.ppm'), bytes);
  context.outputs.image.set('work/fixed.ppm');
}
`;

function project(module: 'Ramp' | 'Fixed') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-render-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', module), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', module, 'index.ts'), module === 'Ramp' ? rampSource : fixedSource);
  const document = {
    version: '0.2',
    timeline: { fps: 12, start: 1, end: 8 },
    nodes: [{ id: 'ramp', module: `project.${module}`, props: { level: { value: 0, expression: '$F' } } }],
    connections: [],
  };
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file };
}

function quiet(options: RenderOptions): RenderOptions {
  return { workerEntry, log: () => {}, ...options };
}

describe('cascade render across workers', () => {
  it('renders the range on several workers into one sequence, as a serial run names it', async () => {
    const { root, file } = project('Ramp');
    const notes: string[][] = [];
    const result = await renderGraph(quiet({
      file, workers: 3, video: false, progressEvery: 4, job: 'job_test',
      cairn: async (args) => { notes.push(args); },
    }));
    expect(result.workers).toBe(3);
    expect(result.frames).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.files).toEqual(result.frames.map((frame) => `renders/ramp.000${frame}.ppm`));
    for (const frame of result.frames) {
      const bytes = fs.readFileSync(path.join(root, 'renders', `ramp.000${frame}.ppm`));
      expect(bytes.at(-1)).toBe(frame * 10);   // each file holds its own frame, not a neighbour's
    }
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.slice(0, 4)).toEqual(['jobs', 'update', 'job_test', '--note']);
    expect(notes.at(-1)![4]).toMatch(/Rendered 8 frames/);
  }, 60_000);

  it('refuses a node that writes every frame to one fixed file before the other workers render', async () => {
    const { root, file } = project('Fixed');
    await expect(renderGraph(quiet({ file, workers: 3, video: false }))).rejects.toThrow(/Cannot render in parallel: node "ramp" \(work\/fixed.ppm\) wrote frames 1 and 2/);
    expect(fs.readdirSync(path.join(root, 'renders')).sort()).toEqual(['ramp.0001.ppm', 'ramp.0002.ppm']);

    // One worker has nobody to collide with.
    const serial = await renderGraph(quiet({ file, workers: 1, video: false }));
    expect(serial.frames).toHaveLength(8);
  }, 60_000);

  it.skipIf(!hasFfmpeg)('encodes a half-size H.264 preview by default, full size with --final', async () => {
    const { root, file } = project('Ramp');
    const preview = await renderGraph(quiet({ file, frames: '1-6', workers: 2 }));
    expect(preview.videos.map((video) => [video.file, video.scale])).toEqual([['renders/ramp.preview.mp4', 0.5]]);
    const probe = (name: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
      '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', path.join(root, name)], { encoding: 'utf8' })).streams[0];
    expect(probe('renders/ramp.preview.mp4')).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', width: 2, height: 2, r_frame_rate: '12/1', nb_read_frames: '6' });

    const final = await renderGraph(quiet({ file, frames: '1-6', workers: 2, final: true }));
    expect(final.videos.map((video) => video.file)).toEqual(['renders/ramp.mp4']);
    expect(probe('renders/ramp.mp4')).toMatchObject({ width: 4, height: 4 });
  }, 90_000);
});

describe('run --frames --mp4', () => {
  /** ffmpeg was handed `<project>/<absolute out>/ramp.%04d.ppm` and found nothing. */
  it.skipIf(!hasFfmpeg)('encodes a sequence written to an absolute --out', async () => {
    const { root, file } = project('Ramp');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-render-out-'));
    roots.push(out);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runGraph({ file, frames: '1-4', out, mp4: 'ramp.mp4' });
    } finally {
      log.mockRestore();
    }
    expect(fs.readdirSync(out).filter((name) => name.endsWith('.ppm'))).toHaveLength(4);
    expect(fs.statSync(path.join(root, 'ramp.mp4')).size).toBeGreaterThan(0);
  }, 60_000);
});
