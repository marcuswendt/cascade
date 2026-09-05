import type { AssetCapability } from '../../../packages/contracts/src/index.js';

function assetUrl(path: string): string {
  const clean = path.replace(/^\.\//, '').replace(/^assets\//, '');
  return `/api/assets/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

export const browserAssetCapability: AssetCapability = {
  async read(ref, { signal }) {
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

  async resolveUrl(ref) {
    return { value: assetUrl(ref.path), release: () => {} };
  },
};
