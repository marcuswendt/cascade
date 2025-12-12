<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { RefreshCw, Download, X, FileCode } from 'lucide-svelte';

  export let filePath = '';
  export let show = false;

  const dispatch = createEventDispatcher<{
    reload: void;
    dismiss: void;
    showDiff: void;
  }>();

  function handleReload() {
    dispatch('reload');
  }

  function handleShowDiff() {
    dispatch('showDiff');
  }

  function handleDismiss() {
    show = false;
    dispatch('dismiss');
  }
</script>

{#if show}
  <div class="external-modified-banner">
    <div class="banner-icon">
      <RefreshCw size={16} />
    </div>
    <div class="banner-content">
      <span class="banner-text">External file has been modified</span>
      <span class="file-path">{filePath}</span>
    </div>
    <div class="banner-actions">
      <button class="action-button diff" on:click={handleShowDiff} title="Compare changes">
        <FileCode size={14} />
        Compare
      </button>
      <button class="action-button reload" on:click={handleReload} title="Reload from disk">
        <Download size={14} />
        Reload
      </button>
      <button class="dismiss-button" on:click={handleDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  </div>
{/if}

<style>
  .external-modified-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(33, 150, 243, 0.15);
    border-bottom: 1px solid rgba(33, 150, 243, 0.3);
  }

  .banner-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2196f3;
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .banner-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .banner-text {
    font-size: 13px;
    font-weight: 500;
    color: #2196f3;
  }

  .file-path {
    font-size: 11px;
    font-family: 'SF Mono', Monaco, monospace;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #aaa;
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .action-button.reload {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
    border-color: rgba(33, 150, 243, 0.3);
  }

  .action-button.reload:hover {
    background: rgba(33, 150, 243, 0.3);
    border-color: #2196f3;
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
</style>
