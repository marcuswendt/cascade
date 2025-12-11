import { writable, get } from 'svelte/store';

const STORAGE_KEY = 'cascade-user-settings';

/**
 * API Key entry for external services
 */
export interface APIKeyEntry {
  id: string;
  service: 'anthropic' | 'openai' | 'google' | 'custom';
  label: string;
  key: string;
  endpoint?: string;
}

/**
 * Predefined service options
 */
export const SERVICE_PRESETS = [
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI ChatGPT' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'custom', label: 'Custom' }
] as const;

/**
 * User settings - stored locally, never shared with project files
 */
export interface UserSettings {
  apiKeys: APIKeyEntry[];
  appearance: {
    // Future: theme, accentColor
  };
  editor: {
    fontSize: number;
  };
}

function createDefaultSettings(): UserSettings {
  return {
    apiKeys: [],
    appearance: {},
    editor: {
      fontSize: 12
    }
  };
}

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const defaults = createDefaultSettings();
      // Deep merge to preserve nested defaults
      return {
        ...defaults,
        ...parsed,
        appearance: { ...defaults.appearance, ...parsed.appearance },
        editor: { ...defaults.editor, ...parsed.editor }
      };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return createDefaultSettings();
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

// Create the writable store
const settingsStore = writable<UserSettings>(loadSettings());

// Auto-save on changes
settingsStore.subscribe(value => saveSettings(value));

/**
 * Get an API key by service type
 * For custom services, use getApiKeyByLabel instead
 */
export function getApiKey(service: string): string | undefined {
  const settings = get(settingsStore);
  const entry = settings.apiKeys.find(k => k.service === service);
  return entry?.key;
}

/**
 * Get an API key by its label (useful for custom services)
 */
export function getApiKeyByLabel(label: string): APIKeyEntry | undefined {
  const settings = get(settingsStore);
  return settings.apiKeys.find(k => k.label === label);
}

/**
 * Get all API keys
 */
export function getAllApiKeys(): APIKeyEntry[] {
  return get(settingsStore).apiKeys;
}

/**
 * Add a new API key entry
 */
export function addApiKey(entry: Omit<APIKeyEntry, 'id'>): void {
  settingsStore.update(settings => ({
    ...settings,
    apiKeys: [...settings.apiKeys, { ...entry, id: generateId() }]
  }));
}

/**
 * Update an existing API key entry
 */
export function updateApiKey(id: string, updates: Partial<Omit<APIKeyEntry, 'id'>>): void {
  settingsStore.update(settings => ({
    ...settings,
    apiKeys: settings.apiKeys.map(k =>
      k.id === id ? { ...k, ...updates } : k
    )
  }));
}

/**
 * Remove an API key entry
 */
export function removeApiKey(id: string): void {
  settingsStore.update(settings => ({
    ...settings,
    apiKeys: settings.apiKeys.filter(k => k.id !== id)
  }));
}

/**
 * Replace all settings (used when loading from dialog)
 */
export function setSettings(settings: UserSettings): void {
  settingsStore.set(settings);
}

/**
 * Get the editor font size
 */
export function getEditorFontSize(): number {
  return get(settingsStore).editor.fontSize;
}

/**
 * Update editor settings
 */
export function updateEditorSettings(updates: Partial<UserSettings['editor']>): void {
  settingsStore.update(settings => ({
    ...settings,
    editor: { ...settings.editor, ...updates }
  }));
}

export { settingsStore };
