// Frames to MP4 with ffmpeg. Node only (child_process): import it from server
// nodes and scripts, never from a portable or browser node.
//
// The arguments are the ones commons' frames-to-video settled on: H.264,
// yuv420p (plays everywhere, including iPhone and Basecamp), faststart, preset
// slow. ffmpeg is looked up on PATH and then in the Homebrew locations, because
// a launchd- or Studio-started process often has a PATH without /opt/homebrew.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export const FFMPEG_CANDIDATES = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] as const;

export interface FramesToMp4Options {
  /** frame pattern in ffmpeg's printf form, e.g. `renders/anim/foil.%04d.png` */
  frames: string;
  /** output file */
  out: string;
  /** resolve relative `frames` and `out` against this directory (default: as given) */
  root?: string;
  fps?: number;
  /** first frame number in the pattern (default 1) */
  startNumber?: number;
  /** quality, 0-51, lower is better (default 16) */
  crf?: number;
  /** x264 preset (default slow) */
  preset?: string;
  /** scale factor for a preview (0.5 = half size); dimensions are kept even */
  scale?: number;
  /** ffmpeg binary; default: the first of FFMPEG_CANDIDATES that runs */
  ffmpeg?: string;
}

/** The ffmpeg argument list for `framesToMp4`, exposed so a caller can log or test it. */
export function framesToMp4Args(o: FramesToMp4Options): string[] {
  const at = (p: string) => (o.root && !isAbsolute(p) ? join(o.root, p) : p);
  const args = ['-y', '-v', 'error', '-framerate', String(o.fps ?? 30), '-start_number', String(o.startNumber ?? 1), '-i', at(o.frames)];
  if (o.scale && o.scale !== 1) args.push('-vf', `scale=trunc(iw*${o.scale}/2)*2:trunc(ih*${o.scale}/2)*2`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(o.crf ?? 16), '-preset', o.preset ?? 'slow', '-movflags', '+faststart', at(o.out));
  return args;
}

/** Run ffmpeg with `args`, trying each candidate binary. Throws with ffmpeg's message when all fail. */
export function runFfmpeg(args: string[], ffmpeg?: string): void {
  let last: unknown = null;
  for (const bin of ffmpeg ? [ffmpeg] : FFMPEG_CANDIDATES) {
    try { execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }); return; } catch (e) { last = e; }
  }
  const stderr = (last as { stderr?: Uint8Array } | null)?.stderr;
  throw new Error(`ffmpeg failed: ${stderr?.length ? new TextDecoder().decode(stderr) : String(last)}`.slice(0, 600));
}

/** Encode a frame sequence as an H.264 MP4. Creates the output directory. Returns the output path. */
export function framesToMp4(o: FramesToMp4Options): string {
  const out = o.root && !isAbsolute(o.out) ? join(o.root, o.out) : o.out;
  mkdirSync(dirname(out), { recursive: true });
  runFfmpeg(framesToMp4Args(o), o.ffmpeg);
  return out;
}

/** Extract one frame of a video (at `seconds`) as an image file. */
export function videoFrame(video: string, seconds: number, out: string, ffmpeg?: string): string {
  mkdirSync(dirname(out), { recursive: true });
  runFfmpeg(['-y', '-v', 'error', '-ss', Math.max(0, seconds).toFixed(3), '-i', video, '-frames:v', '1', out], ffmpeg);
  return out;
}
