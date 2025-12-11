<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    settingsStore,
    SERVICE_PRESETS,
    type APIKeyEntry,
    type UserSettings
  } from './stores/settingsStore';

  export let open = false;

  const dispatch = createEventDispatcher();

  type TabId = 'apiKeys' | 'appearance' | 'project';

  let activeTab: TabId = 'apiKeys';
  let localSettings: UserSettings;
  let showKeyIds: Set<string> = new Set();

  // Deep clone settings when dialog opens
  $: if (open) {
    localSettings = JSON.parse(JSON.stringify($settingsStore));
    showKeyIds = new Set();
    activeTab = 'apiKeys';
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
    const newEntry: APIKeyEntry = {
      id: crypto.randomUUID(),
      service: 'anthropic',
      label: 'Anthropic Claude',
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
              API keys are stored locally on your machine and are never included in exported projects.
            </p>

            {#if localSettings.apiKeys.length === 0}
              <div class="empty-state">
                No API keys configured. Click "Add API Key" to add one.
              </div>
            {/if}

            {#each localSettings.apiKeys as entry (entry.id)}
              <div class="api-key-card">
                <div class="api-key-header">
                  <div class="form-group">
                    <label>Service</label>
                    <select
                      value={entry.service}
                      on:change={(e) => handleServiceChange(entry, e.currentTarget.value)}
                    >
                      {#each SERVICE_PRESETS as preset}
                        <option value={preset.value}>{preset.label}</option>
                      {/each}
                    </select>
                  </div>
                  <button
                    class="remove-button"
                    on:click={() => removeApiKey(entry.id)}
                    title="Remove API key"
                  >
                    ×
                  </button>
                </div>

                {#if entry.service === 'custom'}
                  <div class="form-group">
                    <label>Label</label>
                    <input
                      type="text"
                      bind:value={entry.label}
                      placeholder="e.g., ComfyUI Localhost"
                    />
                  </div>
                  <div class="form-group">
                    <label>Endpoint</label>
                    <input
                      type="text"
                      bind:value={entry.endpoint}
                      placeholder="e.g., http://localhost:8188"
                    />
                  </div>
                {/if}

                <div class="form-group">
                  <label>API Key</label>
                  <div class="key-input-wrapper">
                    <input
                      type={showKeyIds.has(entry.id) ? 'text' : 'password'}
                      bind:value={entry.key}
                      placeholder="Enter API key"
                    />
                    <button
                      class="toggle-visibility"
                      on:click={() => toggleShowKey(entry.id)}
                      title={showKeyIds.has(entry.id) ? 'Hide key' : 'Show key'}
                    >
                      {showKeyIds.has(entry.id) ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>
            {/each}

            <button class="add-button" on:click={addApiKey}>
              + Add API Key
            </button>
          </div>

        {:else if activeTab === 'appearance'}
          <div class="section">
            <div class="coming-soon">
              Appearance settings coming soon.
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
        <button class="cancel-button" on:click={handleClose}>
          Cancel
        </button>
        <button class="save-button" on:click={handleSave}>
          Save
        </button>
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
    max-width: 600px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header h2 {
    margin: 0;
    color: #fff;
    font-size: 20px;
    font-weight: 600;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
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
    padding: 12px 20px;
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
    padding: 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-description {
    color: #888;
    font-size: 13px;
    margin: 0;
    padding: 12px;
    background: rgba(74, 158, 255, 0.1);
    border: 1px solid rgba(74, 158, 255, 0.2);
    border-radius: 4px;
  }

  .empty-state {
    color: #666;
    font-size: 14px;
    text-align: center;
    padding: 32px;
    border: 1px dashed #404040;
    border-radius: 6px;
  }

  .api-key-card {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #404040;
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .api-key-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .api-key-header .form-group {
    flex: 1;
    margin: 0;
  }

  .remove-button {
    background: transparent;
    border: none;
    color: #666;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.15s ease;
    margin-top: 20px;
  }

  .remove-button:hover {
    background: rgba(255, 68, 68, 0.2);
    color: #ff6b6b;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    color: #aaa;
    font-size: 12px;
    font-weight: 500;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    box-sizing: border-box;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-group select {
    cursor: pointer;
  }

  .key-input-wrapper {
    display: flex;
    gap: 8px;
  }

  .key-input-wrapper input {
    flex: 1;
  }

  .toggle-visibility {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    padding: 0 12px;
    font-size: 14px;
    transition: all 0.15s ease;
  }

  .toggle-visibility:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .add-button {
    background: transparent;
    border: 1px dashed #404040;
    border-radius: 6px;
    color: #888;
    font-size: 13px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-button:hover {
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
    padding: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    justify-content: flex-end;
  }

  .cancel-button,
  .save-button {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
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
</style>
