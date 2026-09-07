/**
 * The one thing a panel needs to know about the open document, and the one
 * thing it needs to be able to do to it.
 *
 * The agent console has to save before it hands a prompt over: the agent
 * rewrites the `.cascade` file, so if Studio is still holding unsaved changes
 * then both sides believe they won and the loss is silent. Saving first removes
 * the whole class of conflict, and saves are already versioned, so the cost is
 * one version entry.
 *
 * Saving lives in App.svelte and panels are mounted through dockview rather
 * than as children, so there is no prop path from one to the other. A tiny
 * registration is the honest version of that: App registers what it owns, and a
 * panel that finds nothing registered refuses to send rather than guessing that
 * the document is clean.
 */

export interface StudioDocumentBridge {
  /** The project-relative `.cascade` filename, or null when the open document
   *  is not a project file (an imported graph, or Studio without the CLI). */
  file(): string | null;
  isDirty(): boolean;
  /** True when the document is saved afterwards. False when the save failed or
   *  the document cannot be written back to the project. */
  save(): Promise<boolean>;
}

let bridge: StudioDocumentBridge | null = null;

/** Called by App.svelte on mount. Returns a disposer. */
export function registerStudioDocumentBridge(next: StudioDocumentBridge): () => void {
  bridge = next;
  return () => {
    if (bridge === next) bridge = null;
  };
}

export function studioDocument(): StudioDocumentBridge | null {
  return bridge;
}
