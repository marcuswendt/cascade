import { writable } from 'svelte/store';
import type { NodeTemplate } from '../nodeTemplates';

const STORAGE_KEY = 'cascade-node-history';
const MAX_HISTORY = 5;

// Load history from localStorage
function loadHistory(): NodeTemplate[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load node history:', e);
  }
  return [];
}

// Save history to localStorage
function saveHistory(history: NodeTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('Failed to save node history:', e);
  }
}

// Create the store
function createNodeHistoryStore() {
  const { subscribe, set, update } = writable<NodeTemplate[]>(loadHistory());

  return {
    subscribe,

    // Add a node to history (most recent first, no duplicates)
    addToHistory(node: NodeTemplate) {
      update(history => {
        // Remove if already exists
        const filtered = history.filter(n => n.type !== node.type);
        // Add to front
        const newHistory = [node, ...filtered].slice(0, MAX_HISTORY);
        saveHistory(newHistory);
        return newHistory;
      });
    },

    // Clear history
    clear() {
      set([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };
}

export const nodeHistoryStore = createNodeHistoryStore();
