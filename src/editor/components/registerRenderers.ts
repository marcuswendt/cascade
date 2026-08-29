/**
 * Wires the renderers to their types. Imported for its side effect by
 * PortEditor, so registration happens once wherever the Inspector is used.
 *
 * Project renderers are discovered from project panel modules at startup, so
 * this file contains only Cascade's core vocabulary.
 */
import { registerTypeRenderer } from './typeRenderers';
import JsonTree from './JsonTree.svelte';

// Structured values get a real tree rather than a one-line summary — lazy, so
// nothing below the top level is built until it is opened, and windowed, so a
// few thousand curve points cannot lock the tab.
registerTypeRenderer('object', JsonTree);
registerTypeRenderer('array', JsonTree);
