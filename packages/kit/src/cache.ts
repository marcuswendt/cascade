// A disk cache for slow, stable stages, keyed on the code as well as the inputs.
//
// From cairn-strata-hd's river cache, after the cloud-plots lesson (a key
// without the code served stale renders and sixteen worktrees were needed to
// find out what had been seen):
//
//   * The key is the stage name, its inputs AND a fingerprint of its code: the
//     entry files plus every project file they import, followed transitively
//     through relative imports, plus this kit's version. Editing any of them is
//     a miss.
//   * Every call logs one line (stderr by default), hit or miss, with the key
//     and the time, so `cascade run --json` lists it under `warnings`. A hit is
//     never silent.
//   * An environment switch (`offEnv`, e.g. RIVER_CACHE=off) turns it off.
//   * A host that cannot read the code (the browser player) keeps a memory
//     cache only, which is safe because code cannot change inside a built page.
//
// Storage: `<root>/.cascade-cache/<dir>/<stage>-<key>.bin`, written atomically
// with Node's fs when the host is Node. Format: 4-byte JSON length, the JSON
// (numeric arrays of 256+ entries replaced by {"$f64": [offset, length]}),
// padding to 8, then the float64 block. Doubles round-trip exactly; Float32Array
// and Float64Array come back as themselves.
//
// The project root has to be given: the kit is a package and cannot find the
// project from its own location. In a node module bundled by Cascade into
// `<project>/.cascade-cache/nodes/`, `new URL('../../', import.meta.url)` is
// the project root; pass that.

import { KIT_VERSION } from './version.js';

type Json = unknown;

export interface CacheOptions {
  /** project root: a `file:` URL or an absolute path. Without one the cache is memory-only. */
  root?: URL | string | null;
  /** directory under `.cascade-cache/` (default `kit`) */
  dir?: string;
  /** name in the log line (default `cache`) */
  name?: string;
  /** environment variable that turns the cache off when it is off/0/false/no */
  offEnv?: string;
  /** read a project-relative file when there is no Node fs (e.g. cascade/io loadBytes) */
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  /** where the one line per call goes (default console.error) */
  log?: (line: string) => void;
}

export interface CacheInfo { state: 'hit' | 'miss' | 'off'; key: string; ms: number; why?: string }

export interface DiskCache {
  /** Run `compute` unless a result for (stage, inputs, code) is stored. `code` lists the
   *  project-relative entry files whose import closure is fingerprinted. */
  cached<T>(stage: string, label: string, inputs: Json, code: string[], compute: () => T | Promise<T>): Promise<{ value: T; info: CacheInfo }>;
  /** Hash of project files and every project file they import; null when any is unreadable. */
  codeFingerprint(...entries: string[]): Promise<string | null>;
  /** Hash of one project file's text; null when unreadable. */
  fileHash(path: string): Promise<string | null>;
  /** true when the off switch is set */
  off(): boolean;
}

// ------------------------------------------------------------------ hashing
/** 128-bit hash of a string (four 32-bit lanes), hex. Not cryptographic. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822507); h4 = Math.imul(h4 ^ c, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2654435761) ^ Math.imul(h4 ^ (h4 >>> 13), 1597334677);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2654435761) ^ Math.imul(h3 ^ (h3 >>> 13), 1597334677);
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Stable hash of any JSON-able value (object keys sorted, typed arrays as lists). */
export function hashValue(v: Json): string {
  return hashText(JSON.stringify(v, (_k, x) => {
    if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
    if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]));
    return x;
  }));
}

// ------------------------------------------------------------------ encoding
const BIG = 256;

