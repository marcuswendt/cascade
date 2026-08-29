<script lang="ts">
  /**
   * Tree viewer for structured values — the renderer for `object` and `array`.
   *
   * Structured data was previously summarised to one line ("{a, b, c, …}"),
   * which tells you a value exists and nothing about it. A pretty-printed dump
   * is the other failure: a side panel is narrow, and a few thousand curve
   * points rendered as text will lock the tab.
   *
   * So it is lazy and bounded. Nothing below the top level is built until it is
   * opened, long arrays render a window with a control to extend it, and long
   * strings truncate with the full text on hover. Large values stay openable.
   */
  export let value: any;
  export let name: string | null = null;
  export let depth = 0;
  /** Objects and arrays open at the top level, then stay shut. */
  export let expanded = depth < 1;

  const PAGE = 50;
  let shown = PAGE;

  $: isArray = Array.isArray(value);
  $: isObject = value !== null && typeof value === 'object' && !isArray;
  $: branch = isArray || isObject;
  $: entries = isArray
    ? (value as any[]).map((v, i) => [String(i), v] as [string, any])
    : isObject
      ? Object.entries(value as Record<string, any>)
      : [];
  $: visible = entries.slice(0, shown);

  function preview(v: any): string {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) {
      // A numeric tuple is more useful shown than counted — a vec2 or a bbox is
      // the common case and fits.
      if (v.length <= 4 && v.every(n => typeof n === 'number')) {
        return `[${v.map(n => (Number.isInteger(n) ? n : Number(n.toFixed(4)))).join(', ')}]`;
      }
      return `Array(${v.length})`;
    }
    if (typeof v === 'object') return `{${Object.keys(v).length}}`;
    if (typeof v === 'string') return v.length > 48 ? `"${v.slice(0, 45)}…"` : `"${v}"`;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
    return String(v);
  }

  function valueClass(v: any): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    return 'plain';
  }
</script>

<div class="row" style="padding-left: {depth * 10}px">
  {#if branch}
    <button class="twisty" on:click={() => (expanded = !expanded)}>{expanded ? '▾' : '▸'}</button>
  {:else}
    <span class="twisty spacer"></span>
  {/if}

  {#if name !== null}<span class="key">{name}</span>{/if}

  {#if branch}
    <span class="count">{isArray ? `${entries.length} items` : `${entries.length} keys`}</span>
  {:else}
    <span class="value {valueClass(value)}" title={typeof value === 'string' ? value : ''}>{preview(value)}</span>
  {/if}
</div>

{#if branch && expanded}
  {#each visible as [key, child] (key)}
    <svelte:self value={child} name={key} depth={depth + 1} />
  {/each}
  {#if entries.length > shown}
    <button class="more" style="padding-left: {(depth + 1) * 10}px" on:click={() => (shown += PAGE * 4)}>
      {entries.length - shown} more…
    </button>
  {/if}
{/if}

<style>
  .row {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
    line-height: 1.6;
    white-space: nowrap;
  }

  .twisty {
    background: none;
    border: none;
    color: #777;
    cursor: pointer;
    padding: 0;
    width: 9px;
    flex: none;
    font-size: 8px;
    text-align: left;
  }

  .twisty.spacer {
    cursor: default;
  }

  .key {
    color: #9cdcfe;
    flex: none;
  }

  .count {
    color: #666;
  }

  .value {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .value.number {
    color: #b5cea8;
  }

  .value.string {
    color: #ce9178;
  }

  .value.boolean {
    color: #569cd6;
  }

  .value.null {
    color: #777;
  }

  .value.plain {
    color: #ccc;
  }

  .more {
    background: none;
    border: none;
    color: #9cdcfe;
    cursor: pointer;
    font-size: 9px;
    padding: 1px 0;
    display: block;
  }
</style>
