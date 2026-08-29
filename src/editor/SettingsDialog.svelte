<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { settingsStore, setSettings, type UserSettings } from './stores/settingsStore';

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
        <h3>Editor</h3>
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
    background: rgb(0 0 0 / 70%);
    backdrop-filter: blur(4px);
  }

  .dialog {
    width: min(90vw, 520px);
    overflow: hidden;
    color: #e5e5e5;
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgb(0 0 0 / 50%);
  }

  header,
  footer {
    display: flex;
    align-items: center;
    padding: 16px 20px;
  }

  header {
    justify-content: space-between;
    border-bottom: 1px solid #333;
  }

  header h2,
  main h3 {
    margin: 0;
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
    color: #aaa;
    text-align: right;
  }

  footer {
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid #333;
  }

  button {
    padding: 8px 16px;
    color: #ddd;
    cursor: pointer;
    background: #333;
    border: 1px solid #4a4a4a;
    border-radius: 4px;
  }

  button:hover {
    background: #404040;
  }

  .icon-button {
    padding: 0 6px;
    font-size: 24px;
    background: transparent;
    border: 0;
  }

  .primary {
    color: white;
    background: #0e639c;
    border-color: #1177bb;
  }

  .primary:hover {
    background: #1177bb;
  }
</style>
