import type {
  AssetCapability,
  AssetRef,
  CascadeAbortSignal,
  ImageRef,
  ResourceLease,
} from '../../packages/contracts/src/index.js';
import type { IoBridge, MediaOptions } from '../../server/src/runtime/io.js';

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 4096;
const GENERATED_ROOT = '.cascade-player/generated';

interface GeneratedEntry {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  leases: number;
  objectUrl?: string;
}

export interface PlayerAssetStoreOptions {
  readonly maxGeneratedBytes?: number;
  readonly maxGeneratedEntries?: number;
}

export interface PlayerAssetStoreStats {
  readonly generatedBytes: number;
  readonly generatedEntries: number;
  readonly objectUrls: number;
}

/**
 * The browser player's one project-file boundary.
 *
 * Authored assets are immutable deployment URLs. Generated assets are immutable
 * byte snapshots with unique paths, so a Feedback history can retain an older
 * frame without a later write changing the bytes underneath it. The store also
 * implements the older cascade/io bridge because project nodes still use those
 * helpers; keeping both contracts on one owner avoids divergent caches.
 */
export class PlayerAssetStore implements AssetCapability, IoBridge {
  private readonly authored = new Map<string, string>();
  private readonly generated = new Map<string, GeneratedEntry>();
  private readonly generatedByUrl = new Map<string, string>();
  private readonly maxGeneratedBytes: number;
  private readonly maxGeneratedEntries: number;
  private generatedBytes = 0;
  private sequence = 0;
  private disposed = false;

  constructor(
    assets: Readonly<Record<string, string>>,
    options: PlayerAssetStoreOptions = {},
  ) {
    this.maxGeneratedBytes = finiteLimit(
      options.maxGeneratedBytes,
      DEFAULT_MAX_BYTES,
      'maxGeneratedBytes',
    );
    this.maxGeneratedEntries = finiteLimit(
      options.maxGeneratedEntries,
      DEFAULT_MAX_ENTRIES,
      'maxGeneratedEntries',
    );
    for (const [path, url] of Object.entries(assets)) {
      const clean = cleanPath(path);
      if (typeof url !== 'string' || url.length === 0)
        throw new TypeError(`Player asset ${clean} has no deployment URL`);
      this.authored.set(clean, url);
    }
  }

