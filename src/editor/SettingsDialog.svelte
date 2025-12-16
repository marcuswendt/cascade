<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    settingsStore,
    SERVICE_PRESETS,
    type APIKeyEntry,
    type UserSettings,
    type AIServiceType
  } from './stores/settingsStore';

  export let open = false;
  /** If set, auto-adds a new API key entry for this service when dialog opens */
  export let initialService: AIServiceType | null = null;

  const dispatch = createEventDispatcher();

  type TabId = 'apiKeys' | 'appearance' | 'project';

  let activeTab: TabId = 'apiKeys';
  let localSettings: UserSettings;
  let showKeyIds: Set<string> = new Set();
  let wasOpen = false;

  // Initialize settings only when dialog transitions from closed to open
  $: if (open && !wasOpen) {
    wasOpen = true;
    const currentSettings = $settingsStore;
    localSettings = JSON.parse(JSON.stringify(currentSettings));
    showKeyIds = new Set();
    activeTab = 'apiKeys';

    if (initialService) {
      const hasKey = localSettings.apiKeys.some(k => k.service === initialService);
      if (!hasKey) {
        const preset = SERVICE_PRESETS.find(p => p.value === initialService);
        const newEntry: APIKeyEntry = {
          id: crypto.randomUUID(),
          service: initialService,
          label: preset?.label || initialService,
          key: ''
        };
        localSettings.apiKeys = [...localSettings.apiKeys, newEntry];
      }
      initialService = null;
    }
  } else if (!open && wasOpen) {
    wasOpen = false;
  }

  function getPresetForService(service: string) {
    return SERVICE_PRESETS.find(p => p.value === service);
  }

  function getAvailablePresetsForEntry(entry: APIKeyEntry) {
    const usedServices = new Set(
      localSettings.apiKeys
        .filter(k => k.id !== entry.id)
        .map(k => k.service)
    );

    return SERVICE_PRESETS.filter(preset =>
      preset.value === 'custom' ||
      preset.value === entry.service ||
      !usedServices.has(preset.value)
    );
  }

  function handleClose() {
    open = false;
    dispatch('close');
  }

  function handleSave() {
    settingsStore.set(localSettings);
    open = false;
    dispatch('close');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  function addApiKey() {
    const usedServices = new Set(localSettings.apiKeys.map(k => k.service));
    const availablePreset = SERVICE_PRESETS.find(p =>
      p.value === 'custom' || !usedServices.has(p.value)
    ) || SERVICE_PRESETS[0];

    const newEntry: APIKeyEntry = {
      id: crypto.randomUUID(),
      service: availablePreset.value as APIKeyEntry['service'],
      label: availablePreset.label,
      key: ''
    };
    localSettings.apiKeys = [...localSettings.apiKeys, newEntry];
  }

  function removeApiKey(id: string) {
    localSettings.apiKeys = localSettings.apiKeys.filter(k => k.id !== id);
  }

  function handleServiceChange(entry: APIKeyEntry, service: string) {
    entry.service = service as APIKeyEntry['service'];
    const preset = SERVICE_PRESETS.find(p => p.value === service);
    if (preset && service !== 'custom') {
      entry.label = preset.label;
      delete entry.endpoint;
    } else if (service === 'custom') {
      entry.label = '';
      entry.endpoint = '';
    }
    localSettings.apiKeys = localSettings.apiKeys;
  }

  function toggleShowKey(id: string) {
    if (showKeyIds.has(id)) {
      showKeyIds.delete(id);
    } else {
      showKeyIds.add(id);
    }
    showKeyIds = showKeyIds;
  }

  function maskKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••' + key.slice(-4);
  }

  const tabs = [
    { id: 'apiKeys' as TabId, label: 'API Keys', group: 'user' },
    { id: 'appearance' as TabId, label: 'Appearance', group: 'user' },
    { id: 'project' as TabId, label: 'Project', group: 'project' }
  ];
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <div class="overlay" on:click|self={handleClose}>
    <div class="dialog" on:click|stopPropagation>
      <div class="header">
        <h2>Settings</h2>
        <button class="close-button" on:click={handleClose}>×</button>
      </div>

      <div class="tabs">
        <div class="tab-group">
          <span class="tab-group-label">User</span>
          {#each tabs.filter(t => t.group === 'user') as tab}
            <button
              class="tab"
              class:active={activeTab === tab.id}
              on:click={() => activeTab = tab.id}
            >
              {tab.label}
            </button>
          {/each}
        </div>
        <div class="tab-group">
          <span class="tab-group-label">Project</span>
          {#each tabs.filter(t => t.group === 'project') as tab}
            <button
              class="tab"
              class:active={activeTab === tab.id}
              on:click={() => activeTab = tab.id}
            >
              {tab.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="content">
        {#if activeTab === 'apiKeys'}
          <div class="section">
            <p class="section-description">
              API keys are stored locally and never included in exports.
            </p>

            <div class="api-key-list">
              {#each localSettings.apiKeys as entry (entry.id)}
                {#if entry.service === 'custom'}
                  <!-- Custom entry: name, endpoint, key -->
                  <div class="api-key-row custom">
                    <input
                      type="text"
                      class="name-input"
                      bind:value={entry.label}
                      placeholder="Name"
                    />
                    <input
                      type="text"
                      class="endpoint-input"
                      bind:value={entry.endpoint}
                      placeholder="Endpoint URL"
                    />
                    <div class="key-cell">
                      {#if showKeyIds.has(entry.id)}
                        <input
                          type="text"
                          class="key-input"
                          bind:value={entry.key}
                          placeholder="API Key"
                        />
                      {:else}
                        <input
                          type="password"
                          class="key-input"
                          bind:value={entry.key}
                          placeholder="API Key"
                        />
                      {/if}
                      <button
                        class="toggle-btn"
                        on:click={() => toggleShowKey(entry.id)}
                        title={showKeyIds.has(entry.id) ? 'Hide' : 'Show'}
                      >
                        {showKeyIds.has(entry.id) ? '◠' : '◡'}
                      </button>
                    </div>
                    <button class="remove-btn" on:click={() => removeApiKey(entry.id)}>×</button>
                  </div>
                {:else}
                  <!-- Standard provider row -->
                  <div class="api-key-row">
                    <select
                      class="provider-select"
                      value={entry.service}
                      on:change={(e) => handleServiceChange(entry, e.currentTarget.value)}
                    >
                      {#each getAvailablePresetsForEntry(entry) as preset}
                        <option value={preset.value}>{preset.label}</option>
                      {/each}
                    </select>
                    <div class="key-cell">
                      {#if entry.key}
                        {#if showKeyIds.has(entry.id)}
                          <input
                            type="text"
                            class="key-input"
                            bind:value={entry.key}
                            placeholder="API Key"
                          />
                        {:else}
                          <input
                            type="password"
                            class="key-input"
                            bind:value={entry.key}
                            placeholder="API Key"
                          />
                        {/if}
                        <button
                          class="toggle-btn"
                          on:click={() => toggleShowKey(entry.id)}
                          title={showKeyIds.has(entry.id) ? 'Hide' : 'Show'}
                        >
                          {showKeyIds.has(entry.id) ? '◠' : '◡'}
                        </button>
                      {:else}
                        <input
                          type="password"
                          class="key-input"
                          bind:value={entry.key}
                          placeholder="Enter API key"
                        />
                        {#if getPresetForService(entry.service)?.keyUrl}
                          <a
                            href={getPresetForService(entry.service)?.keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="get-key-link"
                          >
                            Get Key
                          </a>
                        {/if}
                      {/if}
                    </div>
                    <button class="remove-btn" on:click={() => removeApiKey(entry.id)}>×</button>
                  </div>
                {/if}
              {/each}

              <button class="add-row-btn" on:click={addApiKey}>
                +
              </button>
            </div>
          </div>

        {:else if activeTab === 'appearance'}
          <div class="section">
            <div class="setting-group">
              <h3>Editor</h3>
              <div class="setting-row">
                <label for="fontSize">Font Size</label>
                <div class="slider-control">
                  <input
                    type="range"
                    id="fontSize"
                    min="10"
                    max="24"
                    step="1"
                    bind:value={localSettings.editor.fontSize}
                  />
                  <span class="slider-value">{localSettings.editor.fontSize}px</span>
                </div>
              </div>
            </div>
          </div>

        {:else if activeTab === 'project'}
          <div class="section">
            <div class="coming-soon">
              Project settings coming soon.
            </div>
          </div>
        {/if}
      </div>

      <div class="footer">
        <button class="cancel-button" on:click={handleClose}>Cancel</button>
        <button class="save-button" on:click={handleSave}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .dialog {
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: 90%;
    max-width: 550px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header h2 {
    margin: 0;
    color: #fff;
    font-size: 18px;
    font-weight: 600;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .tabs {
    display: flex;
    gap: 24px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }

  .tab-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tab-group-label {
    color: #666;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 8px;
  }

  .tab {
    background: transparent;
    border: none;
    color: #888;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #ccc;
  }

  .tab.active {
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-description {
    color: #888;
    font-size: 12px;
    margin: 0;
    padding: 8px 12px;
    background: rgba(74, 158, 255, 0.1);
    border: 1px solid rgba(74, 158, 255, 0.2);
    border-radius: 4px;
  }

  /* Compact API Key List */
  .api-key-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .api-key-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #333;
    border-radius: 4px;
  }

  .api-key-row.custom {
    flex-wrap: wrap;
  }

  .provider-select {
    width: 140px;
    flex-shrink: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
  }

  .provider-select:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .name-input,
  .endpoint-input {
    flex: 1;
    min-width: 100px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 12px;
  }

  .name-input {
    max-width: 120px;
  }

  .name-input:focus,
  .endpoint-input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .key-cell {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .key-input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .key-input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .key-input::placeholder {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: #555;
  }

  .toggle-btn {
    background: transparent;
    border: none;
    color: #666;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 3px;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #aaa;
  }

  .get-key-link {
    flex-shrink: 0;
    color: #4a9eff;
    font-size: 11px;
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 3px;
    background: rgba(74, 158, 255, 0.1);
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .get-key-link:hover {
    background: rgba(74, 158, 255, 0.2);
    color: #6bb8ff;
  }

  .remove-btn {
    background: transparent;
    border: none;
    color: #555;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    background: rgba(255, 68, 68, 0.2);
    color: #ff6b6b;
  }

  .add-row-btn {
    background: transparent;
    border: 1px dashed #404040;
    border-radius: 4px;
    color: #666;
    font-size: 16px;
    padding: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-row-btn:hover {
    border-color: #4a9eff;
    color: #4a9eff;
    background: rgba(74, 158, 255, 0.1);
  }

  .coming-soon {
    color: #666;
    font-size: 14px;
    text-align: center;
    padding: 48px 24px;
  }

  .footer {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    justify-content: flex-end;
  }

  .cancel-button,
  .save-button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-button {
    background: transparent;
    color: #aaa;
  }

  .cancel-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .save-button {
    background: #4a9eff;
    color: white;
  }

  .save-button:hover {
    background: #357abd;
  }

  /* Setting Groups */
  .setting-group {
    margin-bottom: 24px;
  }

  .setting-group h3 {
    margin: 0 0 12px 0;
    font-size: 13px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #404040;
    border-radius: 6px;
    margin-bottom: 8px;
  }

  .setting-row label {
    color: #ccc;
    font-size: 14px;
  }

  .slider-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-control input[type="range"] {
    width: 120px;
    height: 4px;
    background: #404040;
    border-radius: 2px;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }

  .slider-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .slider-control input[type="range"]::-webkit-slider-thumb:hover {
    background: #357abd;
  }

  .slider-value {
    min-width: 40px;
    text-align: right;
    color: #fff;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, monospace;
  }
</style>