/** Encode a JSON-able value with large numeric arrays as a float64 block. */
export function encodeValue(v: Json): Uint8Array {
  const blocks: ArrayLike<number>[] = [];
  let off = 0;
  const json = JSON.stringify(v, function (_k, x) {
    const big = (ArrayBuffer.isView(x) && !(x instanceof DataView)) || (Array.isArray(x) && x.length >= BIG && x.every((e) => typeof e === 'number'));
    if (big && (x as ArrayLike<number>).length >= BIG) {
      const a = x as ArrayLike<number>;
      const kind = x instanceof Float32Array ? 'f32' : x instanceof Float64Array ? 'f64t' : 'f64';
      blocks.push(a); const r = { $f64: [off, a.length], kind }; off += a.length; return r;
    }
    return x;
  });
  const jb = new TextEncoder().encode(json);
  const head = 4 + jb.length, pad = (8 - (head % 8)) % 8;
  const out = new Uint8Array(head + pad + off * 8);
  new DataView(out.buffer).setUint32(0, jb.length, true);
  out.set(jb, 4);
  const f = new Float64Array(out.buffer, head + pad, off);
  let o = 0; for (const b of blocks) { f.set(b as ArrayLike<number>, o); o += b.length; }
  return out;
}

/** Inverse of `encodeValue`. */
export function decodeValue(buf: Uint8Array): Json {
  const ab = buf.byteOffset % 8 === 0 ? buf : buf.slice();
  const n = new DataView(ab.buffer, ab.byteOffset).getUint32(0, true);
  const json = new TextDecoder().decode(ab.subarray(4, 4 + n));
  const head = 4 + n, pad = (8 - (head % 8)) % 8;
  const f = new Float64Array(ab.buffer, ab.byteOffset + head + pad, (ab.byteLength - head - pad) / 8);
  return JSON.parse(json, (_k, x) => {
    if (x && typeof x === 'object' && Array.isArray(x.$f64)) {
      const [o, l] = x.$f64 as [number, number], s = f.subarray(o, o + l);
      return x.kind === 'f32' ? Float32Array.from(s) : x.kind === 'f64t' ? Float64Array.from(s) : Array.from(s);
    }
    return x;
  });
}

// ------------------------------------------------------------------ host
interface NodeFsPromises {
  readFile(p: string): Promise<Uint8Array>; writeFile(p: string, d: Uint8Array): Promise<void>;
  mkdir(p: string, o: { recursive: boolean }): Promise<unknown>; rename(a: string, b: string): Promise<void>;
}
interface Fs { read(p: string): Promise<Uint8Array | null>; write(p: string, d: Uint8Array): Promise<void> }
interface Host { process?: { versions?: { node?: string }; env?: Record<string, string | undefined> } }
const host = () => globalThis as Host;

function rootPath(root: URL | string | null | undefined): string | null {
  if (!root) return null;
  if (typeof root === 'string') {
    if (root.startsWith('file:')) return rootPath(new URL(root));
    return root.endsWith('/') ? root : root + '/';
  }
  if (root.protocol !== 'file:') return null;
  const p = decodeURIComponent(root.pathname);
  return p.endsWith('/') ? p : p + '/';
}

