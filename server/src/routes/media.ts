/**
 * Media route — serves any file inside the project root to the browser, and
 * for images does the resize/re-encode on the way out.
 *
 * This exists because node image outputs were unreachable: a node emits a
 * project-relative path like `.cascade-cache/render-preview.preview.png`, the
 * Viewer turned it into `/.cascade-cache/…`, and the only static mount is the
 * built UI — so every image output resolved to the app's own index.html and
 * rendered as a broken image.
 *
 * Encoding matters here because the pipeline's outputs are large: a 1400×1867
 * plot preview is ~1.4 MB of PNG, and a super-res pass is several times that.
 * WebP at a display width is one to two orders of magnitude smaller, which is
 * the difference between a preview that updates as you work and one that
 * doesn't. The full-resolution original stays one request away (`raw=1`), and
 * SVG streams untouched — plotter output must never be re-encoded.
 *
 * A .npy float field is rendered to greyscale rather than streamed, so the
 * mask/signal/height stages can be opened and zoomed like any other stage.
 * `raw=1` still gets the array itself.
 */
import express, { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fssync from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { ProjectRoot } from '../project.js';
import { PathSafetyError } from '../pathSafety.js';

/** Formats sharp can decode and we're willing to transform. */
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.avif', '.gif']);

/**
 * A .npy float array — a mask, a signal, a density or height field. Nine of the
 * many numeric stages emit one, and none of them could be looked at: the array
 * isn't an image, so the viewer had nothing to show and those stages were
 * effectively uninspectable. Rendering the array to greyscale here makes every
 * stage of a pipeline something you can open and zoom into, which is the whole
 * point of a node graph you can step through.
 *
 * Minimal .npy v1/v2 reader: magic \x93NUMPY, version, header length, then a
 * Python-dict header giving dtype, order and shape. Only the C-contiguous
 * numeric cases the pipeline actually produces are handled; anything else is
 * reported rather than guessed at.
 */
interface NpyArray {
  data: Float64Array;
  width: number;
  height: number;
}

function readNpy(buffer: Buffer): NpyArray {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 6) !== '\x93NUMPY') {
    throw new Error('not a .npy file');
  }
  const major = buffer[6];
  const headerLength = major >= 2 ? buffer.readUInt32LE(8) : buffer.readUInt16LE(8);
  const headerStart = major >= 2 ? 12 : 10;
  const header = buffer.toString('latin1', headerStart, headerStart + headerLength);

  const descr = header.match(/'descr':\s*'([^']+)'/)?.[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shape = (header.match(/'shape':\s*\(([^)]*)\)/)?.[1] ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(Number);

  if (!descr) throw new Error('.npy header has no dtype');
  if (fortran) throw new Error('.npy is Fortran-ordered; not supported');
  if (shape.length < 2) throw new Error(`.npy is ${shape.length}-dimensional; expected an image-shaped array`);

  const height = shape[0];
  const width = shape[1];
  // A trailing channel axis (H, W, C) is flattened by taking the first channel —
  // enough to see the field, and none of these stages emit one today.
  const stride = shape.length > 2 ? shape.slice(2).reduce((a, b) => a * b, 1) : 1;
  const count = height * width * stride;

  const body = buffer.subarray(headerStart + headerLength);
  const readers: Record<string, (offset: number) => number> = {
    '<f4': o => body.readFloatLE(o),
    '<f8': o => body.readDoubleLE(o),
    '|u1': o => body.readUInt8(o),
    '<u1': o => body.readUInt8(o),
    '|i1': o => body.readInt8(o),
    '<i2': o => body.readInt16LE(o),
    '<u2': o => body.readUInt16LE(o),
    '<i4': o => body.readInt32LE(o),
    '<u4': o => body.readUInt32LE(o),
    '|b1': o => body.readUInt8(o),
  };
  const sizes: Record<string, number> = {
    '<f4': 4, '<f8': 8, '|u1': 1, '<u1': 1, '|i1': 1,
    '<i2': 2, '<u2': 2, '<i4': 4, '<u4': 4, '|b1': 1,
  };
  const read = readers[descr];
  const itemSize = sizes[descr];
  if (!read || !itemSize) throw new Error(`.npy dtype ${descr} not supported`);

  const data = new Float64Array(height * width);
  for (let i = 0; i < height * width; i++) {
    data[i] = read(i * stride * itemSize);
  }
  if (count * itemSize > body.length) throw new Error('.npy body is shorter than its shape');
  return { data, width, height };
}

/** Map a float field onto 0-255. Uses the array's own range rather than
 * assuming 0..1, so a height field in metres and a mask in booleans both come
 * out legible. */
function fieldToGrey(array: NpyArray): { pixels: Buffer; min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of array.data) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  const span = max - min || 1;
  const pixels = Buffer.allocUnsafe(array.data.length);
  for (let i = 0; i < array.data.length; i++) {
    const value = array.data[i];
    pixels[i] = Number.isFinite(value) ? Math.round(((value - min) / span) * 255) : 0;
  }
  return { pixels, min, max };
}

/** Derived data only — see the PUT route. */
const CACHE_DIR = '.cascade-cache';

