/**
 * `cascade render`: a frame range across worker processes, then a video.
 *
 * Why it exists: on 2026-11-05 a 1,600-frame ripple render ran serially for
 * about 80 minutes on a 16-core machine. `run --frames` cooks one frame at a
 * time in one process, and most generative frames are independent, so the
 * other fifteen cores watched. This splits the range across processes, each a
 * full headless host (`runGraph` in worker mode), and has them pull contiguous
 * batches from one queue, so a slow stretch of the range does not leave
 * workers idle and a worker's incremental cook still sees neighbouring frames.
 *
 * **The per-frame path contract.** A frame is copied into the sequence from
 * the file its node wrote. A node that writes every frame to one fixed path
 * (`_work/<node>.png`) is fine serially and wrong in parallel: worker A writes
 * frame 5, worker B writes frame 77 over it, A copies frame 77 into
 * `<node>.0005.png`, and nothing fails. So before any other worker renders,
 * the first worker renders the first two frames alone, and a node that wrote
 * both to the same file stops the render with its name and the path. A
 * content-addressed path (`cachePath`, `cascade/io`, assets) or one with the
 * frame in it passes.
 *
 * **Preview by default.** An animation comes out as the PNG sequence (as
 * `run --frames` writes it) plus a half-size H.264 mp4. `--final` encodes at
 * full size; `--prores` adds a ProRes master. The PNGs are never touched.
 */
