<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { AlertTriangle, FileX, RefreshCw, FileCode, FolderSearch, X } from '@lucide/svelte';

  export let filePath = '';
  export let modulePath = '';
  export let show = false;

  const dispatch = createEventDispatcher<{
    restore: void;
    convertToEmbedded: void;
    locate: void;
    dismiss: void;
  }>();

  function handleRestore() {
    dispatch('restore');
  }

  function handleConvertToEmbedded() {
    dispatch('convertToEmbedded');
  }

  function handleLocate() {
    dispatch('locate');
  }

  function handleDismiss() {
    show = false;
    dispatch('dismiss');
  }
</script>

{#if show}
  <div class="missing-file-warning">
    <div class="warning-header">
      <div class="warning-icon">
        <FileX size={20} />
      </div>
      <div class="warning-content">
        <h4>External file not found</h4>
        <p class="file-path">{filePath}</p>
      </div>
      <button class="dismiss-button" on:click={handleDismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>

    <div class="warning-message">
      <AlertTriangle size={14} />
      <span>Using cached version. Changes won't be saved to disk until the file is restored.</span>
    </div>

    <div class="warning-actions">
      <button class="action-button restore" on:click={handleRestore} title="Create the file with cached content">
        <RefreshCw size={14} />
        Restore File
      </button>
      <button class="action-button convert" on:click={handleConvertToEmbedded} title="Convert to embedded module">
        <FileCode size={14} />
        Convert to Embedded
      </button>
      <button class="action-button locate" on:click={handleLocate} title="Browse for file location">
        <FolderSearch size={14} />
        Locate...
      </button>
    </div>
  </div>
{/if}

<style>
  .missing-file-warning {
    background: var(--status-error-tint-weak);
    border: 1px solid var(--status-error-tint-strong);
    border-radius: 8px;
    padding: 12px;
    margin: 8px 12px;
  }

  .warning-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
  }

  .warning-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--status-error-tint);
    border-radius: 8px;
    color: var(--status-danger);
    flex-shrink: 0;
  }

  .warning-content {
    flex: 1;
    min-width: 0;
  }

  .warning-content h4 {
    margin: 0 0 4px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--status-danger);
  }

  .file-path {
    margin: 0;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
    color: var(--text-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dismiss-button {
    background: transparent;
    border: none;
    color: var(--text-faintest);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dismiss-button:hover {
    background: var(--tint);
    color: var(--text-muted);
  }

  .warning-message {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--status-warn-tint-weak);
    border-radius: 4px;
    font-size: 12px;
    color: var(--status-warn);
    margin-bottom: 12px;
  }

  .warning-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--tint-weak);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background: var(--tint);
    color: var(--text-bright);
    border-color: var(--border-strong);
  }

  .action-button.restore {
    background: var(--status-ok-tint-weak);
    color: var(--status-ok);
    border-color: var(--status-ok-tint-strong);
  }

  .action-button.restore:hover {
    background: var(--status-ok-tint);
    border-color: var(--status-ok);
  }

  .action-button.convert {
    background: var(--status-special-tint);
    color: var(--status-special);
    border-color: var(--status-special-tint-strong);
  }

  .action-button.convert:hover {
    background: var(--status-special-tint);
    border-color: var(--status-special);
  }
</style>
