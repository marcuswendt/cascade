import { writable, get } from 'svelte/store';

const STORAGE_KEY = 'cascade-user-settings';

/**
 * Supported AI service providers
 */
export type AIServiceType = 'anthropic' | 'openai' | 'google' | 'replicate' | 'fal' | 'custom';

/**
 * API Key entry for external services
 */
export interface APIKeyEntry {
  id: string;
  service: AIServiceType;
  label: string;
  key: string;
  endpoint?: string;
}

/**
 * Predefined service options with API key URLs
 */
export const SERVICE_PRESETS = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude models for text and vision'
  },
  {
    value: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT models and DALL-E image generation'
  },
  {
    value: 'google',
    label: 'Google AI',
    keyUrl: 'https://aistudio.google.com/apikey',
    description: 'Gemini models and Imagen'
  },
  {
    value: 'replicate',
    label: 'Replicate',
    keyUrl: 'https://replicate.com/account/api-tokens',
    description: 'Flux, Stable Diffusion, and more'
  },
  {
    value: 'fal',
    label: 'Fal.ai',
    keyUrl: 'https://fal.ai/dashboard/keys',
    description: 'Fast Flux and image models'
  },
  {
    value: 'custom',
    label: 'Custom',
    keyUrl: undefined,
    description: 'Custom API endpoint'
  }
] as const;

/**
 * Default model preferences
 */
export interface DefaultModels {
  textModel: string | null;  // LLM model ID
  imageModel: string | null; // Image generation model ID
}

/**
 * User settings - stored locally, never shared with project files
 */
export interface UserSettings {
  apiKeys: APIKeyEntry[];
  defaults: DefaultModels;
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
    defaults: {
      textModel: null,
      imageModel: null
    },
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
        defaults: { ...defaults.defaults, ...parsed.defaults },
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

/**
 * Check if a provider has an API key configured
 */
export function isProviderConfigured(service: AIServiceType): boolean {
  const key = getApiKey(service);
  return !!key && key.trim().length > 0;
}

/**
 * Get the API key URL for a service
 */
export function getApiKeyUrl(service: AIServiceType): string | undefined {
  const preset = SERVICE_PRESETS.find(p => p.value === service);
  return preset?.keyUrl;
}

/**
 * Get preset info for a service
 */
export function getServicePreset(service: AIServiceType) {
  return SERVICE_PRESETS.find(p => p.value === service);
}

/**
 * Get default text (LLM) model
 */
export function getDefaultTextModel(): string | null {
  return get(settingsStore).defaults.textModel;
}

/**
 * Get default image generation model
 */
export function getDefaultImageModel(): string | null {
  return get(settingsStore).defaults.imageModel;
}

/**
 * Update default model settings
 */
export function updateDefaultModels(updates: Partial<DefaultModels>): void {
  settingsStore.update(settings => ({
    ...settings,
    defaults: { ...settings.defaults, ...updates }
  }));
}

export { settingsStore };
