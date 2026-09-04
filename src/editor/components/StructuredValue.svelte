<script lang="ts">
  import JsonTree from './JsonTree.svelte';

  export let value: any;
  export let type = 'object';
  export let readOnly = false;
  export let onChange: ((value: any) => void) | null = null;

  let draft = '';
  let sourceValue: any;
  let error = '';

  $: if (value !== sourceValue) {
    sourceValue = value;
    draft = stringify(value);
    error = '';
  }

  function stringify(next: any): string {
    if (next === undefined) return '';
    try {
      return JSON.stringify(next, null, 2);
    } catch {
      return String(next);
    }
  }

  function commit() {
    if (readOnly || !onChange) return;
    try {
      const parsed = JSON.parse(draft);
      if (type === 'array' && !Array.isArray(parsed)) {
        error = 'Expected an array';
        return;
      }
      if (type === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) {
        error = 'Expected an object';
        return;
      }
      error = '';
      sourceValue = parsed;
      onChange(parsed);
    } catch {
      error = 'Invalid JSON';
    }
  }

  function keydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }
</script>

{#if readOnly}
  <div class="tree"><JsonTree {value} /></div>
{:else}
  <textarea
    bind:value={draft}
    aria-label="{type} JSON"
    spellcheck="false"
    on:blur={commit}
    on:keydown={keydown}
  ></textarea>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  <div class="hint">Apply with blur or ⌘/Ctrl Enter</div>
{/if}

<style>
  textarea {
    width: 100%;
    min-height: 96px;
    resize: vertical;
    box-sizing: border-box;
    border: 1px solid var(--border-raised);
    border-radius: 4px;
    background: var(--surface-app);
    color: var(--text-code);
    padding: 7px;
    font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent-alt-deep);
  }

  .tree {
    max-height: 320px;
    overflow: auto;
  }

  .error {
    margin-top: 4px;
    color: var(--status-error-soft);
    font-size: 9px;
  }

  .hint {
    margin-top: 3px;
    color: var(--text-faintest);
    font-size: 8px;
  }
</style>
