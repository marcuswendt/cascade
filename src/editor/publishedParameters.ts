/**
 * Publishing a node parameter to the graph's shareable editor from the
 * Inspector, the Studio side of `cascade publish`.
 *
 * Pure functions over the document's `editor` section, which `Graph` carries
 * verbatim (see `Graph.editor`). Each returns a new section, so a caller can
 * record history before assigning it.
 */
import type { EditorDeclaration, PublishedParameter } from '../../packages/contracts/src/index.js';

export type EditorSection = EditorDeclaration;

export function findPublished(editor: EditorSection | undefined, node: string, prop: string): PublishedParameter | undefined {
  return editor?.parameters?.find((item) => item.node === node && item.prop === prop);
}

/** The groups already in use, in display order, for the group field's suggestions. */
export function publishedGroups(editor: EditorSection | undefined): string[] {
  const groups = [...(editor?.groups ?? [])];
  for (const parameter of editor?.parameters ?? []) if (parameter.group && !groups.includes(parameter.group)) groups.push(parameter.group);
  return groups;
}

/**
 * Publish the parameter, or unpublish it if it already is. A first publish
 * creates the editor section, named after the graph. The new parameter takes
 * the prop's own label and range, and an id that is the prop name unless that
 * is taken.
 */
export function togglePublished(
  editor: EditorSection | undefined,
  graphName: string,
  node: string,
  prop: string,
  defaults: Readonly<{ label?: string; min?: number; max?: number; step?: number }> = {},
): EditorSection {
  const base: EditorSection = editor ?? { id: slug(graphName), parameters: [], outputs: [] };
  const parameters = [...(base.parameters ?? [])];
  const index = parameters.findIndex((item) => item.node === node && item.prop === prop);
  if (index >= 0) {
    parameters.splice(index, 1);
    return { ...base, parameters };
  }
  const taken = new Set(parameters.map((item) => item.id));
  let id = prop;
  if (taken.has(id)) id = `${node}.${prop}`;
  for (let n = 2; taken.has(id); n++) id = `${node}.${prop}${n}`;
  const parameter: PublishedParameter = {
    id,
    node,
    prop,
    ...(defaults.label ? { label: defaults.label } : {}),
    ...(isFiniteNumber(defaults.min) ? { min: defaults.min } : {}),
    ...(isFiniteNumber(defaults.max) ? { max: defaults.max } : {}),
    ...(isFiniteNumber(defaults.step) ? { step: defaults.step } : {}),
    order: parameters.reduce((max, item) => Math.max(max, item.order ?? 0), 0) + 1,
  };
  return { ...base, parameters: [...parameters, parameter] };
}

export type PublishedPatch = Partial<Pick<PublishedParameter, 'label' | 'group' | 'min' | 'max' | 'step' | 'help'>>;

/**
 * Change a published parameter's label, group, range or help. An empty string
 * or a non-number clears the field rather than storing it.
 */
export function updatePublished(editor: EditorSection, node: string, prop: string, patch: PublishedPatch): EditorSection {
  const parameters = (editor.parameters ?? []).map((item) => {
    if (item.node !== node || item.prop !== prop) return item;
    const next: Record<string, unknown> = { ...item };
    for (const [key, value] of Object.entries(patch)) {
      const numeric = key === 'min' || key === 'max' || key === 'step';
      const empty = value === undefined || value === '' || (numeric && !isFiniteNumber(value));
      if (empty) delete next[key];
      else next[key] = typeof value === 'string' ? value.trim() : value;
    }
    return next as unknown as PublishedParameter;
  });
  return { ...editor, parameters };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/\.cascade$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'editor';
}
