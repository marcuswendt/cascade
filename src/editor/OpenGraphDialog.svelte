<script lang="ts">
  /**
   * Open a graph from the machine running the server, not from the browser's.
   *
   * Marcus, 2026-09-12, from Goa: *"File > Open does not work from this laptop
   * here in Goa as I dont have access to the London hard drive like that. We'd
   * need a custom file opener that shows files on the machine that runs the
   * server."*
   *
   * `handleOpenProject` called `triggerFileInput('.cascade')` — the browser's
   * own file picker, listing the laptop in front of him while the project sat
   * on a machine eight thousand kilometres away. Three of his four graphs were
   * simply unreachable.
   *
   * **This is a picker over data the server already returns.** `GET /api/graph`
   * has always answered with `root`, `isGitRepo`, `graphs` and `default`; the
   * server half of what he asked for in August landed and the menu never
   * caught up. So there is no new endpoint here and no new capability — only
   * the half that was missing.
   *
   * The local file input stays reachable, because a graph that genuinely is on
   * the laptop is a real case: a file someone sent, or one saved before the
   * project existed. It is the second option rather than the only one.
   */
  import { createEventDispatcher } from 'svelte';
  import { X } from '@lucide/svelte';

  export let open = false;
  /** The graph currently open, so the list can mark it. */
  export let current: string | null = null;

  const dispatch = createEventDispatcher();

  let graphs: string[] = [];
  let root = '';
  let loading = false;
  let error: string | null = null;

  // Reload every time it opens: a graph added on the server since the last
  // look should be there, and this is cheap.
  $: if (open) void load();

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await fetch('/api/graph');
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      graphs = Array.isArray(data.graphs) ? data.graphs : [];
      root = typeof data.root === 'string' ? data.root : '';
    } catch (err) {
      // The honest message rather than an empty list: Studio can be served
      // without a project behind it, and "no graphs" would read as an empty
      // project rather than as no server.
      error = err instanceof Error ? err.message : String(err);
      graphs = [];
    } finally {
      loading = false;
    }
  }

  function choose(filename: string) {
    dispatch('choose', { filename });
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
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="open-graph-title">
      <div class="dialog-header">
        <h2 id="open-graph-title">Open graph</h2>
        <button class="close-button" on:click={close} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <!-- The path, because the whole point is knowing WHICH machine these are
           on. Without it the list is indistinguishable from a local one. -->
      {#if root}<p class="root" title={root}>{root}</p>{/if}

      <div class="body">
        {#if loading}
          <p class="note">Loading…</p>
        {:else if error}
          <p class="note error">No project on this server — {error}</p>
        {:else if graphs.length === 0}
          <p class="note">No <code>.cascade</code> files at the project root.</p>
        {:else}
          <ul class="graphs">
            {#each graphs as filename (filename)}
              <li>
                <button
                  class="graph"
                  class:current={filename === current}
                  on:click={() => choose(filename)}
                >
                  <span class="name">{filename}</span>
                  {#if filename === current}<span class="tag">open</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="dialog-footer">
        <!-- Still reachable, because a graph that really is on this machine is
             a real case — one someone sent, or one saved before the project. -->
        <button class="secondary" on:click={() => dispatch('local')}>
          Open from this computer…
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: var(--shade-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .dialog {
    background: var(--surface-panel);
    border: 1px solid var(--tint);
    border-radius: 6px;
    width: min(520px, 90vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    color: var(--text-primary);
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--tint);
  }
  .dialog-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .close-button {
    background: none;
    border: 0;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 2px;
  }
  .root {
    margin: 0;
    padding: 8px 16px 0;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .body {
    padding: 8px 16px 16px;
    overflow-y: auto;
  }
  .note {
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 8px 0;
  }
  .note.error {
    color: var(--status-error, #d97070);
  }
  .graphs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .graph {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .graph:hover {
    background: var(--tint-weak);
  }
  .graph.current {
    background: var(--tint);
  }
  .tag {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dialog-footer {
    padding: 10px 16px;
    border-top: 1px solid var(--tint);
    display: flex;
    justify-content: flex-end;
  }
  .secondary {
    background: none;
    border: 1px solid var(--tint);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .secondary:hover {
    background: var(--tint-weak);
  }
</style>
