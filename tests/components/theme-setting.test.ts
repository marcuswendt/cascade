/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { get } from 'svelte/store';

import SettingsDialog from '@/editor/SettingsDialog.svelte';
import {
  DEFAULT_THEME_PREFERENCE,
  monacoThemeFor,
  resolveTheme,
  sanitizeThemePreference,
} from '@/editor/theme';
import {
  getThemePreference,
  updateAppearanceSettings as setStoredTheme,
} from '@/editor/stores/settingsStore';

const STORAGE_KEY = 'cascade-user-settings';

/** A media query list we can flip, which jsdom's own matchMedia cannot do. */
function fakeQuery(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener(_type: 'change', listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'change', listener: () => void) {
      listeners.delete(listener);
    },
    set(next: boolean) {
      this.matches = next;
      for (const listener of listeners) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('theme resolution', () => {
  it('defaults to following the system', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('auto');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('lets an explicit choice beat the system in both directions', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to dark when the host cannot answer the media query', () => {
    expect(resolveTheme('auto', undefined)).toBe('dark');
  });

  it('hands Monaco the built-in that matches', () => {
    expect(monacoThemeFor('dark')).toBe('vs-dark');
    expect(monacoThemeFor('light')).toBe('vs');
  });

  it('treats anything that is not a preference as auto', () => {
    expect(sanitizeThemePreference('midnight')).toBe('auto');
    expect(sanitizeThemePreference(undefined)).toBe('auto');
    expect(sanitizeThemePreference(null)).toBe('auto');
    expect(sanitizeThemePreference('light')).toBe('light');
  });
});

describe('theme controller', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('writes the resolved theme onto the document element and into the store', async () => {
    const { startThemeController, resolvedTheme } = await import('@/editor/themeController');
    const root = document.createElement('div');

    const stop = startThemeController({ root, query: fakeQuery(false) });
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(get(resolvedTheme)).toBe('light');
    stop();
  });

  it('follows the system changing while the app is open', async () => {
    const { startThemeController } = await import('@/editor/themeController');
    const root = document.createElement('div');
    const query = fakeQuery(true);

    const stop = startThemeController({ root, query });
    expect(root.getAttribute('data-theme')).toBe('dark');

    query.set(false);
    expect(root.getAttribute('data-theme')).toBe('light');

    query.set(true);
    expect(root.getAttribute('data-theme')).toBe('dark');

    stop();
    expect(query.listenerCount).toBe(0);
  });

  it('ignores the system once a theme is chosen explicitly', async () => {
    const { startThemeController } = await import('@/editor/themeController');
    const { updateAppearanceSettings } = await import('@/editor/stores/settingsStore');
    const root = document.createElement('div');
    const query = fakeQuery(true);

    const stop = startThemeController({ root, query });

    updateAppearanceSettings({ theme: 'light' });
    expect(root.getAttribute('data-theme')).toBe('light');

    query.set(false);
    expect(root.getAttribute('data-theme')).toBe('light');
    query.set(true);
    expect(root.getAttribute('data-theme')).toBe('light');

    updateAppearanceSettings({ theme: 'auto' });
    expect(root.getAttribute('data-theme')).toBe('dark');

    stop();
  });

  it('stops applying the system after it is disposed', async () => {
    const { startThemeController } = await import('@/editor/themeController');
    const root = document.createElement('div');
    const query = fakeQuery(true);

    startThemeController({ root, query })();
    query.set(false);

    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});

describe('theme preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('survives a reload', async () => {
    const first = await import('@/editor/stores/settingsStore');
    first.updateAppearanceSettings({ theme: 'light' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).appearance.theme).toBe('light');

    vi.resetModules();
    const second = await import('@/editor/stores/settingsStore');
    expect(second.getThemePreference()).toBe('light');
  });

  it('starts on auto when nothing is stored', async () => {
    const { getThemePreference } = await import('@/editor/stores/settingsStore');
    expect(getThemePreference()).toBe('auto');
  });

  it('repairs a stored preference that is no longer a valid choice', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      appearance: { theme: 'solarized' },
      editor: { fontSize: 14 },
    }));

    const { settingsStore } = await import('@/editor/stores/settingsStore');
    expect(get(settingsStore).appearance.theme).toBe('auto');
    expect(get(settingsStore).editor.fontSize).toBe(14);
  });
});

// These mount a component, so they use the statically imported modules: a
// `vi.resetModules()` here would hand the dialog a second copy of Svelte.
describe('SettingsDialog theme picker', () => {
  beforeEach(() => {
    setStoredTheme({ theme: 'auto' });
  });

  it('offers auto, dark and light, and saves the choice', async () => {
    // The dialog is always mounted closed and opened afterwards, as App does it.
    const { getByRole, rerender } = render(SettingsDialog, { props: { open: false } });
    await rerender({ open: true });

    const auto = getByRole('radio', { name: 'Auto' });
    expect(auto.getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: 'Dark' })).toBeTruthy();

    const light = getByRole('radio', { name: 'Light' });
    await fireEvent.click(light);
    expect(light.getAttribute('aria-checked')).toBe('true');
    expect(getThemePreference()).toBe('auto');

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(getThemePreference()).toBe('light');
  });

  it('leaves the stored preference alone when the dialog is cancelled', async () => {
    const { getByRole, rerender } = render(SettingsDialog, { props: { open: false } });
    await rerender({ open: true });

    await fireEvent.click(getByRole('radio', { name: 'Dark' }));
    await fireEvent.click(getByRole('button', { name: 'Cancel' }));

    expect(getThemePreference()).toBe('auto');
  });
});
