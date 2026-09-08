/**
 * The naming contract for a rendered frame sequence, in one place because two
 * hosts now write one.
 *
 *     <out>/<node id>.<frame, 4 digits>.<ext>
 *
 * A dynamic graph renders through the compatibility engine and a definition-v1
 * graph through the deterministic runtime. A rule that differed between them
 * would be a rule nobody can script against — the same reason it does not
 * change shape for a graph with exactly one output.
 *
 * Its own file rather than a corner of `frames.ts` so the deterministic path
 * can share it without importing the Studio engine that file is bound to.
 */
import path from 'node:path';

export function sequenceWidth(end: number): number {
  return Math.max(4, String(Math.floor(end)).length);
}

export function sequenceFileName(nodeId: string, frame: number, source: string, width: number): string {
  const extension = path.extname(source) || '.png';
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeId}.${String(Math.floor(frame)).padStart(width, '0')}${extension}`;
}

/** The file an image-typed port points at, however the host expressed it. */
export function imagePath(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    const candidate = (value as { path?: unknown }).path;
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}
