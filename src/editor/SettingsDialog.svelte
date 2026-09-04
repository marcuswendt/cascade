<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { settingsStore, setSettings, type UserSettings } from './stores/settingsStore';
  import { THEME_PREFERENCES, type ThemePreference } from './theme';

  const THEME_LABELS: Record<ThemePreference, string> = {
    auto: 'Auto',
    dark: 'Dark',
    light: 'Light'
  };

  export let open = false;

  const dispatch = createEventDispatcher();
  let localSettings: UserSettings;
  let overlay: HTMLDivElement;
  let wasOpen = false;

  $: if (open && !wasOpen) {
    wasOpen = true;
    localSettings = structuredClone($settingsStore);
  } else if (!open && wasOpen) {
    wasOpen = false;
  }

  function close() {
    open = false;
    dispatch('close');
  }

  function save() {
    setSettings(localSettings);
    close();
  }
</script>

<svelte:window
  on:keydown={(event) => event.key === 'Escape' && close()}
  on:mousedown={(event) => open && event.target === overlay && close()}
/>

{#if open}
  <div class="overlay" bind:this={overlay}>
    <div class="dialog">
      <header>
        <h2>Settings</h2>
        <button class="icon-button" on:click={close} aria-label="Close settings">×</button>
      </header>

      <main>
        <h3>Appearance</h3>
        <div class="setting-row">
          <span class="setting-label" id="theme-label">Theme</span>
          <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
            {#each THEME_PREFERENCES as preference}
              <button
                type="button"
                role="radio"
                aria-checked={localSettings.appearance.theme === preference}
                class:selected={localSettings.appearance.theme === preference}
                on:click={() => (localSettings.appearance.theme = preference)}
              >{THEME_LABELS[preference]}</button>
            {/each}
          </div>
        </div>

        <h3 class="section">Editor</h3>
        <div class="setting-row">
          <label for="font-size">Font size</label>
          <input
            id="font-size"
            type="range"
            min="10"
            max="24"
            step="1"
            bind:value={localSettings.editor.fontSize}
          />
          <output>{localSettings.editor.fontSize}px</output>
        </div>
      </main>

      <footer>
        <button on:click={close}>Cancel</button>
        <button class="primary" on:click={save}>Save</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: var(--shade-stronger);
    backdrop-filter: blur(4px);
  }

  .dialog {
    width: min(90vw, 520px);
    overflow: hidden;
    color: var(--text-primary);
    background: var(--surface-panel-alt);
    border: 1px solid var(--border-raised);
    border-radius: 8px;
    box-shadow: 0 10px 40px var(--shadow);
  }

  header,
  footer {
    display: flex;
    align-items: center;
    padding: 16px 20px;
  }

  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--border-subtle);
  }

  header h2,
  main h3 {
    margin: 0;
  }

  main h3.section {
    margin-top: 28px;
  }

  .setting-label {
    font-size: 13px;
  }

  .segmented {
    display: flex;
    gap: 4px;
  }

  .segmented button {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
  }

  .segmented button.selected {
    color: var(--text-on-accent);
    background: var(--accent-alt-deep);
    border-color: var(--accent-alt-hover);
  }

  main {
    padding: 24px 20px;
  }

  .setting-row {
    display: grid;
    grid-template-columns: 100px 1fr 48px;
    gap: 12px;
    align-items: center;
    margin-top: 20px;
  }

  output {
    color: var(--text-muted);
    text-align: right;
  }

  footer {
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--border-subtle);
  }

  button {
    padding: 8px 16px;
    color: var(--text-primary);
    cursor: pointer;
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  button:hover {
    background: var(--surface-active);
  }

  .icon-button {
    padding: 0 6px;
    font-size: 24px;
    background: transparent;
    border: 0;
  }

  .primary {
    color: var(--text-on-accent);
    background: var(--accent-alt-deep);
    border-color: var(--accent-alt-hover);
  }

  .primary:hover {
    background: var(--accent-alt-hover);
  }
</style>
