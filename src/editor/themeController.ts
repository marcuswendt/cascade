/**
 * Binds the stored theme preference and the system's colour scheme to the
 * `data-theme` attribute the token stylesheet keys off.
 *
 * The media query is watched for as long as Studio is open, so `auto` follows a
 * system that changes while the application is running rather than only at
 * startup. Both the element and the query are injectable because the resolution
 * this guards is worth testing without a browser.
 */

import { readonly, writable } from 'svelte/store';

import { settingsStore } from './stores/settingsStore';
import {
  FALLBACK_RESOLVED_THEME,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference
} from './theme';

const resolved = writable<ResolvedTheme>(FALLBACK_RESOLVED_THEME);

/**
 * The theme Studio is painting, for the few places that cannot read a CSS
 * custom property: Monaco and anything else drawing with its own palette.
 */
export const resolvedTheme = readonly(resolved);

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeMediaQuery {
  matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

export interface ThemeControllerOptions {
  root?: Pick<HTMLElement, 'setAttribute'>;
  query?: ThemeMediaQuery | null;
  preferences?: {
    subscribe(run: (preference: ThemePreference) => void): () => void;
  };
}

export function applyResolvedTheme(
  root: Pick<HTMLElement, 'setAttribute'>,
  resolved: ResolvedTheme
): void {
  root.setAttribute('data-theme', resolved);
}

function defaultQuery(): ThemeMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(DARK_SCHEME_QUERY);
}

function watch(query: ThemeMediaQuery, onChange: () => void): () => void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }
  // Safari below 14 only has the deprecated listener pair.
  if (typeof query.addListener === 'function') {
    query.addListener(onChange);
    return () => query.removeListener?.(onChange);
  }
  return () => {};
}

/** Returns a disposer; call it when Studio unmounts. */
export function startThemeController(options: ThemeControllerOptions = {}): () => void {
  const root = options.root
    ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  const query = options.query === undefined ? defaultQuery() : options.query;
  const preferences = options.preferences ?? {
    subscribe: (run: (preference: ThemePreference) => void) =>
      settingsStore.subscribe(settings => run(settings.appearance.theme))
  };

  let preference: ThemePreference = 'auto';

  const apply = () => {
    const next = resolveTheme(preference, query ? query.matches : undefined);
    resolved.set(next);
    if (root) applyResolvedTheme(root, next);
  };

  const unsubscribe = preferences.subscribe(next => {
    preference = next;
    apply();
  });
  const unwatch = query ? watch(query, apply) : () => {};

  return () => {
    unwatch();
    unsubscribe();
  };
}
