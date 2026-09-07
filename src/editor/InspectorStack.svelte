<script lang="ts" context="module">
  /**
   * Above twelve, sections start collapsed.
   *
   * Twelve is the size of the largest group anybody actually selects on
   * purpose in the graph this was built against — cloud-posters' bank of twelve
   * marker nodes — while the whole graph is twenty-four and select-all is one
   * keystroke. So the threshold sits exactly between a deliberate group, which
   * should open, and a whole-graph sweep, which should not: each expanded
   * section mounts its own polling tick and up to a couple of dozen port
   * editors, and two dozen of those at once is a stall for a panel nobody
   * asked to read.
   *
   * Collapsed is a default, not a lock — every section still opens by hand.
   */
  export const COLLAPSE_THRESHOLD = 12;
</script>

<script lang="ts">
  /**
   * One parameter inspector per selected node, stacked.
   *
   * With a single node selected this is the plain Inspector and nothing else —
   * no header, no wrapper, no extra spacing. That is the case that matters most
   * and it has to stay untouched, so the multi-selection chrome only exists on
   * the other branch rather than being a wrapper the single case pays for.
   */
  import type { Node } from '@/nodes/Node';
  import type { Graph, CanvasAnnotation } from '@/nodes/Graph';
  import Inspector from './Inspector.svelte';

  export let nodes: Node[] = [];
  export let annotation: CanvasAnnotation | null = null;
  export let graph: Graph | null = null;
  export let position: 'right' | 'left' = 'right';
  export let skipAnimation: boolean = false;
  export let onRecordHistory: (() => void) | undefined = undefined;
  export let onAction: ((action: string, nodeId: string) => void) | undefined = undefined;

  $: overThreshold = nodes.length > COLLAPSE_THRESHOLD;

  /**
   * Only nodes the reader has explicitly toggled are recorded. Everything else
   * follows the threshold default, so growing the selection past it closes the
   * untouched sections without discarding a deliberate choice.
   */
  const overrides = new Map<string, boolean>();
  let overrideVersion = 0;

  function toggle(id: string) {
    overrides.set(id, !isExpanded(id, overrideVersion, overThreshold));
    overrideVersion += 1;
  }

  function isExpanded(id: string, version: number, collapsedByDefault: boolean): boolean {
    void version;
    const override = overrides.get(id);
    return override ?? !collapsedByDefault;
  }

  /** A node's id is its name in this graph model; nothing else carries one. */
  function labelFor(node: Node): string {
    return node.id;
  }
</script>

{#if nodes.length <= 1}
  <Inspector
    node={nodes[0] ?? null}
    {annotation}
    {graph}
    {position}
    {skipAnimation}
    {onRecordHistory}
    {onAction}
  />
{:else}
  <div class="stack">
    <div class="summary">
      <span class="count">{nodes.length} nodes selected</span>
      {#if overThreshold}
        <span class="hint">collapsed, open one to edit it</span>
      {/if}
    </div>
    <div class="sections">
      {#each nodes as node (node.id)}
        {@const expanded = isExpanded(node.id, overrideVersion, overThreshold)}
        <section class="section">
          <button
            class="section-heading"
            aria-expanded={expanded}
            on:click={() => toggle(node.id)}
          >
            <span class="twisty">{expanded ? '▾' : '▸'}</span>
            <span class="label">{labelFor(node)}</span>
            <span class="type">{node.type ?? ''}</span>
          </button>
          {#if expanded}
            <div class="body">
              <Inspector
                {node}
                {graph}
                {position}
                skipAnimation={true}
                embedded={true}
                {onRecordHistory}
                {onAction}
              />
            </div>
          {/if}
        </section>
      {/each}
    </div>
  </div>
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface-popover);
    backdrop-filter: blur(10px);
  }

  .summary {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-faintest);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .summary .hint {
    color: var(--text-disabled);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sections {
    flex: 1;
    overflow-y: auto;
  }

  .section + .section {
    border-top: 1px solid var(--border-faint);
  }

  .section-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: var(--tint-weakest);
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: 10px;
    padding: 5px 8px;
    text-align: left;
  }

  .section-heading:hover {
    background: var(--tint-weak);
    color: var(--text-bright);
  }

  .section-heading .twisty {
    flex: none;
    font-size: 8px;
    width: 8px;
    color: var(--text-faintest);
  }

  .section-heading .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-heading .type {
    flex: none;
    color: var(--text-disabled);
    font-size: 9px;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section .body {
    padding-bottom: 4px;
  }
</style>
