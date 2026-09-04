import { get, writable } from 'svelte/store';
import { sanitizeThemePreference, type ThemePreference } from '../theme';

const STORAGE_KEY = 'cascade-user-settings';
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

export interface UserSettings {
  appearance: {
    theme: ThemePreference;
  };
  editor: {
    fontSize: number;
  };
}

function sanitizeFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

function sanitizeSettings(value: unknown): UserSettings {
  const stored = value && typeof value === 'object'
    ? value as { appearance?: { theme?: unknown }; editor?: { fontSize?: unknown } }
    : {};
  return {
    appearance: {
      theme: sanitizeThemePreference(stored.appearance?.theme)
    },
    editor: {
      fontSize: sanitizeFontSize(stored.editor?.fontSize)
    }
  };
}

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(stored ? JSON.parse(stored) : undefined);
  } catch (error) {
    console.warn('Failed to load settings:', error);
    return sanitizeSettings(undefined);
  }
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch (error) {
    console.warn('Failed to save settings:', error);
  }
}

const settingsStore = writable<UserSettings>(loadSettings());
settingsStore.subscribe(saveSettings);

export function setSettings(settings: UserSettings): void {
  settingsStore.set(sanitizeSettings(settings));
}

export function getEditorFontSize(): number {
  return get(settingsStore).editor.fontSize;
}

export function getThemePreference(): ThemePreference {
  return get(settingsStore).appearance.theme;
}

export function updateAppearanceSettings(updates: Partial<UserSettings['appearance']>): void {
  settingsStore.update(settings => sanitizeSettings({
    ...settings,
    appearance: { ...settings.appearance, ...updates }
  }));
}

export function updateEditorSettings(updates: Partial<UserSettings['editor']>): void {
  settingsStore.update(settings => sanitizeSettings({
    ...settings,
    editor: { ...settings.editor, ...updates }
  }));
}

export { settingsStore };
