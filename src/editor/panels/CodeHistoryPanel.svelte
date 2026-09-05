<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { monaco } from '../monaco';
  import { monacoThemeFor } from '../theme';
  import { resolvedTheme } from '../themeController';
  import type { CodeVersion } from '@/types/node.types';
  import { CodeHistory as CodeHistoryManager } from '../CodeHistory';
  import Icon from '../Icon.svelte';
  import { X, History, RotateCcw, User, Sparkles, ChevronRight, GitCompare } from '@lucide/svelte';

  export let open = false;
  export let modulePath = '';
  export let history: CodeVersion[] = [];
  export let currentCode = '';

  const dispatch = createEventDispatcher<{
    close: void;
    restore: { code: string; versionIndex: number };
  }>();

  let diffContainer: HTMLDivElement;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
  let selectedIndex: number | null = null;
  let showDiff = false;
  let isDestroyed = false;

  // Format timestamp for display
  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return 'Just now';
    }
    // Less than 1 hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    // Same year
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    // Different year
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Get display label for version
  function getVersionLabel(version: CodeVersion, index: number): string {
    if (version.author === 'ai' && version.prompt) {
      // Truncate long prompts
      const prompt = version.prompt.length > 40
        ? version.prompt.substring(0, 40) + '...'
        : version.prompt;
      return `"${prompt}"`;
    }
    if (index === history.length - 1) {
      return 'Current version';
    }
    return 'Manual edit';
  }

  function handleSelectVersion(index: number) {
    selectedIndex = index;
    showDiff = true;
    updateDiffEditor();
  }

  function handleRestore() {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= history.length) {
      return;
    }
    const version = history[selectedIndex];
    dispatch('restore', { code: version.code, versionIndex: selectedIndex });
    handleClose();
  }

  function handleClose() {
    open = false;
    selectedIndex = null;
    showDiff = false;
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showDiff) {
        showDiff = false;
        selectedIndex = null;
      } else {
        handleClose();
      }
    }
  }

  function updateDiffEditor() {
    if (!diffEditor || selectedIndex === null || isDestroyed) return;

    const oldCode = history[selectedIndex]?.code || '';
    const newCode = currentCode;

    const originalModel = monaco.editor.createModel(oldCode, 'typescript');
    const modifiedModel = monaco.editor.createModel(newCode, 'typescript');

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });
  }

  function initDiffEditor() {
    if (!diffContainer || isDestroyed) return;

    diffEditor = monaco.editor.createDiffEditor(diffContainer, {
      theme: monacoThemeFor($resolvedTheme),
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      originalEditable: false
    });

    if (selectedIndex !== null) {
      updateDiffEditor();
    }
  }

  onMount(() => {
    if (showDiff && diffContainer) {
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

  // Re-initialize diff editor when showing diff
  $: if (showDiff && diffContainer && !diffEditor && !isDestroyed) {
    initDiffEditor();
  }

  // Cleanup diff editor when hiding diff
  $: if (!showDiff && diffEditor) {
    diffEditor.dispose();
    diffEditor = null;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click|self={handleClose}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">
          <History size={20} />
          Version History
        </h2>
        <span class="module-path">{modulePath}</span>
        <button class="close-button" on:click={handleClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div class="modal-body">
        <div class="history-sidebar" class:narrow={showDiff}>
          <div class="history-list">
            {#each [...history].reverse() as version, i}
              {@const actualIndex = history.length - 1 - i}
              <button
                class="history-item"
                class:selected={selectedIndex === actualIndex}
                class:current={actualIndex === history.length - 1}
                on:click={() => handleSelectVersion(actualIndex)}
              >
                <div class="item-icon">
                  {#if version.author === 'ai'}
                    <Sparkles size={16} />
                  {:else}
                    <User size={16} />
                  {/if}
                </div>
                <div class="item-content">
                  <div class="item-label">{getVersionLabel(version, actualIndex)}</div>
                  <div class="item-time">{formatTime(version.timestamp)}</div>
                </div>
                {#if selectedIndex === actualIndex}
                  <ChevronRight size={16} class="item-arrow" />
                {/if}
              </button>
            {/each}
          </div>
        </div>

        {#if showDiff}
          <div class="diff-panel">
            <div class="diff-header">
              <div class="diff-labels">
                <span class="diff-label old">
                  <GitCompare size={14} />
                  Selected version
                </span>
                <span class="diff-label new">Current</span>
              </div>
              {#if selectedIndex !== null && selectedIndex < history.length - 1}
                <button class="restore-button" on:click={handleRestore}>
                  <RotateCcw size={14} />
                  Restore This Version
                </button>
              {/if}
            </div>
            <div class="diff-container" bind:this={diffContainer}></div>
          </div>
        {:else}
          <div class="empty-diff">
            <GitCompare size={48} />
            <p>Select a version to compare with current</p>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <div class="footer-info">
          {history.length} version{history.length !== 1 ? 's' : ''}
        </div>
        <button class="close-footer-button" on:click={handleClose}>
          Close
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
    background: var(--shade-stronger);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--surface-panel-alt);
    border-radius: 8px;
    box-shadow: 0 20px 60px var(--shadow);
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
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .modal-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-bright);
  }

  .module-path {
    flex: 1;
    font-size: 13px;
    color: var(--text-subtle);
    font-family: 'SF Mono', Monaco, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-button {
    background: transparent;
    border: none;
    color: var(--text-subtle);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    background: var(--tint);
    color: var(--text-bright);
  }

  .modal-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .history-sidebar {
    width: 280px;
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    transition: width 0.2s ease;
  }

  .history-sidebar.narrow {
    width: 240px;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    transition: background 0.15s;
    margin-bottom: 4px;
  }

  .history-item:hover {
    background: var(--tint-weak);
  }

  .history-item.selected {
    background: var(--accent-tint);
    color: var(--text-bright);
  }

  .history-item.current {
    border-left: 3px solid var(--status-ok);
  }

  .item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--tint);
    border-radius: 50%;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .history-item.selected .item-icon {
    background: var(--accent-tint-strong);
    color: var(--accent);
  }

  .history-item :global(.item-arrow) {
    color: var(--accent);
    flex-shrink: 0;
  }

  .item-content {
    flex: 1;
    min-width: 0;
  }

  .item-label {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-time {
    font-size: 11px;
    color: var(--text-faintest);
    margin-top: 2px;
  }

  .history-item.selected .item-time {
    color: var(--text-subtle);
  }

  .diff-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-subtle);
  }

  .diff-labels {
    display: flex;
    gap: 24px;
  }

  .diff-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .diff-label.old {
    color: var(--status-error);
  }

  .diff-label.new {
    color: var(--status-ok);
  }

  .restore-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--status-ok-tint);
    color: var(--status-ok);
    border: 1px solid var(--status-ok-tint-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .restore-button:hover {
    background: var(--status-ok-tint-strong);
    border-color: var(--status-ok);
  }

  .diff-container {
    flex: 1;
    min-height: 0;
  }

  .empty-diff {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-disabled);
  }

  .empty-diff p {
    margin: 0;
    font-size: 14px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--border-subtle);
  }

  .footer-info {
    font-size: 13px;
    color: var(--text-subtle);
  }

  .close-footer-button {
    padding: 8px 16px;
    background: var(--tint);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .close-footer-button:hover {
    background: var(--tint-medium);
    color: var(--text-bright);
  }
</style>