/** `.cascade-cache/webgl-tone.png` -> `.cascade-cache/webgl-tone.<hash>.png` */
function contentAddressed(rel: string, body: Buffer): string {
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
  const dir = path.posix.dirname(rel);
  const name = path.posix.basename(rel);
  const [stem, ...rest] = name.split('.');
  const tail = rest.length ? `.${rest.join('.')}` : '';
  return path.posix.join(dir, `${stem}.${hash}${tail}`);
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.npy': 'application/octet-stream',
};

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function createMediaRouter(project: ProjectRoot): Router {
  const router = Router();

  /**
   * Browser -> project. The other half of the interop: a node that runs in the
   * page (WebGL, canvas, anything with pixels in the browser) writes its result
   * into the project and gets back a project-relative path — the same kind of
   * string a Python node emits. From there the two are interchangeable: either
   * kind can consume either kind's output, and a graph can mix them freely.
   *
   * Confined to the cache directory on purpose. A node's output is derived data
   * that a re-cook can reproduce, so it does not belong beside the source
   * material, and the project's own files are not writable through this route.
   */
  router.put('/{*mediaPath}', express.raw({ type: '*/*', limit: '512mb' }), async (req, res) => {
    const rel = (req.params as any).mediaPath?.join('/') ?? '';
    if (!rel.startsWith(CACHE_DIR + '/')) {
      res.status(400).json({ error: `writes are confined to ${CACHE_DIR}/ — got ${rel}` });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'empty body' });
      return;
    }
    try {
      // Content-address the filename, the way the Python side keys its outputs.
      // Without it a browser node writing to one fixed name overwrites its own
      // result for a different input image, and switching back silently yields
      // the wrong pixels — exactly the bug the server-side cache had. Hashing
      // the body gets there without the node needing to know its own cache key:
      // same pixels, same file; different pixels, different file.
      const target = req.query.exact === '1' ? rel : contentAddressed(rel, req.body);
      const full = project.resolve(target);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, req.body);
      res.json({ ok: true, path: target, bytes: req.body.length });
    } catch (err) {
      res.status(err instanceof PathSafetyError ? 400 : 500).json({ error: String(err) });
    }
  });

  router.get('/{*mediaPath}', async (req, res) => {
    let full: string;
    const rel = (req.params as any).mediaPath?.join('/') ?? '';
    try {
      full = project.resolveMedia(rel);
    } catch (err) {
      res.status(err instanceof PathSafetyError ? 400 : 500).json({ error: String(err) });
      return;
    }

    let stat: fssync.Stats;
    try {
      stat = await fs.promises.stat(full);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.status(404).json({ error: `no such file: ${rel}` });
      return;
    }

    const ext = path.extname(full).toLowerCase();
    const width = clampInt(req.query.w, 1, 20000);
    const quality = clampInt(req.query.q, 1, 100) ?? 82;
    const requested = String(req.query.fmt ?? '').toLowerCase();
    const raw = req.query.raw === '1' || req.query.raw === 'true';

    // The transform is fully described by the file's identity plus the query,
    // so a repeat view of an unchanged render is a 304 rather than a re-encode.
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}-${width ?? 'full'}-${requested || 'auto'}-${quality}-${raw ? 'raw' : 'enc'}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    // A float field becomes a picture of itself. Its value range goes in a
    // header so the viewer can say what the greys mean.
    if (!raw && ext === '.npy') {
      try {
        const array = readNpy(await fs.promises.readFile(full));
        const { pixels, min, max } = fieldToGrey(array);
        res.setHeader('X-Field-Shape', `${array.height}x${array.width}`);
        res.setHeader('X-Field-Range', `${min}:${max}`);
        let pipeline = sharp(pixels, {
          raw: { width: array.width, height: array.height, channels: 1 },
        });
        if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
        if (requested === 'png') {
          res.type('image/png');
          pipeline = pipeline.png({ compressionLevel: 9 });
        } else {
          res.type('image/webp');
          pipeline = pipeline.webp({ quality, effort: 4 });
        }
        pipeline.on('error', (err) => {
          console.error('[media] field encode failed:', rel, err);
          if (!res.headersSent) res.status(500).json({ error: String(err) });
          else res.end();
        });
        pipeline.pipe(res);
      } catch (err) {
        console.error('[media] field render failed:', rel, err);
        res.status(422).json({ error: String(err instanceof Error ? err.message : err) });
      }
      return;
    }

    // Anything we can't or shouldn't transform streams through byte for byte.
    // SVG is the important one: it's the plotter deliverable.
    if (raw || !RASTER.has(ext)) {
      res.type(MIME[ext] ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(full).pipe(res);
      return;
    }

    // Default to WebP unless the caller asked for something specific. Animated
    // GIFs are left alone — a still WebP of a frame would be a silent downgrade.
    let format = requested;
    if (!format) format = ext === '.gif' ? 'gif' : 'webp';
    if (format === 'gif') {
      res.type('image/gif');
      res.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(full).pipe(res);
      return;
    }

    try {
      // failOn: 'none' so a slightly malformed render still previews rather
      // than showing nothing at all.
      let pipeline = sharp(full, { failOn: 'none' });
      if (width) {
        // withoutEnlargement: asking for a width above the original returns the
        // original size instead of an upscaled blur.
        pipeline = pipeline.resize({ width, withoutEnlargement: true });
      }
      switch (format) {
        case 'png':
          pipeline = pipeline.png({ compressionLevel: 9 });
          res.type('image/png');
          break;
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          res.type('image/jpeg');
          break;
        case 'avif':
          pipeline = pipeline.avif({ quality });
          res.type('image/avif');
          break;
        default:
          // effort 4 is the useful middle of libvips' 0–6: most of the size
          // win, a fraction of the time of effort 6 — this runs per preview.
          pipeline = pipeline.webp({ quality, effort: 4 });
          res.type('image/webp');
      }
      // Streamed, so a large render starts arriving before it finishes encoding.
      pipeline.on('error', (err) => {
        console.error('[media] encode failed:', rel, err);
        if (!res.headersSent) res.status(500).json({ error: String(err) });
        else res.end();
      });
      pipeline.pipe(res);
    } catch (err) {
      console.error('[media] error:', rel, err);
      if (!res.headersSent) res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
