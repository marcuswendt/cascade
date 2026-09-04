/**
 * Theme resolution, with no DOM in sight so it can be tested on its own.
 *
 * A preference is what the artist chose; a resolved theme is what Studio paints.
 * `auto` is the default and defers to the system, and an explicit `dark` or
 * `light` overrides the system in both directions.
 */

export const THEME_PREFERENCES = ['auto', 'dark', 'light'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = 'dark' | 'light';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'auto';

/** Studio was dark for its whole life, so an unreadable system falls back to dark. */
export const FALLBACK_RESOLVED_THEME: ResolvedTheme = 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function sanitizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

/**
 * `systemPrefersDark` is `undefined` when the host cannot answer the media
 * query at all, which is not the same as answering "not dark".
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean | undefined
): ResolvedTheme {
  if (preference === 'dark' || preference === 'light') {
    return preference;
  }
  if (systemPrefersDark === undefined) {
    return FALLBACK_RESOLVED_THEME;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

/** Monaco carries its own palette, so it is told which of its two built-ins to use. */
export function monacoThemeFor(resolved: ResolvedTheme): 'vs' | 'vs-dark' {
  return resolved === 'light' ? 'vs' : 'vs-dark';
}
