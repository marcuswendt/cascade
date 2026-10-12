/**
 * `cascade run --frames … --mp4 <file>`: the rendered sequence as a video.
 *
 * The cloud-wall flipbooks were eight wrapper scripts around ffmpeg because
 * `run --frames` stopped at an image sequence. This is that last step, once:
 * H.264, yuv420p (what every player and phone plays), a CRF the run names, at
 * the frame rate the sequence was evaluated at, so the video's timing is the
 * graph's timing. ffmpeg is a tool on the machine, not a dependency of Cascade.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FrameSpec } from './frames.js';

const run = promisify(execFile);

/** Default quality: visually lossless for flat generative work, small enough to send. */
export const DEFAULT_CRF = 18;

export interface EncodedVideo {
  /** Project-relative. */
  readonly file: string;
  readonly codec: 'h264';
  readonly pixelFormat: 'yuv420p';
  readonly crf: number;
  readonly fps: number;
  readonly frames: number;
}

/** `--frames timeline`: the range saved with the graph (`timeline.start`-`end`). */
export function timelineFrameSpec(document: { timeline?: { start?: unknown; end?: unknown } } | null | undefined): FrameSpec {
  const start = document?.timeline?.start;
  const end = document?.timeline?.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error('--frames timeline: the graph has no saved timeline range (set it in Studio\'s Timeline and save, or name the range: --frames 1-250)');
  }
  if (end < start) throw new Error(`--frames timeline: the saved end (${end}) is before the start (${start})`);
  return { start, end };
}

/**
 * Encode the files one node wrote for a contiguous range. `files` are the
 * project-relative paths `run --frames` returned, `<out>/<node>.<frame>.<ext>`.
 */
export async function encodeMp4(options: {
  readonly root: string;
  readonly files: readonly string[];
  readonly frames: readonly number[];
  readonly fps: number;
  readonly file: string;
  readonly crf?: number;
}): Promise<EncodedVideo> {
  const crf = options.crf ?? DEFAULT_CRF;
  const sequences = new Map<string, string[]>();
  for (const file of options.files) {
    const match = /^(.*)\.(\d+)(\.[^./]+)$/.exec(file);
    if (!match) throw new Error(`--mp4: ${file} is not a numbered frame`);
    const key = `${match[1]}|${match[2]!.length}|${match[3]}`;
    sequences.set(key, [...(sequences.get(key) ?? []), file]);
  }
  if (sequences.size !== 1) {
    const names = [...sequences.keys()].map((key) => path.basename(key.split('|')[0]!));
    throw new Error(`--mp4 encodes one sequence, and this run wrote ${sequences.size} (${names.join(', ')}). Name the one to encode with --node.`);
  }
  const frames = options.frames;
  if (!frames.length) throw new Error('--mp4: no frames were rendered');
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index] !== frames[index - 1]! + 1) throw new Error('--mp4 needs a contiguous range of whole frames (no step)');
  }
  const [prefix, width, extension] = [...sequences.keys()][0]!.split('|') as [string, string, string];
  const pattern = path.join(options.root, `${prefix}.%0${width}d${extension}`);
  const output = path.resolve(options.root, options.file);
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await run('ffmpeg', [
      '-nostdin', '-y', '-loglevel', 'error',
      '-framerate', String(options.fps),
      '-start_number', String(frames[0]),
      '-i', pattern,
      '-frames:v', String(frames.length),
      // yuv420p needs even dimensions; pad by one pixel rather than scale.
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf),
      '-r', String(options.fps),
      '-movflags', '+faststart',
      output,
    ], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') throw new Error('--mp4 needs ffmpeg on the PATH (brew install ffmpeg)');
    throw new Error(`ffmpeg failed: ${(err.stderr || err.message).trim()}`);
  }
  return {
    file: path.relative(options.root, output).split(path.sep).join('/'),
    codec: 'h264',
    pixelFormat: 'yuv420p',
    crf,
    fps: options.fps,
    frames: frames.length,
  };
}
