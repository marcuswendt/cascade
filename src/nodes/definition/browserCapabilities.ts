import type { AssetCapability } from '../../../packages/contracts/src/index.js';
import { isStudioImage, keepStudioImage, studioImageBytes, studioImagePixels, studioImageUrl } from './studioImages.js';

/**
 * A project file's raw bytes. Through the media route, which serves any
 * project-relative path: `/api/assets/<path>` answered 404 for files that
 * exist (found porting the image library, 2026-11-07, reading
 * `assets/input.png`), and a path outside `assets/` never reached it at all.
 */
function assetUrl(path: string): string {
  const clean = path.replace(/^\.\//, '');
  return `/api/media/${clean.split('/').map(encodeURIComponent).join('/')}?raw=1`;
}

/**
 * Studio's `assets` capability. A path the image library kept in the page
 * (`studioImages.ts`) is read from memory; every other path is a project
 * asset over `/api/assets`.
 */
export const browserAssetCapability: AssetCapability = {
  async read(ref, { signal }) {
    const kept = await studioImageBytes(ref.path);
    if (kept) return kept;
    const response = await fetch(assetUrl(ref.path), { signal: signal as AbortSignal });
    if (!response.ok) throw new Error(`Could not read asset ${ref.path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  },

  async write(data, metadata, { signal }) {
    const name = metadata.suggestedName?.trim() || 'asset.bin';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: metadata.mediaType }), name);
    const response = await fetch('/api/assets', {
      method: 'POST',
      body: form,
      signal: signal as AbortSignal,
    });
    if (!response.ok) throw new Error(`Could not write asset ${name} (${response.status})`);
    const result = await response.json() as { path?: string };
    if (!result.path) throw new Error(`Asset upload returned no path for ${name}`);
    return { path: result.path, ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}) };
  },

  imagePixels(ref) {
    return studioImagePixels(ref.path);
  },

  async resolveUrl(ref) {
    return { value: isStudioImage(ref.path) ? studioImageUrl(ref.path)! : assetUrl(ref.path), release: () => {} };
  },
};

/**
 * The same, plus `keepImage`: for the built-in image library, whose
 * intermediates stay in the page rather than becoming project files. Project
 * nodes keep the plain capability, so what they write still lands on disk
 * where a server stage can read it.
 */
export const studioImageAssetCapability: AssetCapability = {
  ...browserAssetCapability,
  async keepImage(pixels, metadata) {
    return { path: keepStudioImage(pixels, metadata.suggestedName), mediaType: 'image/png' };
  },
};
