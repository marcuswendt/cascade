/**
 * The object store a lock keeps its code and graph in.
 *
 * Content-addressed, the way git stores blobs: a file's name is the SHA-256 of
 * its bytes, under `.cascade/objects/<first two hex>/<rest>`. Two locks made
 * from mostly the same code share mostly the same objects, so the store grows
 * by what changed between approvals and not by a project per lock.
 *
 * Objects are stored as plain bytes, not compressed, so any one of them can be
 * opened with `cat` — a lock is meant to be inspectable without Cascade.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Where the store lives inside a project. Commit it with the locks. */
export const OBJECTS_DIR = path.join('.cascade', 'objects');

/** `sha256:<64 hex>`: the one spelling of a hash in a lock file. */
export type Digest = `sha256:${string}`;

export function digest(bytes: Uint8Array | string): Digest {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

export async function digestFile(file: string): Promise<Digest> {
  return digest(await fs.readFile(file));
}

function objectPath(projectRoot: string, id: Digest): string {
  const hex = id.slice('sha256:'.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`Not an object id: ${id}`);
  return path.join(projectRoot, OBJECTS_DIR, hex.slice(0, 2), hex.slice(2));
}

/** Store bytes and return their id. Writing an object that exists is a no-op. */
export async function putObject(projectRoot: string, bytes: Uint8Array | string): Promise<Digest> {
  const id = digest(bytes);
  const file = objectPath(projectRoot, id);
  try {
    await fs.access(file);
    return id;
  } catch { /* not stored yet */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so a crash never leaves a truncated object under a
  // name that claims to be the hash of the whole thing.
  const partial = `${file}.${process.pid}.partial`;
  await fs.writeFile(partial, bytes);
  await fs.rename(partial, file);
  return id;
}

/** Read an object back, and refuse it if its bytes no longer match its name. */
export async function getObject(projectRoot: string, id: Digest): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(objectPath(projectRoot, id));
  } catch {
    throw new Error(`Object ${short(id)} is missing from ${OBJECTS_DIR}/ — was .cascade/objects committed with the lock?`);
  }
  if (digest(bytes) !== id) throw new Error(`Object ${short(id)} is corrupt: its bytes no longer hash to its name`);
  return bytes;
}

/** The first twelve hex characters, for messages. The lock keeps the full hash. */
export function short(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

/**
 * JSON with object keys sorted at every depth, two-space indented, newline at
 * the end, optionally with some top-level keys pinned first. Used for
 * everything this feature writes, so the same content always gives the same
 * bytes (and the same hash), and a diff between two locks shows only what
 * changed.
 */
export function stableJson(value: unknown, leading: readonly string[] = []): string {
  const sorted = sortKeys(value);
  if (!leading.length || !sorted || typeof sorted !== 'object' || Array.isArray(sorted)) {
    return `${JSON.stringify(sorted, null, 2)}\n`;
  }
  // The named keys first, in the order given, so a file opens on what it is
  // (`format`, `id`, `name`) rather than wherever the alphabet puts them.
  const ordered: Record<string, unknown> = {};
  for (const key of leading) if (key in (sorted as object)) ordered[key] = (sorted as Record<string, unknown>)[key];
  for (const [key, entry] of Object.entries(sorted as object)) if (!(key in ordered)) ordered[key] = entry;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = sortKeys(entry);
    }
    return sorted;
  }
  return value;
}
