/**
 * Wires the renderers to their types. Imported for its side effect by
 * PortEditor, so registration happens once wherever the Inspector is used.
 *
 * Core types first, then the namespaced project ones. The observatory entries
 * are here rather than in the project because a project cannot yet ship a
 * compiled component — see the note in typeRenderers.ts. When it can, these two
 * lines move out and nothing else changes.
 */
import { registerTypeRenderer } from './typeRenderers';
import ObservatoryMoment from './ObservatoryMoment.svelte';
import CloudAnalystMetadata from './CloudAnalystMetadata.svelte';

registerTypeRenderer('observatory.moment', ObservatoryMoment);
// The same component on the loader's ID INPUT: browsing for a moment is an
// input-side act, and looking for it under Outputs is not where anyone looks.
registerTypeRenderer('observatory.moment.id', ObservatoryMoment);
registerTypeRenderer('observatory.cloudanalyst.metadata', CloudAnalystMetadata);
