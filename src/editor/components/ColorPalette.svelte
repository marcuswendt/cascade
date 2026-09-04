<script lang="ts">
  /**
   * The node colour palette — `c` in the graph, bottom left.
   *
   * Colour is the fastest grouping a node graph has. A pipeline of two dozen
   * identically-shaped boxes reads as noise however well it is laid out; the
   * same graph with the signals one colour and the density chain another can be
   * taken in at a glance, before reading a single label.
   *
   * Eight by eight, built from eight hues at eight lightnesses rather than
   * hand-picked, so neighbouring swatches always relate and nothing clashes on
   * the dark canvas. The top row is a neutral ramp, because "no colour" and
   * "deliberately grey" are different intentions.
   */
  import { createEventDispatcher } from 'svelte';

  export let open = false;
  /** How many nodes the choice will apply to — shown so it is never a surprise. */
  export let selectionCount = 0;

  const dispatch = createEventDispatcher();

  const HUES = [0, 28, 45, 140, 190, 215, 265, 320];

  /** Muted and dark enough to sit under white port dots and a light label. */
  const swatches: string[][] = [
    ['#3a3a3a', '#454545', '#505050', '#5c5c5c', '#686868', '#757575', '#828282', '#909090'],
    ...HUES.slice(1).map(hue =>
      [20, 26, 32, 38, 44, 50, 56, 62].map(lightness => `hsl(${hue}, 42%, ${lightness / 2 + 12}%)`)
    ),
  ];

  function choose(color: string | null) {
    dispatch('choose', color);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div class="palette">
    <div class="head">
      <span>Node colour</span>
      <span class="count">{selectionCount} selected</span>
    </div>

    <div class="grid">
      {#each swatches as row}
        {#each row as color}
          <button
            class="swatch"
            style="background:{color}"
            title={color}
            on:click={() => choose(color)}
          ></button>
        {/each}
      {/each}
    </div>

    <div class="foot">
      <button class="clear" on:click={() => choose(null)}>Clear</button>
      <button class="clear" on:click={() => dispatch('close')}>Close</button>
    </div>
  </div>
{/if}

<style>
  .palette {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 40;
    background: var(--surface-raised);
    border: 1px solid var(--border-divider);
    border-radius: 6px;
    padding: 8px;
    box-shadow: 0 10px 30px var(--shadow);
    user-select: none;
  }

  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 10px;
    color: var(--text-tertiary);
    margin-bottom: 6px;
  }

  .count {
    color: var(--text-faint);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(8, 18px);
    gap: 3px;
  }

  .swatch {
    width: 18px;
    height: 18px;
    border: 1px solid var(--tint-weak);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
  }

  .swatch:hover {
    border-color: var(--border-bright);
  }

  .foot {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  .clear {
    flex: 1;
    background: none;
    border: 1px solid var(--border-raised);
    border-radius: 3px;
    color: var(--text-dim);
    font-size: 10px;
    padding: 3px 6px;
    cursor: pointer;
  }

  .clear:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
</style>
