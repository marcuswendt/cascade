/**
 * Notices the `.cascade` document changing on disk and lets Studio swap it in
 * without reloading the app.
 *
 * The client half of `server/src/graphWatch.ts`. Node sources already
 * hot-reload (`nodeSourceWatch.ts`); the document did not, so an agent that
 * added a node and wired it up produced a correct file and a Studio window
 * still showing the graph it loaded at startup — which reads as the agent
 * having done nothing.
 *
 * Reloading is the caller's decision, not this module's: an unsaved graph must
 * never be thrown away by the app deciding for itself, which is the same rule
 * `buildWatch.ts` follows.
 */

/** A document's identity, ignoring what a save always changes.
 *
 * Every save stamps `metadata.modified`, and the server re-stamps it on write,
 * so a byte comparison reports a change after Studio's own save and the graph
 * would reload itself for no reason — and each such reload is a dropped
 * selection and a re-cook. Keys are sorted so a rewrite that only reorders
 * them is not mistaken for an edit either.
 */
export function documentFingerprint(json: unknown): string {
  return canonical(strippedMetadata(json));
}

function strippedMetadata(json: unknown): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const record = json as Record<string, unknown>;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return record;
  const { modified: _modified, ...rest } = metadata as Record<string, unknown>;
  return { ...record, metadata: rest };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export interface GraphDocumentWatchOptions {
  /** Read lazily on each event: which document is open changes over a session.
   *  Return null when Studio is not serving a project file, so a change to
   *  another graph in the same directory is ignored. */
  getFile: () => string | null | undefined;
  onChanged: (file: string) => void | Promise<void>;
}

/** Returns a disposer. EventSource reconnects on its own, honouring the retry
 *  interval the server sends, so a server restart heals itself. */
export function watchGraphDocument(options: GraphDocumentWatchOptions): () => void {
  if (typeof EventSource === 'undefined') return () => {};

  const source = new EventSource('/api/graph-events');

  source.addEventListener('graph-changed', (event) => {
    let file: string;
    try {
      file = String(JSON.parse((event as MessageEvent).data)?.file ?? '');
    } catch {
      return;
    }
    if (!file) return;
    if (file !== options.getFile()) return;
    void options.onChanged(file);
  });

  // Logged rather than surfaced: the stream reconnects by itself, and a
  // transient drop is not something to put in front of the user.
  source.addEventListener('error', () => console.debug('[graph watch] stream interrupted, reconnecting'));

  return () => source.close();
}
