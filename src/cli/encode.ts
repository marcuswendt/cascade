/**
 * `cascade run --frames … --mp4 <file>`: the rendered sequence as a video.
 *
 * The cloud-wall flipbooks were eight wrapper scripts around ffmpeg because
 * `run --frames` stopped at an image sequence. This is that last step, once:
 * H.264, yuv420p (what every player and phone plays), a CRF the run names, at
 * the frame rate the sequence was evaluated at, so the video's timing is the
 * graph's timing. ffmpeg is a tool on the machine, not a dependency of Cascade.
 *
 * `cascade render` encodes through the same function, with two more choices:
 * a scale (its preview is half size) and ProRes for a master.
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

export interface EncodedSequence {
  /** Project-relative. */
  readonly file: string;
  readonly codec: 'h264' | 'prores';
  readonly pixelFormat: string;
  readonly crf?: number;
  readonly fps: number;
  readonly frames: number;
  /** 1 is the frames' own size; a preview is 0.5. */
  readonly scale: number;
}

export interface FrameSequence {
  /** Project-relative path before the frame number: `renders/drop` for `renders/drop.0001.png`. */
  readonly prefix: string;
  readonly width: number;
  readonly extension: string;
  readonly files: string[];
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

/** The numbered sequences among a run's files: one per output node, since
 *  that is how `run --frames` names them, `<out>/<node>.<frame>.<ext>`. */
export function frameSequences(files: readonly string[]): FrameSequence[] {
  const sequences = new Map<string, FrameSequence>();
  for (const file of files) {
    const match = /^(.*)\.(\d+)(\.[^./]+)$/.exec(file);
    if (!match) throw new Error(`${file} is not a numbered frame`);
    const key = `${match[1]}|${match[2]!.length}|${match[3]}`;
    const entry = sequences.get(key) ?? { prefix: match[1]!, width: match[2]!.length, extension: match[3]!, files: [] };
    entry.files.push(file);
    sequences.set(key, entry);
  }
  return [...sequences.values()];
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
  const sequences = frameSequences(options.files);
  if (sequences.length !== 1) {
    const names = sequences.map((sequence) => path.basename(sequence.prefix));
    throw new Error(`--mp4 encodes one sequence, and this run wrote ${sequences.length} (${names.join(', ')}). Name the one to encode with --node.`);
  }
  const { scale: _scale, ...video } = await encodeSequence({ ...options, sequence: sequences[0]!, codec: 'h264' });
  return video as EncodedVideo;
}

/** Whether ffmpeg is on the PATH: asked before a long render that ends in an encode, not after it. */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode one numbered sequence.
 *
 * H.264 is the preview and the file to send: yuv420p, faststart, optionally
 * scaled. ProRes is the master: 422 HQ, or 4444 with alpha when the first
 * frame has any transparency, so a layer rendered on a transparent background
 * keeps it.
 */
export async function encodeSequence(options: {
  readonly root: string;
  readonly sequence: Pick<FrameSequence, 'prefix' | 'width' | 'extension'>;
  readonly frames: readonly number[];
  readonly fps: number;
  readonly file: string;
  readonly codec: 'h264' | 'prores';
  readonly crf?: number;
  readonly scale?: number;
}): Promise<EncodedSequence> {
  const frames = options.frames;
  const scale = options.scale ?? 1;
  if (!(scale > 0 && scale <= 1)) throw new Error(`video scale must be greater than 0 and at most 1 (got ${scale})`);
  if (!frames.length) throw new Error('--mp4: no frames were rendered');
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index] !== frames[index - 1]! + 1) throw new Error('--mp4 needs a contiguous range of whole frames (no step)');
  }
  const { prefix, width, extension } = options.sequence;
  const pattern = path.join(options.root, `${prefix}.%0${width}d${extension}`);
  const output = path.resolve(options.root, options.file);
  await fs.mkdir(path.dirname(output), { recursive: true });

  // yuv420p needs even dimensions; pad by one pixel rather than scale. A
  // scaled video is resampled anyway, so it rounds down to even instead.
  const size = scale === 1
    ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
    : `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2:flags=lanczos`;
  const crf = options.crf ?? DEFAULT_CRF;
  let pixelFormat: string;
  let codecArgs: string[];
  if (options.codec === 'prores') {
    const first = path.join(options.root, `${prefix}.${String(frames[0]).padStart(width, '0')}${extension}`);
    const alpha = await hasTransparency(first);
    pixelFormat = alpha ? 'yuva444p10le' : 'yuv422p10le';
    codecArgs = ['-c:v', 'prores_ks', '-profile:v', alpha ? '4' : '3', '-vendor', 'apl0', '-pix_fmt', pixelFormat];
  } else {
    pixelFormat = 'yuv420p';
    codecArgs = ['-c:v', 'libx264', '-pix_fmt', pixelFormat, '-crf', String(crf), '-movflags', '+faststart'];
  }
  try {
    await run('ffmpeg', [
      '-nostdin', '-y', '-loglevel', 'error',
      '-framerate', String(options.fps),
      '-start_number', String(frames[0]),
      '-i', pattern,
      '-frames:v', String(frames.length),
      '-vf', size,
      ...codecArgs,
      '-r', String(options.fps),
      output,
    ], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') throw new Error('Encoding needs ffmpeg on the PATH (brew install ffmpeg)');
    throw new Error(`ffmpeg failed: ${(err.stderr || err.message).trim()}`);
  }
  return {
    file: path.relative(options.root, output).split(path.sep).join('/'),
    codec: options.codec,
    pixelFormat,
    ...(options.codec === 'h264' ? { crf } : {}),
    fps: options.fps,
    frames: frames.length,
    scale,
  };
}

async function hasTransparency(file: string): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  const stats = await sharp(file).stats();
  return !stats.isOpaque;
}
