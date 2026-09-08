/**
 * The `assets` capability for the headless host.
 *
 * `cascade.geo.SvgExport` declares `capabilities: ["assets"]` because an export
 * node whose file is optional is a node that silently does nothing. Only the
 * browser provided that capability (`src/nodes/definition/browserCapabilities.ts`,
 * over `/api/assets`), so the CLI supplied `shell` alone and the node failed at
 * run time with "requires the assets capability" — after `cascade validate` and
 * `cascade check` had both passed, since neither one executes anything.
 *
 * It writes through `cascade/io`'s bridge rather than inventing a second file
 * policy, so an asset obeys the two rules every other headless write obeys:
 * confined to `.cascade-cache/`, and content-addressed inside it. A node's
 * output is derived data a re-cook reproduces, and it does not belong beside
 * the source material.
 *
 * That means the path an asset comes back on differs between the two hosts —
 * `./assets/images/<name>` in the page, `.cascade-cache/<name>.<hash>.svg`
 * here — because the two hosts genuinely put the file in different places. The
 * capability's own contract is that the host decides where an asset lands, so
 * a node reading its `asset` output back through `read()` works either way;
 * anything that hard-codes the returned path would not, and nothing does.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetCapability, AssetRef } from '../../packages/contracts/src/index.js';
import type { ProjectRoot } from '../../server/src/project.js';
import { createIoBridge } from './headlessIo.js';

const CACHE_DIR = '.cascade-cache';

/** A suggested name reduced to one safe filename — never a path, never empty. */
export function assetFileName(suggested: string | undefined): string {
  const base = path.posix.basename(String(suggested ?? '').split('\\').join('/').trim());
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return safe || 'asset.bin';
}

export function createNodeAssetCapability(project: ProjectRoot): AssetCapability {
  const io = createIoBridge(project);
  return {
    async read(ref) {
      return io.read(ref.path);
    },

    async write(data, metadata): Promise<AssetRef> {
      const written = await io.write(`${CACHE_DIR}/${assetFileName(metadata.suggestedName)}`, data);
      return { path: written, ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}) };
    },

    async resolveUrl(ref) {
      const full = project.resolveMedia(String(ref.path).replace(/^\.?\//, ''));
      return { value: pathToFileURL(full).href, release: () => {} };
    },
  };
}
