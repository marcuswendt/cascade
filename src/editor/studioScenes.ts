/**
 * Scenes in Studio: File › Save Scene and File › Open Scene.
 *
 * The same scene files the exported editor reads and writes, through the same
 * runtime functions, so a scene made by someone in a shared editor opens onto
 * the graph here with the same values, and one saved here opens there.
 */
import type { CascadeDocument, CascadeScene, JsonValue, SceneFile } from '../../packages/contracts/src/index.js';
import {
  controlOf,
  createScene,
  fromBase64,
  publishedValues,
  resolveScene,
  sceneFile,
  setPublishedValues,
} from '../../packages/runtime/src/editor/index.js';

/** A scene of the graph's current published values, with file parameters read from the project. */
export async function sceneFromStudio(document: CascadeDocument, name: string): Promise<CascadeScene> {
  const files: Record<string, SceneFile> = {};
  const values = publishedValues(document);
  for (const parameter of document.editor?.parameters ?? []) {
    if (controlOf(parameter, values[parameter.id]) !== 'file') continue;
    const value = values[parameter.id] as { path?: string } | undefined;
    if (!value?.path) continue;
    const response = await fetch(mediaPath(value.path));
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    files[parameter.id] = await sceneFile(parameter, bytes, value.path.split('/').pop() ?? 'file', response.headers.get('content-type') ?? undefined);
  }
  return createScene(document, { name, files, savedAt: new Date().toISOString() });
}

/**
 * Apply a scene to the graph's document. Embedded files are uploaded into the
 * project's assets; a referenced file (a licensed font) is kept when the graph
 * already uses a file of that name, and reported otherwise.
 */
export async function applySceneInStudio(document: CascadeDocument, input: unknown): Promise<{ document: CascadeDocument; warnings: string[] }> {
  const resolved = resolveScene(document, input);
  const warnings = [...resolved.warnings];
  const updates: Record<string, JsonValue> = { ...resolved.values };
  const current = publishedValues(document);
  for (const parameter of document.editor?.parameters ?? []) {
    const file = resolved.files[parameter.id];
    if (!file) continue;
    if (file.data) {
      const form = new FormData();
      form.append('file', new Blob([fromBase64(file.data) as BlobPart], { type: file.mediaType ?? 'application/octet-stream' }), file.name);
      const response = await fetch('/api/assets', { method: 'POST', body: form });
      if (!response.ok) { warnings.push(`${parameter.label ?? parameter.id}: could not store "${file.name}" (${response.status})`); continue; }
      const stored = await response.json() as { path: string };
      updates[parameter.id] = { path: stored.path.replace(/^\.\//, ''), ...(file.mediaType ? { mediaType: file.mediaType } : {}) };
      continue;
    }
    const existing = current[parameter.id] as { path?: string } | undefined;
    const found = await findProjectFile(parameter, file, existing?.path);
    if (found) updates[parameter.id] = { path: found, ...(file.mediaType ? { mediaType: file.mediaType } : {}) };
    else warnings.push(`${parameter.label ?? parameter.id}: the scene used "${file.name}", which is not in this graph; point the parameter at your copy`);
  }
  return { document: setPublishedValues(document, updates), warnings };
}

/** A project file with the scene file's name and hash, in the usual places. */
async function findProjectFile(parameter: Parameters<typeof sceneFile>[0], file: SceneFile, current?: string): Promise<string | undefined> {
  const name = file.name.split('/').pop() ?? file.name;
  const directory = current?.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
  const candidates = [current, directory && `${directory}/${name}`, directory && `${directory}/licensed/${name}`,
    `assets/fonts/licensed/${name}`, `assets/licensed/${name}`, `licensed/${name}`, `assets/fonts/${name}`, `assets/${name}`];
  for (const candidate of new Set(candidates.filter((item): item is string => !!item))) {
    const response = await fetch(mediaPath(candidate)).catch(() => undefined);
    if (!response?.ok) continue;
    const hashed = await sceneFile({ ...parameter, embed: 'never' }, new Uint8Array(await response.arrayBuffer()), name);
    if (hashed.sha256 === file.sha256) return candidate.replace(/^\.\//, '');
  }
  return undefined;
}

function mediaPath(path: string): string {
  const clean = path.replace(/^\.?\//, '');
  return `/api/media/${clean.split('/').map(encodeURIComponent).join('/')}?raw=1`;
}
