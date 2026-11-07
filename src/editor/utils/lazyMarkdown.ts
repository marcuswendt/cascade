/**
 * `renderMarkdown`, fetched the first time something subscribes.
 *
 * marked and DOMPurify are ~70 KB, and the only first-paint user is a text
 * annotation on the canvas, which most graphs do not have. Until the module
 * arrives the store holds null and the annotation shows its text as plain,
 * escaped text; a frame later it is Markdown.
 */
import { readable } from 'svelte/store';
import type { renderMarkdown } from './renderMarkdown';

type Render = typeof renderMarkdown;

let loaded: Render | null = null;
let loading: Promise<Render> | null = null;

export function loadMarkdown(): Promise<Render> {
  loading ??= import('./renderMarkdown').then(module => (loaded = module.renderMarkdown));
  return loading;
}

export const markdownRenderer = readable<Render | null>(loaded, set => {
  if (loaded) {
    set(loaded);
    return;
  }
  let live = true;
  void loadMarkdown().then(render => {
    if (live) set(render);
  });
  return () => {
    live = false;
  };
});
