import { writable } from 'svelte/store';

// Store to track which color picker is currently open
// Value is the ID of the open picker, or null if none
export const openColorPickerId = writable<string | null>(null);

