import { writable, derived, get } from 'svelte/store';
import type { Graph } from '@/core/engine/Graph';

/**
 * Snapshot of the graph state for undo/redo
 */
export interface GraphSnapshot {
  json: any; // ReturnType<Graph['toJSON']>
  selectedNodeId: string | null;
  selectedAnnotationId: string | null;
  timestamp: number;
}

interface HistoryState {
  past: GraphSnapshot[];
  future: GraphSnapshot[];
}

const MAX_HISTORY = 50;

// Internal store
const historyState = writable<HistoryState>({
  past: [],
  future: []
});

// Derived stores for UI
export const canUndo = derived(historyState, $state => $state.past.length > 0);
export const canRedo = derived(historyState, $state => $state.future.length > 0);

// Debounce tracking
let lastRecordTime = 0;
let pendingRecord: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Record a snapshot of the current graph state before an edit
 * Call this BEFORE making changes to the graph
 */
export function recordSnapshot(
  graph: Graph,
  selectedNodeId: string | null,
  selectedAnnotationId: string | null,
  options: { debounce?: boolean; immediate?: boolean } = {}
): void {
  const { debounce = false, immediate = false } = options;

  // Clear any pending debounced record
  if (pendingRecord) {
    clearTimeout(pendingRecord);
    pendingRecord = null;
  }

  const doRecord = () => {
    const snapshot: GraphSnapshot = {
      json: graph.toJSON(),
      selectedNodeId,
      selectedAnnotationId,
      timestamp: Date.now()
    };

    historyState.update(state => {
      const newPast = [...state.past, snapshot];
      // Limit history size
      if (newPast.length > MAX_HISTORY) {
        newPast.shift();
      }
      return {
        past: newPast,
        future: [] // Clear redo stack on new edit
      };
    });

    lastRecordTime = Date.now();
  };

  if (immediate) {
    doRecord();
  } else if (debounce) {
    const now = Date.now();
    if (now - lastRecordTime < DEBOUNCE_MS) {
      // Debounce - wait before recording
      pendingRecord = setTimeout(doRecord, DEBOUNCE_MS);
    } else {
      doRecord();
    }
  } else {
    doRecord();
  }
}

/**
 * Record immediately without any debouncing
 * Use for discrete operations like creating/deleting nodes
 */
export function recordSnapshotImmediate(
  graph: Graph,
  selectedNodeId: string | null,
  selectedAnnotationId: string | null
): void {
  recordSnapshot(graph, selectedNodeId, selectedAnnotationId, { immediate: true });
}

/**
 * Pop and return the most recent snapshot for undo
 * Returns null if no history available
 */
export function popUndo(
  currentGraph: Graph,
  currentSelectedNodeId: string | null,
  currentSelectedAnnotationId: string | null
): GraphSnapshot | null {
  const state = get(historyState);
  if (state.past.length === 0) return null;

  // Save current state to future for redo
  const currentSnapshot: GraphSnapshot = {
    json: currentGraph.toJSON(),
    selectedNodeId: currentSelectedNodeId,
    selectedAnnotationId: currentSelectedAnnotationId,
    timestamp: Date.now()
  };

  const snapshot = state.past[state.past.length - 1];

  historyState.update(s => ({
    past: s.past.slice(0, -1),
    future: [currentSnapshot, ...s.future]
  }));

  return snapshot;
}

/**
 * Pop and return the most recent redo snapshot
 * Returns null if no redo available
 */
export function popRedo(
  currentGraph: Graph,
  currentSelectedNodeId: string | null,
  currentSelectedAnnotationId: string | null
): GraphSnapshot | null {
  const state = get(historyState);
  if (state.future.length === 0) return null;

  // Save current state to past
  const currentSnapshot: GraphSnapshot = {
    json: currentGraph.toJSON(),
    selectedNodeId: currentSelectedNodeId,
    selectedAnnotationId: currentSelectedAnnotationId,
    timestamp: Date.now()
  };

  const snapshot = state.future[0];

  historyState.update(s => ({
    past: [...s.past, currentSnapshot],
    future: s.future.slice(1)
  }));

  return snapshot;
}

/**
 * Clear all history (e.g., when loading a new document)
 */
export function clearHistory(): void {
  if (pendingRecord) {
    clearTimeout(pendingRecord);
    pendingRecord = null;
  }
  historyState.set({
    past: [],
    future: []
  });
  lastRecordTime = 0;
}

/**
 * Get the current history state (for debugging)
 */
export function getHistoryState(): HistoryState {
  return get(historyState);
}
