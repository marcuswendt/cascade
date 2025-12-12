<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { AlertTriangle, FileX, RefreshCw, FileCode, FolderSearch, X } from 'lucide-svelte';

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
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid rgba(244, 67, 54, 0.3);
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
    background: rgba(244, 67, 54, 0.2);
    border-radius: 8px;
    color: #f44336;
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
    color: #f44336;
  }

  .file-path {
    margin: 0;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dismiss-button {
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dismiss-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #aaa;
  }

  .warning-message {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 152, 0, 0.1);
    border-radius: 4px;
    font-size: 12px;
    color: #ff9800;
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
    background: rgba(255, 255, 255, 0.05);
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: #555;
  }

  .action-button.restore {
    background: rgba(76, 175, 80, 0.15);
    color: #4caf50;
    border-color: rgba(76, 175, 80, 0.3);
  }

  .action-button.restore:hover {
    background: rgba(76, 175, 80, 0.25);
    border-color: #4caf50;
  }

  .action-button.convert {
    background: rgba(156, 39, 176, 0.15);
    color: #9c27b0;
    border-color: rgba(156, 39, 176, 0.3);
  }

  .action-button.convert:hover {
    background: rgba(156, 39, 176, 0.25);
    border-color: #9c27b0;
  }
</style>
