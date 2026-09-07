/**
 * Watches the project's `.cascade` documents and reports which one changed.
 *
 * `nodeWatch.ts` watches node *sources*; nothing watched the document itself,
 * so an agent (or any external editor) that rewrote the graph on disk left
 * Studio showing the version it loaded at startup. Reloading the whole app is
 * the wrong price for "the agent added an oscillator" — this is the server half
 * of noticing, and `src/editor/graphDocumentWatch.ts` is the client half that
 * swaps the document in place.
 *
 * Same shape as nodeWatch deliberately: server-side because only the server
 * sees the filesystem, debounced because an editor's write-truncate-write
 * arrives as several events, and delivered over SSE because the traffic is
 * one-way and tiny.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRoot } from './project.js';

export type GraphChangeListener = (filename: string) => void;

/** Long enough that a write-truncate-write lands as one event, short enough
 *  that the graph window updates while you are still looking at it. */
const DEBOUNCE_MS = 150;

export interface GraphWatcher {
  subscribe(listener: GraphChangeListener): () => void;
  close(): void;
}

/**
 * The document filename a raw watch event refers to, or null when the event is
 * about something that is not a graph document.
 *
 * Only the project root's own `*.cascade` files count: a nested path belongs to
 * a subdirectory the document loader never reads, and an editor's swap file
 * (`.index.cascade.swp`, `index.cascade~`, `.#index.cascade`) is a write in
 * progress rather than a change to publish.
 */
export function graphFileFor(relative: string): string | null {
  const segments = String(relative).split(/[\\/]/).filter(Boolean);
  if (segments.length !== 1) return null;
  const name = segments[0];
  if (!name || name.startsWith('.')) return null;
  if (!name.endsWith('.cascade')) return null;
  return name;
}

export function createGraphWatcher(project: ProjectRoot): GraphWatcher {
  const listeners = new Set<GraphChangeListener>();
  const pending = new Map<string, NodeJS.Timeout>();
  let watcher: fs.FSWatcher | null = null;

  function emit(filename: string): void {
    const existing = pending.get(filename);
    if (existing) clearTimeout(existing);
    pending.set(
      filename,
      setTimeout(() => {
        pending.delete(filename);
        for (const listener of listeners) listener(filename);
      }, DEBOUNCE_MS),
    );
  }

  try {
    // Not recursive: a document only ever lives at the project root, and a
    // recursive watch here would also carry every node source and asset write.
    watcher = fs.watch(project.root, { recursive: false }, (_event, filename) => {
      if (!filename) return;
      const graph = graphFileFor(String(filename));
      if (graph) emit(graph);
    });
    watcher.on('error', (error) => console.warn('[graph watch] stopped watching', project.root, error));
  } catch (error) {
    console.warn('[graph watch] could not watch', project.root, error);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      watcher?.close();
      watcher = null;
      listeners.clear();
    },
  };
}
