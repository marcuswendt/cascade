/**
 * The timeline saved with the graph, and `run --frames … --mp4`.
 *
 * From the cloud-wall flipbook port (ce07219, d62152f): fps, range and loop
 * were not saved, so Studio opened every graph at 30 fps and frames 1-250 and
 * H1 (24 fps, 594 frames) was set up by hand on each open; and `run --frames`
 * stopped at an image sequence, so every render needed an ffmpeg wrapper.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDeterministicProjectFrames } from '@/cli/projectRuntime';
import { runGraph } from '@/cli/runner';
import { timelineFrameSpec } from '@/cli/encode';
import { Graph } from '@/nodes/Graph';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const rampSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: { phase: { type: 'float', default: 0 } }
} as const;
export async function execute(context) {
  const level = Math.max(0, Math.min(255, Math.round(context.props.phase)));
  const header = 'P6\\n4 4\\n255\\n';
  const bytes = new Uint8Array(header.length + 48);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes.fill(level, header.length);
  context.outputs.image.set(await context.capabilities.assets.write(bytes, { mediaType: 'image/x-portable-pixmap', suggestedName: 'ramp.ppm' }, { signal: context.signal }));
}
`;

function project(timeline: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-timeline-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Ramp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Ramp', 'index.ts'), rampSource);
  const document = {
    version: '0.2',
    timeline,
    nodes: [{ id: 'ramp', module: 'project.Ramp', props: { phase: { value: 0, expression: '$FPS' } } }],
    connections: [],
  };
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file, document };
}

const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

describe('the timeline saved with the graph', () => {
  it('is the frame rate a headless render runs at unless --fps says otherwise', async () => {
    const { file, document } = project({ fps: 24, start: 1, end: 3, loop: false });
    const rendered = await renderDeterministicProjectFrames(file, document, { start: 1, end: 1, out: 'renders' });
    expect(rendered!.fps).toBe(24);
    const overridden = await renderDeterministicProjectFrames(file, document, { start: 1, end: 1, fps: 12, out: 'other' });
    expect(overridden!.fps).toBe(12);
  }, 30_000);

  it('gives --frames timeline its range, and says when there is none', () => {
    expect(timelineFrameSpec({ timeline: { start: 1, end: 594 } })).toEqual({ start: 1, end: 594 });
    expect(() => timelineFrameSpec({})).toThrow(/no saved timeline range/);
  });

  it('survives a Studio load and save', () => {
    const graph = Graph.fromJSON({ version: '0.2', nodes: [], connections: [], timeline: { fps: 24, start: 1, end: 594, loop: true } });
    expect(graph.timeline).toEqual({ fps: 24, start: 1, end: 594, loop: true });
    expect((graph.toJSON() as any).timeline).toEqual({ fps: 24, start: 1, end: 594, loop: true });
    expect('timeline' in (Graph.fromJSON({ version: '0.2', nodes: [], connections: [] }).toJSON() as any)).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)('run --frames --mp4', () => {
  it('renders the timeline and encodes it as H.264 yuv420p at its fps', async () => {
    const { root, file } = project({ fps: 24, start: 1, end: 6 });
    await runGraph({ file, frames: 'timeline', out: 'renders', mp4: 'renders/ramp.mp4', crf: 20 });
    const video = path.join(root, 'renders', 'ramp.mp4');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
      '-show_entries', 'stream=codec_name,pix_fmt,r_frame_rate,nb_read_frames', '-of', 'json', video], { encoding: 'utf8' })).streams[0];
    expect(probe).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', r_frame_rate: '24/1', nb_read_frames: '6' });
  }, 60_000);

  it('refuses a stepped range rather than encoding it at the wrong speed', async () => {
    const { file } = project({ fps: 24 });
    await expect(runGraph({ file, frames: '1-6x2', out: 'renders', mp4: 'renders/ramp.mp4' })).rejects.toThrow(/contiguous/);
  }, 60_000);
});
