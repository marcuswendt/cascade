<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { X } from '@lucide/svelte';

  /** The project graph's filename, e.g. "index.cascade". */
  export let filename: string | null = null;
  export let open = false;

  const dispatch = createEventDispatcher();

  interface Version {
    sha: string;
    shortSha: string;
    date: string;
    message: string;
  }

  let versions: Version[] = [];
  let dirty = false;
  let isGitRepo = true;
  let loading = false;
  let error: string | null = null;
  let restoring: string | null = null;

  // Reload whenever the dialog opens, so it never shows a stale history.
  $: if (open && filename) {
    loadVersions(filename);
  }

  async function loadVersions(file: string) {
    loading = true;
    error = null;
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(file)}/versions`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      versions = data.versions ?? [];
      dirty = Boolean(data.dirty);
      isGitRepo = data.isGitRepo !== false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      versions = [];
    } finally {
      loading = false;
    }
  }

  async function restore(version: Version) {
    if (!filename) return;
    restoring = version.sha;
    error = null;
    try {
      const response = await fetch(
        `/api/graph/${encodeURIComponent(filename)}/versions/${version.sha}`
      );
      if (!response.ok) throw new Error(await response.text());
      dispatch('restore', { json: await response.json(), version });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      restoring = null;
    }
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function close() {
    dispatch('close');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dialog-overlay" on:click|self={close}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
      <div class="dialog-header">
        <h2 id="version-history-title">Version History</h2>
        <button class="close-button" on:click={close} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div class="dialog-body">
        <p class="subject">{filename ?? 'No project file'}</p>

        {#if loading}
          <p class="note">Reading history…</p>
        {:else if error}
          <p class="note error">{error}</p>
        {:else if !isGitRepo}
          <p class="note">
            This project isn't a git repository yet, so there's nothing to go back to. The next
            save starts a history.
          </p>
        {:else if versions.length === 0}
          <p class="note">No versions yet. The next save becomes the first one.</p>
        {:else}
          {#if dirty}
            <p class="note dirty">Unsaved changes on disk aren't in any version yet.</p>
          {/if}
          <ul class="versions">
            {#each versions as version, index}
              <li>
                <div class="meta">
                  <span class="date">{formatDate(version.date)}</span>
                  <span class="sha">{version.shortSha}</span>
                  {#if index === 0}<span class="tag">current</span>{/if}
                </div>
                <div class="message">{version.message}</div>
                <button
                  class="restore"
                  disabled={restoring !== null}
                  on:click={() => restore(version)}
                >
                  {restoring === version.sha ? 'Opening…' : 'Restore'}
                </button>
              </li>
            {/each}
          </ul>
          <p class="note footnote">
            Restoring loads that version into the editor as unsaved work. Nothing is overwritten
            until you save, and saving it becomes the next version — so this is always reversible.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--shade-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: var(--surface-raised);
    border-radius: 8px;
    border: 1px solid var(--border-divider);
    box-shadow: 0 16px 48px var(--shadow);
    width: 460px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-divider);
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-button {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 2px;
    display: flex;
  }

  .close-button:hover {
    color: var(--text-primary);
  }

  .dialog-body {
    padding: 14px 16px 16px;
    overflow-y: auto;
  }

  .subject {
    margin: 0 0 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--syntax-variable);
  }

  .note {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .note.error {
    color: var(--status-error-soft);
  }

  .note.dirty {
    color: var(--syntax-regexp);
  }

  .footnote {
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
  }

  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .versions li {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'meta button' 'message button';
    gap: 2px 12px;
    align-items: center;
    padding: 9px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .versions li:last-child {
    border-bottom: none;
  }

  .meta {
    grid-area: meta;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-subtle);
  }

  .date {
    color: var(--text-secondary);
  }

  .sha {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .tag {
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--surface-hover);
    color: var(--syntax-variable);
    font-size: 10px;
  }

  .message {
    grid-area: message;
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .restore {
    grid-area: button;
    background: var(--accent-alt-deep);
    border: none;
    border-radius: 4px;
    color: var(--text-on-accent);
    cursor: pointer;
    font-size: 12px;
    padding: 5px 12px;
  }

  .restore:hover:not(:disabled) {
    background: var(--accent-alt-hover);
  }

  .restore:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