  read(ref: AssetRef, options: { signal: CascadeAbortSignal }): Promise<Uint8Array>;
  read(path: string, options?: MediaOptions): Promise<Uint8Array>;
  async read(
    ref: AssetRef | string,
    options: { signal?: CascadeAbortSignal } | MediaOptions = {},
  ): Promise<Uint8Array> {
    this.assertActive();
    const path = cleanPath(typeof ref === 'string' ? ref : ref.path);
    if (typeof ref === 'string') assertIdentityMediaOptions(path, options as MediaOptions);
    const signal = 'signal' in options ? options.signal : undefined;
    if (signal?.aborted) throw abortError(signal.reason);
    const generated = this.generated.get(path);
    if (generated) return generated.bytes.slice();
    const url = this.authored.get(path);
    if (!url) throw new Error(`Player asset not found: ${path}`);
    const relay = signal ? relayAbort(signal) : undefined;
    try {
      const response = await fetch(url, {
        ...(relay ? { signal: relay.signal } : {}),
      });
      if (!response.ok)
        throw new Error(`Could not read player asset ${path} (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      relay?.dispose();
    }
  }

  write(
    data: Uint8Array,
    metadata: { mediaType?: string; suggestedName?: string },
    options: { signal: CascadeAbortSignal },
  ): Promise<AssetRef>;
  write(path: string, data: Uint8Array): Promise<string>;
  async write(
    first: Uint8Array | string,
    second: Uint8Array | { mediaType?: string; suggestedName?: string },
    third?: { signal: CascadeAbortSignal },
  ): Promise<AssetRef | string> {
    this.assertActive();
    const fromIo = typeof first === 'string';
    const data = (fromIo ? second : first) as Uint8Array;
    if (!(data instanceof Uint8Array))
      throw new TypeError('Player asset writes require Uint8Array bytes');
    const metadata = fromIo
      ? { suggestedName: first, mediaType: mediaTypeForName(first) }
      : second as { mediaType?: string; suggestedName?: string };
    if (third?.signal.aborted) throw abortError(third.signal.reason);

    const name = safeName(metadata.suggestedName);
    const path = `${GENERATED_ROOT}/${String(++this.sequence).padStart(8, '0')}-${name}`;
    const nextBytes = this.generatedBytes + data.byteLength;
    const nextEntries = this.generated.size + 1;
    if (nextBytes > this.maxGeneratedBytes) {
      throw new Error(
        `Player asset ${path} would use ${nextBytes} bytes; limit is ${this.maxGeneratedBytes} bytes`,
      );
    }
    if (nextEntries > this.maxGeneratedEntries) {
      throw new Error(
        `Player asset ${path} would use ${nextEntries} entries; limit is ${this.maxGeneratedEntries} entries`,
      );
    }

    const stored = data.slice();
    this.generated.set(path, {
      bytes: stored,
      ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}),
      leases: 0,
    });
    this.generatedBytes = nextBytes;
    return fromIo
      ? path
      : { path, ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}) };
  }

  url(path: string, options: MediaOptions = {}): string {
    this.assertActive();
    assertIdentityMediaOptions(path, options);
    const clean = cleanPath(path);
    const authored = this.authored.get(clean);
    if (authored) return authored;
    const generated = this.generated.get(clean);
    if (!generated) throw new Error(`Player asset not found: ${clean}`);
    if (!generated.objectUrl) {
      generated.objectUrl = URL.createObjectURL(blobFor(generated));
      this.generatedByUrl.set(generated.objectUrl, clean);
    }
    return generated.objectUrl;
  }

  async resolveUrl(ref: AssetRef | ImageRef): Promise<ResourceLease<string>> {
    this.assertActive();
    const path = cleanPath(ref.path);
    const generated = this.generated.get(path);
    if (!generated) {
      const authored = this.authored.get(path);
      if (!authored) throw new Error(`Player asset not found: ${path}`);
      return { value: authored, release: () => {} };
    }
    generated.leases += 1;
    let value: string;
    try {
      value = this.url(path, { raw: true });
    } catch (error) {
      generated.leases -= 1;
      throw error;
    }
    let released = false;
    return {
      value,
      release: () => {
        if (released) return;
        released = true;
        generated.leases = Math.max(0, generated.leases - 1);
      },
    };
  }

  /** Remove generated entries that no settled graph value or display lease owns. */
  collect(roots: readonly unknown[]): void {
    if (this.disposed) return;
    const reachable = new Set<string>();
    const seen = new Set<object>();
    for (const root of roots)
      visitPaths(root, reachable, seen, this.generated, this.generatedByUrl);
    const errors: unknown[] = [];
    for (const [path, entry] of this.generated) {
      if (reachable.has(path) || entry.leases > 0) continue;
      try { this.drop(path, entry); } catch (error) { errors.push(error); }
    }
    throwCollectedErrors(errors, 'Player asset collection failed');
  }

  stats(): PlayerAssetStoreStats {
    return {
      generatedBytes: this.generatedBytes,
      generatedEntries: this.generated.size,
      objectUrls: this.generatedByUrl.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const [path, entry] of this.generated) {
      try { this.drop(path, entry); } catch (error) { errors.push(error); }
    }
    throwCollectedErrors(errors, 'Player asset disposal failed');
  }

  private drop(path: string, entry: GeneratedEntry): void {
    try {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    } finally {
      if (entry.objectUrl) this.generatedByUrl.delete(entry.objectUrl);
      this.generated.delete(path);
      this.generatedBytes -= entry.bytes.byteLength;
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Player asset store is disposed');
  }
}

function finiteLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0)
    throw new TypeError(`${name} must be a non-negative safe integer`);
  return resolved;
}

function cleanPath(path: string): string {
  const clean = path.replace(/^\.\//, '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.split('/').some((part: string) => part === '..'))
    throw new Error(`Invalid player asset path: ${path}`);
  return clean;
}

function safeName(value: string | undefined): string {
  const source = (value?.trim() || 'asset.bin').replace(/\\/g, '/').split('/').pop()!;
  const safe = source.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
  return safe || 'asset.bin';
}

function assertIdentityMediaOptions(path: string, options: MediaOptions): void {
  if (options.width !== undefined || options.format !== undefined || options.quality !== undefined)
    throw new Error(`Player asset transforms are unsupported for ${path}; request the raw asset`);
}

function blobFor(entry: GeneratedEntry): Blob {
  return new Blob([entry.bytes.slice().buffer], {
    type: entry.mediaType ?? 'application/octet-stream',
  });
}

function visitPaths(
  value: unknown,
  reachable: Set<string>,
  seen: Set<object>,
  generated: ReadonlyMap<string, GeneratedEntry>,
  generatedByUrl: ReadonlyMap<string, string>,
): void {
  if (typeof value === 'string') {
    const path = value.replace(/^\.\//, '');
    if (generated.has(path)) reachable.add(path);
    else {
      const generatedPath = generatedByUrl.get(value);
      if (generatedPath) reachable.add(generatedPath);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (seen.has(value)) return;
  seen.add(value);
  if ('path' in value && typeof (value as { path?: unknown }).path === 'string') {
    const path = (value as { path: string }).path.replace(/^\.\//, '');
    if (generated.has(path)) reachable.add(path);
  }
  if (Array.isArray(value)) {
    for (const item of value)
      visitPaths(item, reachable, seen, generated, generatedByUrl);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  for (const item of Object.values(value as Record<string, unknown>))
    visitPaths(item, reachable, seen, generated, generatedByUrl);
}

function relayAbort(signal: CascadeAbortSignal): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => signal.removeEventListener('abort', abort),
  };
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(reason === undefined ? 'Aborted' : String(reason));
}

export function mediaTypeForName(name: string): string | undefined {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return undefined;
}

export function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const combined = new Error(message);
    Object.assign(combined, { errors });
    throw combined;
  }
}