function nodeFs(base: string | null): Promise<Fs | null> {
  return (async () => {
    if (!base || !host().process?.versions?.node) return null;
    try {
      const spec = ['node:fs', 'promises'].join('/'); // not a literal: a browser bundle must not follow it
      const fs = await import(/* @vite-ignore */ spec) as NodeFsPromises;
      return {
        async read(p) { try { return new Uint8Array(await fs.readFile(base + p)); } catch { return null; } },
        async write(p, d) {
          const full = base + p, tmp = `${full}.${Math.random().toString(36).slice(2)}.tmp`;
          await fs.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
          await fs.writeFile(tmp, d); await fs.rename(tmp, full); // atomic: a crash leaves no half file
        },
      };
    } catch { return null; }
  })();
}

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
function join(dir: string, rel: string) {
  const parts = dir.split('/').filter(Boolean);
  for (const seg of rel.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

/** Create a cache for one project. Cheap; create it once per module that uses it. */
export function createCache(options: CacheOptions = {}): DiskCache {
  const MEM = new Map<string, Json>();
  const FP = new Map<string, Promise<string | null>>();
  const base = rootPath(options.root);
  let fsHost: Promise<Fs | null> | null = null;
  const fs = () => (fsHost ??= nodeFs(base));
  const dir = options.dir ?? 'kit';
  const name = options.name ?? 'cache';
  const log = options.log ?? ((line: string) => console.error(line));
  const off = () => !!options.offEnv && /^(off|0|false|no)$/i.test(host().process?.env?.[options.offEnv] ?? '');

  async function readText(path: string): Promise<string | null> {
    const f = await fs();
    if (f) { const b = await f.read(path); return b ? new TextDecoder().decode(b) : null; }
    if (!options.read) return null;
    try { return new TextDecoder().decode(await options.read(path)); } catch { return null; }
  }

  function codeFingerprint(...entries: string[]): Promise<string | null> {
    const id = entries.join(',');
    let p = FP.get(id);
    if (!p) {
      p = (async () => {
        const seen = new Map<string, string>(), todo = [...entries];
        while (todo.length) {
          const f = todo.pop()!;
          if (seen.has(f)) continue;
          const src = await readText(f);
          if (src == null) return null;
          seen.set(f, src);
          const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
          for (const m of src.matchAll(IMPORT_RE)) {
            let t = join(d, m[1] ?? m[2]);
            if (!/\.(ts|js|mjs|json)$/.test(t)) t += '.ts';
            if (!seen.has(t)) todo.push(t);
          }
        }
        return hashText([...seen.keys()].sort().map((k) => k + '\n' + seen.get(k)).join('\n\u0000'));
      })();
      FP.set(id, p);
    }
    return p;
  }

  async function fileHash(path: string): Promise<string | null> {
    const t = await readText(path);
    return t == null ? null : hashText(t);
  }

  async function cached<T>(stage: string, label: string, inputs: Json, code: string[], compute: () => T | Promise<T>): Promise<{ value: T; info: CacheInfo }> {
    const t0 = performance.now();
    const say = (i: CacheInfo, extra = '') => log(`[${name}] ${stage} ${label}: ${i.state}${i.why ? ` (${i.why})` : ''} key ${i.key.slice(0, 12)}, ${Math.round(i.ms)} ms${extra}`);
    if (off()) {
      const value = await compute();
      const info: CacheInfo = { state: 'off', key: '-', ms: performance.now() - t0, why: `${options.offEnv}=off` };
      say(info); return { value, info };
    }
    const fp = await codeFingerprint(...code);
    const key = hashValue({ stage, inputs, code: fp ?? 'unreadable', kit: KIT_VERSION });
    const disk = fp ? await fs() : null;
    const file = `.cascade-cache/${dir}/${stage}-${key}.bin`;
    const mem = MEM.get(key);
    if (mem !== undefined) {
      const info: CacheInfo = { state: 'hit', key, ms: performance.now() - t0, why: 'memory' };
      say(info); return { value: mem as T, info };
    }
    if (disk) {
      const b = await disk.read(file);
      if (b) {
        try {
          const value = decodeValue(b) as T;
          MEM.set(key, value);
          const info: CacheInfo = { state: 'hit', key, ms: performance.now() - t0, why: 'disk' };
          say(info, `, ${(b.byteLength / 1e6).toFixed(1)} MB`); return { value, info };
        } catch { /* a damaged entry is a miss */ }
      }
    }
    const value = await compute();
    MEM.set(key, value);
    const why = !fp ? 'code unreadable: memory only' : !disk ? 'no disk on this host: memory only' : undefined;
    if (disk) await disk.write(file, encodeValue(value));
    const info: CacheInfo = { state: 'miss', key, ms: performance.now() - t0, why };
    say(info); return { value, info };
  }

  return { cached, codeFingerprint, fileHash, off };
}
