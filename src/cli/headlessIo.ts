/**
 * `cascade/io`'s local transport — the filesystem instead of `/api/media`.
 *
 * The page reads and writes project files over HTTP because that is the only
 * door it has. A headless run has the directory itself, so this installs the
 * same two operations against it, and a node that imports `loadBitmap` or
 * `saveImage` never learns which host it got.
 *
 * It deliberately keeps the server route's two rules rather than relaxing them
 * offline, because a node must behave identically under both hosts:
 *
 *  - writes are confined to `.cascade-cache/`, since a node's output is derived
 *    data a re-cook reproduces and does not belong beside the source material;
 *  - a written filename is content-addressed, so one node writing to a fixed
 *    name for two different inputs does not silently hand on the wrong pixels.
 *
 * Both are copied from `server/src/routes/media.ts`, which is where the reasons
 * are written out at length.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IoBridge } from '../../server/src/runtime/io.js';
import { installIoBridge } from '../../server/src/runtime/io.js';
import type { ProjectRoot } from '../../server/src/project.js';

const CACHE_DIR = '.cascade-cache';

/** `.cascade-cache/logo.png` -> `.cascade-cache/logo.<hash>.png` */
export function contentAddressed(relative: string, body: Uint8Array): string {
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
  const directory = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  const [stem, ...rest] = name.split('.');
  const tail = rest.length ? `.${rest.join('.')}` : '';
  return path.posix.join(directory, `${stem}.${hash}${tail}`);
}

/** The bridge itself, so a test can drive it without installing anything. */
export function createIoBridge(project: ProjectRoot): IoBridge {
  return {
    async read(relative: string): Promise<Uint8Array> {
      // `raw` and the resize options are a service of the media route, for a
      // browser that wants a smaller copy over the wire. Offline there is no
      // wire: a node gets the file.
      const full = project.resolveMedia(relative.replace(/^\.?\//, ''));
      try {
        return await fs.readFile(full);
      } catch (error) {
        throw new Error(`cascade/io: cannot load ${relative} — ${error instanceof Error ? error.message : error}`);
      }
    },

    async write(relative: string, data: Uint8Array): Promise<string> {
      const clean = relative.replace(/^\.?\//, '');
      if (!clean.startsWith(`${CACHE_DIR}/`)) {
        throw new Error(`cascade/io: writes are confined to ${CACHE_DIR}/ — got ${clean}`);
      }
      if (!data.byteLength) throw new Error(`cascade/io: refusing to write an empty file to ${clean}`);
      const target = contentAddressed(clean, data);
      const full = project.resolve(target);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
      return target;
    },
  };
}

/** Install it for the duration of a run. Returns the disposer. */
export function installProjectIo(project: ProjectRoot): () => void {
  return installIoBridge(createIoBridge(project));
}
