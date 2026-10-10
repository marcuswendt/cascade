<script lang="ts">
  /**
   * A bundle's contents: one row per field, each drawn by the same CoreValue
   * every other port uses, so an image field shows its preview and a vector
   * its components. Declared fields that the last cook did not set are listed
   * as missing rather than hidden, since "declared and empty" is the question.
   */
  import CoreValue from './CoreValue.svelte';
  import { bundleFieldRows, declaredBundleFields } from './typePresentation';

  export let value: any;
  export let port: any = null;
  export let node: any = null;
  export let readOnly = true;
  export let mode: 'compact' | 'inspect' | 'view' = 'inspect';
  export let onChange: ((value: any) => void) | null = null;
  // Accepted for the renderer contract; a bundle is never edited in place.
  $: void readOnly, void onChange;

  $: schema = port?.options?.schema as string | undefined;
  $: rows = bundleFieldRows(value, declaredBundleFields(port, node));
  $: selection = port?.options?.fieldSelection as readonly string[] | undefined;
</script>

<div class="bundle" data-testid="bundle-value">
  <div class="meta">
    bundle{schema ? ` · ${schema}` : ''} · {rows.length} {rows.length === 1 ? 'field' : 'fields'}{selection ? ` · reads ${selection.join(', ') || 'none'}` : ''}
  </div>
  {#each rows as row (row.name)}
    <div class="field" class:missing={!row.present} class:extra={!row.declared}>
      <div class="head" title={row.description ?? ''}>
        <span class="name">{row.name}</span>
        <span class="type">{row.type}</span>
      </div>
      {#if row.present}
        <div class="body">
          <CoreValue type={row.type} value={row.value} {mode} readOnly={true} onChange={null} />
        </div>
      {:else}
        <div class="body absent">not set</div>
      {/if}
    </div>
  {:else}
    <div class="absent">{value === undefined ? 'Not cooked yet' : 'No fields'}</div>
  {/each}
</div>

<style>
  .bundle { display: flex; flex-direction: column; gap: 4px; }
  .meta { color: var(--text-faint); font-size: 9px; }
  .field { border-left: 1px solid var(--border-faint); padding: 2px 0 2px 7px; }
  .head { display: flex; gap: 6px; align-items: baseline; }
  .name { color: var(--text-primary); font-size: 10px; }
  .type { color: var(--text-faint); font-size: 9px; }
  .extra .name { font-style: italic; }
  .body { margin-top: 2px; min-width: 0; }
  .absent { color: var(--text-faintest); font-size: 9px; }
</style>
