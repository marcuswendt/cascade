import { writable } from 'svelte/store';

// Store to track prop updates for reactivity
// Maps nodeId -> update counter
export const propUpdateCounters = writable<Map<string, number>>(new Map());

export function incrementPropUpdateCounter(nodeId: string) {
  propUpdateCounters.update(counters => {
    const newCounters = new Map(counters);
    newCounters.set(nodeId, (newCounters.get(nodeId) || 0) + 1);
    return newCounters;
  });
}

export function getPropUpdateCounter(nodeId: string | null): number {
  if (!nodeId) return 0;
  let counter = 0;
  propUpdateCounters.subscribe(counters => {
    counter = counters.get(nodeId) || 0;
  })();
  return counter;
}

