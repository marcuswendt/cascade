<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { X, AlertTriangle, FileCode, Download, Upload, GitMerge } from 'lucide-svelte';

  export let open = false;
  export let modulePath = '';
  export let filePath = '';
  export let localCode = '';
  export let externalCode = '';

  const dispatch = createEventDispatcher<{
    close: void;
    keepLocal: void;
    acceptExternal: void;
    merge: { code: string };
  }>();

  let diffContainer: HTMLDivElement;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
  let isDestroyed = false;

  function handleClose() {
    open = false;
    dispatch('close');
  }

  function handleKeepLocal() {
    dispatch('keepLocal');
    handleClose();
  }

  function handleAcceptExternal() {
    dispatch('acceptExternal');
    handleClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  function initDiffEditor() {
    if (!diffContainer || isDestroyed) return;

    diffEditor = monaco.editor.createDiffEditor(diffContainer, {
      theme: 'vs-dark',
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderOverviewRuler: false
    });

    const originalModel = monaco.editor.createModel(localCode, 'typescript');
    const modifiedModel = monaco.editor.createModel(externalCode, 'typescript');

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });
  }

  onMount(() => {
    if (open && diffContainer) {
      initDiffEditor();
    }
  });

  onDestroy(() => {
    isDestroyed = true;
    if (diffEditor) {
      diffEditor.dispose();
      diffEditor = null;
    }
  });

  $: if (open && diffContainer && !diffEditor && !isDestroyed) {
    initDiffEditor();
  }

  $: if (!open && diffEditor) {
    diffEditor.dispose();
    diffEditor = null;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div class="modal-overlay" on:click={handleClose} on:keydown={handleKeydown} role="button" tabindex="-1">
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <div class="header-title">
          <AlertTriangle size={20} class="warning-icon" />
          <h2 id="modal-title">File Conflict Detected</h2>
        </div>
        <button class="close-button" on:click={handleClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div class="conflict-info">
        <p>
          The external file has been modified while you were editing locally.
          Choose how to resolve this conflict.
        </p>
        <div class="file-info">
          <FileCode size={14} />
          <span class="file-path">{filePath}</span>
        </div>
      </div>

      <div class="diff-section">
        <div class="diff-header">
          <div class="diff-labels">
            <span class="diff-label local">
              <Upload size={14} />
              Your changes (local)
            </span>
            <span class="diff-label external">
              <Download size={14} />
              External changes
            </span>
          </div>
        </div>
        <div class="diff-container" bind:this={diffContainer}></div>
      </div>

      <div class="modal-footer">
        <div class="action-group">
          <button class="action-button keep-local" on:click={handleKeepLocal}>
            <Upload size={16} />
            Keep My Changes
          </button>
          <button class="action-button accept-external" on:click={handleAcceptExternal}>
            <Download size={16} />
            Accept External
          </button>
        </div>
        <button class="cancel-button" on:click={handleClose}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    width: 900px;
    max-width: 95vw;
    height: 600px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-title :global(.warning-icon) {
    color: #ff9800;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .conflict-info {
    padding: 16px 20px;
    background: rgba(255, 152, 0, 0.1);
    border-bottom: 1px solid #333;
  }

  .conflict-info p {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: #ccc;
    line-height: 1.5;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #888;
    font-size: 13px;
  }

  .file-path {
    font-family: 'SF Mono', Monaco, monospace;
    color: #4a9eff;
  }

  .diff-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .diff-header {
    padding: 10px 20px;
    background: #252526;
    border-bottom: 1px solid #333;
  }

  .diff-labels {
    display: flex;
    justify-content: space-between;
  }

  .diff-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .diff-label.local {
    color: #4caf50;
  }

  .diff-label.external {
    color: #2196f3;
  }

  .diff-container {
    flex: 1;
    min-height: 0;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-top: 1px solid #333;
  }

  .action-group {
    display: flex;
    gap: 12px;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .keep-local {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
    border: 1px solid rgba(76, 175, 80, 0.3);
  }

  .keep-local:hover {
    background: rgba(76, 175, 80, 0.3);
    border-color: #4caf50;
  }

  .accept-external {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
    border: 1px solid rgba(33, 150, 243, 0.3);
  }

  .accept-external:hover {
    background: rgba(33, 150, 243, 0.3);
    border-color: #2196f3;
  }

  .cancel-button {
    padding: 10px 20px;
    background: transparent;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .cancel-button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
</style>
