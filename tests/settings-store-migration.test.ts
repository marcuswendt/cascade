/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'cascade-user-settings';

describe('settings storage migration after embedded AI removal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('scrubs legacy provider secrets and model defaults while preserving editor settings', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      apiKeys: [{ id: 'secret', service: 'anthropic', label: 'Claude', key: 'sk-test' }],
      defaults: { textModel: 'claude-old', imageModel: 'imagen-old' },
      appearance: {},
      editor: { fontSize: 17 },
    }));

    const { settingsStore } = await import('@/editor/stores/settingsStore');

    const migrated = get(settingsStore) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('apiKeys');
    expect(migrated).not.toHaveProperty('defaults');
    expect(migrated).toMatchObject({ editor: { fontSize: 17 } });

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('apiKeys');
    expect(persisted).not.toHaveProperty('defaults');
    expect(persisted).toMatchObject({ editor: { fontSize: 17 } });
  });
});