import { fork, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { frameRange } from '../../packages/runtime/src/animation/index.js';
import { DEFAULT_FPS } from '../../packages/runtime/src/expressions/time.js';
import { parseFrameSpec } from './frames.js';
import { encodeSequence, frameSequences, hasFfmpeg, timelineFrameSpec, type EncodedSequence } from './encode.js';
import { runGraph } from './runner.js';
import { parseEnvArgs } from './runEnv.js';
import type { RenderedFrame } from './projectRuntime.js';

export interface RenderOptions {
  file: string;
  /** `--frames`: a range, or `timeline` (the default) for the saved range. */
  frames?: string;
  nodes?: readonly string[];
  out?: string;
  /** `--env NAME=value`, repeatable: set in every worker (and so its Python stages). */
  env?: Readonly<Record<string, string>>;
  fps?: number;
  fresh?: boolean;
  seed?: number;
  /** Worker processes. Default: {@link defaultWorkers}. */
  workers?: number;
  /** Full-size H.264 instead of the half-size preview. */
  final?: boolean;
  /** Also encode a ProRes master (full size). */
  prores?: boolean;
  /** `--no-video`: frames only. */
  video?: boolean;
  crf?: number;
  /** A progress line every N frames. Default: about twenty lines a render. */
  progressEvery?: number;
  /** Cairn job id (`--job`, or `CAIRN_JOB`): progress is noted on it. */
  job?: string;
  verbose?: boolean;
  json?: boolean;
  /** The script a worker runs, and the flags node runs it with. Tests run the TypeScript source. */
  workerEntry?: { script: string; execArgv: string[] };
  /** Where progress lines go. Default stdout, or stderr under --json. */
  log?: (line: string) => void;
  /** Runs `cairn`. Injected by tests. */
  cairn?: (args: string[]) => Promise<void>;
}

export interface RenderResult {
  frames: number[];
  files: string[];
  workers: number;
  durationMs: number;
  videos: EncodedSequence[];
}

/** Half preview, full final: the scale the H.264 is encoded at. */
export const PREVIEW_SCALE = 0.5;

/** Cores minus a few: the machine keeps room for Studio, the gateway and ffmpeg. */
export function defaultWorkers(cores = os.availableParallelism()): number {
  return Math.max(1, cores - Math.min(4, Math.max(1, Math.round(cores / 4))));
}

export const RENDER_HELP = `
cascade render <graph-file> [options]

Render an animation across worker processes, then encode it. Frames are
written exactly as run --frames writes them, <out>/<node id>.<frame>.<ext>;
the video goes beside them.

Options:
  --frames <range>    1-100, 1-100x2, 42, or timeline (default: timeline)
  --node <id>         Render only this node's output. Repeatable
  --workers <n>       Worker processes (default: cores minus a few, here ${defaultWorkers()}).
                      With more than one, the first two frames are rendered
                      alone first, and a node writing both to one fixed file
                      stops the render: parallel workers would overwrite it
  --final             Full-size H.264 <node>.mp4 instead of the half-size
                      <node>.preview.mp4
  --prores            Also a full-size ProRes master <node>.mov (4444 when the
                      frames have alpha, else 422 HQ); implies --final
  --no-video          Frames only
  --crf <n>           H.264 quality, 0-51, lower is better (default 18)
  --out <dir>         Sequence directory, project-relative (default: renders)
  --fps <number>      Frame rate to evaluate at and play at
  --seed <n>          Cook with this graph seed
  --fresh             Cook every node on every frame
  --progress <n>      A progress line every n frames (default: about 20 lines)
  --job <id>          Note progress on this Cairn job (default: $CAIRN_JOB),
                      with cairn jobs update <id> --note
  --env NAME=value    Set a variable in every worker and its Python stages. Repeatable
  --json              Print the result as JSON; progress goes to stderr
  --verbose, -v       Every frame, and the workers' own output
`;

/** `cascade render` flags. Unknown flags are fatal, like a missing value. */
export function parseRenderArgs(args: readonly string[]): RenderOptions {
  const file = args[0];
  if (!file || file.startsWith('-')) throw new Error('cascade render requires a graph file');
  const options: RenderOptions = { file };
  const nodes: string[] = [];
  const value = (index: number, flag: string): string => {
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
    return next;
  };
  const integer = (text: string, flag: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const number = Number(text);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${flag} must be an integer from ${min}${max === Number.MAX_SAFE_INTEGER ? ' up' : ` to ${max}`} (got "${text}")`);
    return number;
  };
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]!;
    switch (flag) {
      case '--frames': options.frames = value(index, flag); index += 1; break;
      case '--node': nodes.push(value(index, flag)); index += 1; break;
      case '--workers': options.workers = integer(value(index, flag), flag, 1); index += 1; break;
      case '--final': options.final = true; break;
      case '--prores': options.prores = true; options.final = true; break;
      case '--no-video': options.video = false; break;
      case '--crf': options.crf = integer(value(index, flag), flag, 0, 51); index += 1; break;
      case '--out': options.out = value(index, flag); index += 1; break;
      case '--fps': {
        const fps = Number(value(index, flag));
        if (!Number.isFinite(fps) || fps <= 0) throw new Error(`--fps must be a positive number (got "${args[index + 1]}")`);
        options.fps = fps; index += 1; break;
      }
      case '--seed': options.seed = integer(value(index, flag), flag, 0, 0xffffffff); index += 1; break;
      case '--fresh': options.fresh = true; break;
      case '--progress': options.progressEvery = integer(value(index, flag), flag, 1); index += 1; break;
      case '--job': options.job = value(index, flag); index += 1; break;
      case '--env': options.env = { ...options.env, ...parseEnvArgs(['--env', value(index, flag)]) }; index += 1; break;
      case '--json': options.json = true; break;
      case '--verbose': case '-v': options.verbose = true; break;
      default: throw new Error(`Unknown render option: ${flag} (cascade render --help)`);
    }
  }
  if (nodes.length) options.nodes = nodes;
  if (options.video === false && (options.final || options.crf !== undefined)) {
    throw new Error('--no-video leaves nothing for --final, --prores or --crf to apply to');
  }
  return options;
}

/** The worker's argument, one JSON string, so no flag needs re-parsing. */
interface WorkerSpec {
  file: string;
  range: string;
  nodes?: readonly string[];
  out: string;
  fps?: number;
  fresh?: boolean;
  seed?: number;
}

type ToWorker = { type: 'frames'; frames: number[] };
type FromWorker =
  | { type: 'next' }
  | ({ type: 'frame' } & RenderedFrame)
  | { type: 'error'; message: string };

/**
 * The outputs a node wrote to the same file on two different frames: the
 * fixed-work-path signature that makes a parallel render copy one worker's
 * frame under another's number.
 *
 * A content-named cache file (`.cascade-cache/<name>.<hash>.png`, what
 * `saveImage(…, cachePath(…))` writes) is not one: the same name means the same
 * bytes, so two frames sharing it are two identical drawings — a piece
 * animated on twos — and no worker can overwrite the other's frame.
 */
export function sharedOutputPaths(a: RenderedFrame, b: RenderedFrame): { nodeId: string; source: string }[] {
  const shared: { nodeId: string; source: string }[] = [];
  for (const output of a.outputs) {
    if (isContentNamed(output.source)) continue;
    if (b.outputs.some((other) => other.nodeId === output.nodeId && other.source === output.source)) {
      shared.push({ nodeId: output.nodeId, source: output.source });
    }
  }
  return shared;
}

/** A path `contentAddressed`/`pixelAddressed` (./headlessIo.ts) made: `<stem>.<12 hex>[.<ext>]` under `.cascade-cache/`. */
function isContentNamed(source: string): boolean {
  const clean = source.split('\\').join('/');
  return /(?:^|\/)\.cascade-cache\//.test(clean) && /^[^.]*\.[0-9a-f]{12}(?:\.[^/]*)?$/.test(path.posix.basename(clean));
}

export function fixedPathMessage(shared: { nodeId: string; source: string }[], a: number, b: number): string {
  const nodes = shared.map(({ nodeId, source }) => `"${nodeId}" (${source})`).join(', ');
  return `Cannot render in parallel: ${shared.length === 1 ? 'node' : 'nodes'} ${nodes} wrote frames ${a} and ${b} to the same file, `
    + 'so workers would overwrite each other\'s frames and the sequence would silently mix them up. '
    + 'Give the output a per-frame path: put the frame in the file name, or save through '
    + 'saveImage(canvas, cachePath(context.nodeId, ".png")) from cascade/io or the assets capability, '
    + 'which name files by their content. Or render with --workers 1.';
}

/**
 * The batch a worker takes next: guided self-scheduling, a share of what is
 * left divided by twice the workers. Big contiguous batches early (a worker's
 * incremental cook carries from frame to frame), single frames at the end (no
 * worker finishes a long batch while the rest sit idle).
 */
export function nextBatch(remaining: number[], workers: number): number[] {
  const size = Math.max(1, Math.ceil(remaining.length / (2 * workers)));
  return remaining.splice(0, size);
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** `48/144 frames (33%) · 2.9 fps · 0:16 elapsed · ETA 0:33` */
export function progressLine(done: number, total: number, elapsedMs: number): string {
  const rate = elapsedMs > 0 ? done / (elapsedMs / 1000) : 0;
  const eta = rate > 0 ? ((total - done) / rate) * 1000 : NaN;
  const percent = total ? Math.floor((done / total) * 100) : 100;
  return `${done}/${total} frames (${percent}%) · ${rate.toFixed(1)} fps · ${clock(elapsedMs)} elapsed · `
    + (done >= total ? 'done' : `ETA ${Number.isFinite(eta) ? clock(eta) : '?'}`);
}

/** `cairn jobs update <id> --note …`: Cairn has no progress command, and a note
 *  is what its job card shows. Fire and forget; a failure is said once. */
function cairnNotifier(job: string | undefined, run: (args: string[]) => Promise<void>, warn: (line: string) => void) {
  let busy: Promise<void> | null = null;
  let warned = false;
  const note = (text: string, force = false): Promise<void> => {
    if (!job) return Promise.resolve();
    if (busy && !force) return busy;   // never queue a backlog of notes behind a slow CLI
    const attempt = (busy ?? Promise.resolve()).then(() => run(['jobs', 'update', job, '--note', text])).catch((error) => {
      if (!warned) warn(`Could not note progress on Cairn job ${job}: ${error instanceof Error ? error.message : error}`);
      warned = true;
    });
    busy = attempt.finally(() => { if (busy === attempt) busy = null; });
    return attempt;
  };
  return note;
}

function runCairn(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('cairn', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `cairn exited ${code}`)));
  });
}

export async function renderGraph(options: RenderOptions): Promise<RenderResult> {
  const started = performance.now();
  // Under --json stdout is the result; progress goes to stderr directly, so the
  // envelope does not file it as warnings.
  const log = options.log ?? (options.json ? (line: string) => { process.stderr.write(`${line}\n`); } : (line: string) => console.log(line));
  const file = path.resolve(options.file);
  const root = path.dirname(file);
  const document = JSON.parse(await fs.readFile(file, 'utf8'));
  const spec = !options.frames || options.frames === 'timeline' ? timelineFrameSpec(document) : parseFrameSpec(options.frames);
  const all = frameRange(spec.start, spec.end, spec.step ?? 1);
  const out = options.out ?? 'renders';

  // Everything that can refuse refuses now, not after the render.
  const video = options.video !== false && all.length > 1;
  if (video && spec.step !== undefined && spec.step !== 1) {
    throw new Error('A video needs a contiguous range of whole frames; drop the step or pass --no-video');
  }
  if (video && !(await hasFfmpeg())) {
    throw new Error('Encoding the video needs ffmpeg on the PATH (brew install ffmpeg), or pass --no-video for frames only');
  }
  const workers = Math.max(1, Math.min(options.workers ?? defaultWorkers(), all.length));
  const every = options.progressEvery ?? Math.max(1, Math.round(all.length / 20));
  const job = options.job ?? process.env.CAIRN_JOB ?? undefined;
  const note = cairnNotifier(job || undefined, options.cairn ?? runCairn, (line) => console.error(line));

  const what = options.nodes?.length ? options.nodes.join(', ') : path.basename(file);
  log(`Rendering ${all.length} frames of ${what} on ${workers} ${workers === 1 ? 'worker' : 'workers'} -> ${out}/`);

  const workerSpec: WorkerSpec = {
    file,
    range: spec.step === undefined ? `${spec.start}-${spec.end}` : `${spec.start}-${spec.end}x${spec.step}`,
    out,
    ...(options.nodes?.length ? { nodes: options.nodes } : {}),
    ...(options.fps === undefined ? {} : { fps: options.fps }),
    ...(options.fresh ? { fresh: true } : {}),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
  const entry = options.workerEntry ?? { script: process.argv[1]!, execArgv: process.execArgv };

  const remaining = [...all];
  const rendered = new Map<number, RenderedFrame>();
  // The probe: worker 0 renders the first two frames before anyone else gets a
  // frame. One worker needs no probe; there is nobody to collide with.
  const probeFrames = workers > 1 ? remaining.splice(0, 2) : [];
  let probe: Promise<void> = Promise.resolve();
  let passProbe: () => void = () => {};
  if (probeFrames.length === 2) probe = new Promise((resolve) => { passProbe = resolve; });

  const children: ChildProcess[] = [];
  let failure: Error | null = null;
  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    for (const child of children) child.kill('SIGTERM');
    passProbe();
  };

  let lastLogged = 0;
  const onFrame = (frame: RenderedFrame) => {
    rendered.set(frame.frame, frame);
    if (probeFrames.length === 2 && probeFrames.every((value) => rendered.has(value))) {
      const shared = sharedOutputPaths(rendered.get(probeFrames[0]!)!, rendered.get(probeFrames[1]!)!);
      if (shared.length) fail(new Error(fixedPathMessage(shared, probeFrames[0]!, probeFrames[1]!)));
      passProbe();
    }
    if (failure) return;
    if (options.verbose) log(`  frame ${frame.frame} (${Math.round(frame.durationMs)} ms)`);
    if (rendered.size - lastLogged >= every || rendered.size === all.length) {
      lastLogged = rendered.size;
      const line = progressLine(rendered.size, all.length, performance.now() - started);
      log(line);
      void note(`render ${what}: ${line}`);
    }
  };

  const runWorker = (index: number) => new Promise<void>((resolve) => {
    const child = fork(entry.script, ['__render-worker', JSON.stringify(workerSpec)], {
      execArgv: entry.execArgv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
    });
    children.push(child);
    let stderr = '';
    child.stdout!.on('data', (chunk) => { if (options.verbose) process.stderr.write(chunk); });
    child.stderr!.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
      if (options.verbose) process.stderr.write(chunk);
    });
    let first = true;
    const send = (message: ToWorker) => { if (child.connected) child.send(message); };
    child.on('message', async (message: FromWorker) => {
      if (message.type === 'frame') onFrame(message);
      else if (message.type === 'error') fail(new Error(message.message));
      else if (message.type === 'next') {
        if (index === 0 && first && probeFrames.length) {
          first = false;
          send({ type: 'frames', frames: probeFrames });
          return;
        }
        first = false;
        await probe;
        send({ type: 'frames', frames: failure ? [] : nextBatch(remaining, workers) });
      }
    });
    child.on('exit', (code, signal) => {
      if (code !== 0 && !failure) {
        const detail = stderr.trim().split('\n').slice(-6).join('\n');
        fail(new Error(`render worker ${index + 1} ${signal ? `was killed (${signal})` : `exited ${code}`}${detail ? `:\n${detail}` : ''}`));
      }
      resolve();
    });
  });

  await Promise.all(Array.from({ length: workers }, (_, index) => runWorker(index)));
  if (failure) {
    await note(`render ${what} failed: ${(failure as Error).message.split('\n')[0]}`, true);
    throw failure;
  }
  const missing = all.filter((frame) => !rendered.has(frame));
  if (missing.length) throw new Error(`render finished without ${missing.length} frames (first: ${missing[0]})`);

  const frames = [...all];
  const files = frames.flatMap((frame) => rendered.get(frame)!.outputs.map((output) => output.file));

  const videos: EncodedSequence[] = [];
  if (video) {
    // The rate the frames were evaluated at, resolved the way the runtime does.
    const saved = document?.timeline?.fps;
    const fps = options.fps ?? (typeof saved === 'number' && saved > 0 ? saved : DEFAULT_FPS);
    for (const sequence of frameSequences(files)) {
      const base = sequence.prefix;
      const encodes: { file: string; codec: 'h264' | 'prores'; scale: number }[] = [
        options.final || options.prores
          ? { file: `${base}.mp4`, codec: 'h264', scale: 1 }
          : { file: `${base}.preview.mp4`, codec: 'h264', scale: PREVIEW_SCALE },
        ...(options.prores ? [{ file: `${base}.mov`, codec: 'prores' as const, scale: 1 }] : []),
      ];
      for (const encode of encodes) {
        videos.push(await encodeSequence({
          root, sequence, frames, fps, ...encode,
          ...(options.crf === undefined ? {} : { crf: options.crf }),
        }));
      }
    }
  }

  const durationMs = performance.now() - started;
  const summary = `Rendered ${frames.length} frames in ${clock(durationMs)} on ${workers} ${workers === 1 ? 'worker' : 'workers'}`
    + (videos.length ? `; ${videos.map((item) => item.file).join(', ')}` : '');
  log(summary);
  await note(`render ${what}: ${summary}`, true);
  return { frames, files, workers, durationMs, videos };
}

/**
 * The worker side: `cascade __render-worker <spec>`, forked by `renderGraph`.
 * Pulls batches over IPC until it is handed an empty one.
 */
export async function runRenderWorker(argument: string | undefined): Promise<void> {
  if (!process.send) throw new Error('__render-worker is started by cascade render, not by hand');
  const spec = JSON.parse(argument ?? '') as WorkerSpec;
  const send = (message: FromWorker) => new Promise<void>((resolve, reject) => {
    process.send!(message, undefined, {}, (error) => error ? reject(error) : resolve());
  });
  const request = () => new Promise<number[]>((resolve) => {
    const listener = (message: ToWorker) => {
      if (message?.type !== 'frames') return;
      process.off('message', listener);
      resolve(message.frames);
    };
    process.on('message', listener);
    void send({ type: 'next' });
  });
  async function* frames() {
    for (;;) {
      const batch = await request();
      if (!batch.length) return;
      yield* batch;
    }
  }
  try {
    await runGraph({
      file: spec.file,
      frames: spec.range,
      out: spec.out,
      ...(spec.nodes ? { nodes: spec.nodes } : {}),
      ...(spec.fps === undefined ? {} : { fps: spec.fps }),
      ...(spec.fresh ? { fresh: true } : {}),
      ...(spec.seed === undefined ? {} : { seed: spec.seed }),
      worker: { frameSource: frames(), onFrame: (frame) => send({ type: 'frame', ...frame }) },
    });
  } catch (error) {
    await send({ type: 'error', message: error instanceof Error ? error.message : String(error) }).catch(() => {});
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
}
