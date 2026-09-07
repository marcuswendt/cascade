/**
 * Reading keyframe channels off the graph, defensively.
 *
 * The channel API itself (`parm.setKey`, `parm.keys`, `parm.hasChannel`) is
 * being built in `Node.parm` by another pass and is not merged yet, so nothing
 * here imports it. Everything is feature-detected at the call site and a
 * missing method means "no keys", not an error — which also means the dope
 * sheet renders as an empty track today and fills in the moment the channel
 * half lands, with no change on this side.
 *
 * The assumed shape, stated so the two halves can be joined:
 *
 *   parm.hasChannel?(): boolean
 *   parm.keys?(): ReadonlyArray<{ frame: number; value: number; interpolation?: string }>
 *   parm.setKey?(frame?: number, value?: number, interpolation?: string): void
 *   parm.deleteKey?(frame: number): void
 *   parm.moveKey?(from: number, to: number): void      // optional fast path, not required
 *
 * A key's interpolation is carried through a move rather than re-defaulted:
 * dragging a key in time must not quietly change how it leaves that key.
 *
 * A key entry is also accepted as `{ f, v }` or `{ time, value }`, because a
 * wrong field name should not silently render an empty sheet.
 */

export interface ChannelKey {
  frame: number;
  value: number;
  /** Governs the segment leaving this key. Opaque here — passed back untouched. */
  interpolation?: string;
}

export interface ChannelTrack {
  nodeId: string;
  /** Full path when the node can produce one, else the id. Display only. */
  nodePath: string;
  param: string;
  keys: ChannelKey[];
}

type ParmLike = Record<string, unknown> | null | undefined;

interface NodeLike {
  id: string;
  path?: () => string;
  props?: Record<string, unknown>;
  parameters?: Array<{ name: string }>;
  parm?: (name: string) => ParmLike;
}

interface GraphLike {
  nodes?: NodeLike[];
}

function callable(parm: ParmLike, method: string): ((...args: any[]) => any) | null {
  if (!parm) return null;
  const fn = (parm as Record<string, unknown>)[method];
  return typeof fn === 'function' ? (fn as (...args: any[]) => any) : null;
}

/** Normalises one entry from whatever the channel returns, or null if it is
 *  not a keyframe at all. */
export function normalizeKey(entry: unknown): ChannelKey | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry as Record<string, unknown>;
  const frame = raw.frame ?? raw.f ?? raw.time ?? raw.t;
  const value = raw.value ?? raw.v ?? raw.val;
  if (typeof frame !== 'number' || !Number.isFinite(frame)) return null;
  const interpolation = typeof raw.interpolation === 'string' ? raw.interpolation : undefined;
  return { frame, value: typeof value === 'number' ? value : Number(value) || 0, interpolation };
}

/** The keys on one parameter, sorted by frame. Empty when there is no channel. */
export function readKeys(parm: ParmLike): ChannelKey[] {
  const has = callable(parm, 'hasChannel');
  if (has && !has()) return [];
  const keys = callable(parm, 'keys');
  if (!keys) return [];
  let raw: unknown;
  try {
    raw = keys();
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeKey)
    .filter((key): key is ChannelKey => key !== null)
    .sort((a, b) => a.frame - b.frame);
}

/** Every parameter name a node exposes, from both parameter systems. */
export function parameterNames(node: NodeLike): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(node.props ?? {})) names.add(name);
  for (const parameter of node.parameters ?? []) {
    if (parameter?.name) names.add(parameter.name);
  }
  return [...names];
}

/** One row per keyed parameter in the graph, in node then parameter order. */
export function collectTracks(graph: GraphLike | null | undefined): ChannelTrack[] {
  const tracks: ChannelTrack[] = [];
  for (const node of graph?.nodes ?? []) {
    if (typeof node?.parm !== 'function') continue;
    for (const param of parameterNames(node)) {
      let parm: ParmLike;
      try {
        parm = node.parm(param);
      } catch {
        continue;
      }
      const keys = readKeys(parm);
      if (keys.length === 0) continue;
      let nodePath = node.id;
      try {
        nodePath = node.path?.() ?? node.id;
      } catch {
        /* a node mid-retarget can throw on path(); the id still identifies it */
      }
      tracks.push({ nodeId: node.id, nodePath, param, keys });
    }
  }
  return tracks;
}

/** Resolve one track's parm wrapper again at edit time — never hold one. */
export function findParm(graph: GraphLike | null | undefined, nodeId: string, param: string): ParmLike {
  const node = (graph?.nodes ?? []).find(candidate => candidate.id === nodeId);
  if (!node || typeof node.parm !== 'function') return null;
  try {
    return node.parm(param);
  } catch {
    return null;
  }
}

/**
 * Move a key in time. Returns false when the channel API cannot do it, so the
 * panel can leave the key where it was rather than pretending.
 */
export function moveKey(
  graph: GraphLike | null | undefined,
  nodeId: string,
  param: string,
  fromFrame: number,
  toFrame: number
): boolean {
  if (fromFrame === toFrame) return true;
  const parm = findParm(graph, nodeId, param);
  if (!parm) return false;

  const move = callable(parm, 'moveKey');
  if (move) {
    try {
      move(fromFrame, toFrame);
      return true;
    } catch {
      return false;
    }
  }

  const setKey = callable(parm, 'setKey');
  const deleteKey = callable(parm, 'deleteKey');
  if (!setKey || !deleteKey) return false;

  const existing = readKeys(parm).find(key => key.frame === fromFrame);
  if (!existing) return false;
  try {
    setKey(toFrame, existing.value, existing.interpolation);
    deleteKey(fromFrame);
    return true;
  } catch {
    return false;
  }
}
