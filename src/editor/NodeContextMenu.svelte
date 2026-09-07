<script lang="ts">
  /**
   * The right-click menu for nodes on the graph canvas.
   *
   * HTML, not SVG, on purpose: SVG presentation attributes cannot read CSS
   * custom properties, and every colour here comes from a theme.css token.
   *
   * It knows nothing about the graph — Canvas.svelte hands it rows with a
   * `run()` each (see `nodeContextMenu.ts`), so this file only owns placement,
   * dismissal and keyboard navigation.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { clampToViewport } from './menuPlacement';
  import type { NodeContextMenuItem } from './nodeContextMenu';

  /** Pointer position the menu is anchored to, in viewport coordinates. */
  export let x: number;
  export let y: number;
  export let items: NodeContextMenuItem[] = [];

  const dispatch = createEventDispatcher<{ close: void }>();

  let menuEl: HTMLDivElement | undefined;
  /**
   * Hidden for the one frame it takes to measure, so the reader never sees it
   * jump — same approach as the panel add-menu in DockviewContainer, and for
   * the same reason: the width depends on the labels, which depend on how many
   * nodes are selected.
   */
  let style = `left: ${x}px; top: ${y}px; visibility: hidden`;

  const enabledIndices = () => items.map((item, i) => (item.disabled ? -1 : i)).filter(i => i >= 0);

  onMount(async () => {
    await tick();
    if (menuEl) {
      const { width, height } = menuEl.getBoundingClientRect();
      const placed = clampToViewport(
        { x, y },
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      style = `left: ${placed.x}px; top: ${placed.y}px`;
    }
    focusIndex(enabledIndices()[0] ?? -1);
  });

  function close() {
    dispatch('close');
  }

  function activate(item: NodeContextMenuItem) {
    if (item.disabled) return;
    // Close first: an action that opens a panel or deletes the nodes under the
    // menu should not leave the menu hanging over the result.
    close();
    item.run();
  }

  function focusIndex(index: number) {
    if (index < 0 || !menuEl) return;
    const buttons = menuEl.querySelectorAll<HTMLButtonElement>('button.item');
    buttons[index]?.focus();
  }

  function focusedIndex(): number {
    if (!menuEl) return -1;
    const buttons = Array.from(menuEl.querySelectorAll<HTMLButtonElement>('button.item'));
    return buttons.findIndex(button => button === document.activeElement);
  }

  function step(delta: number) {
    const enabled = enabledIndices();
    if (enabled.length === 0) return;
    const current = enabled.indexOf(focusedIndex());
    // An unfocused menu steps to the first row going down and the last going
    // up, which is what a keyboard user expects from a fresh menu.
    const next = current === -1
      ? (delta > 0 ? 0 : enabled.length - 1)
      : (current + delta + enabled.length) % enabled.length;
    focusIndex(enabled[next]);
  }

  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        return;
      case 'Home':
        e.preventDefault();
        focusIndex(enabledIndices()[0] ?? -1);
        return;
      case 'End': {
        e.preventDefault();
        const enabled = enabledIndices();
        focusIndex(enabled[enabled.length - 1] ?? -1);
        return;
      }
    }
    // Enter and Space are left to the native <button>, which fires click.
  }

  function handlePointerDown(e: PointerEvent) {
    if (menuEl && e.target instanceof globalThis.Node && menuEl.contains(e.target)) return;
    close();
  }
</script>

<!--
  Window-level dismissal. `pointerdown` catches a click anywhere outside,
  including on another panel; `wheel` and `resize` close rather than re-place,
  because the menu is anchored to a node that has moved out from under it.
  Listeners attach on mount, which is after the contextmenu event that opened
  the menu, so the opening gesture cannot dismiss it.
-->
<svelte:window
  on:keydown={handleKeyDown}
  on:pointerdown={handlePointerDown}
  on:wheel={close}
  on:resize={close}
  on:blur={close}
/>

<div
  class="node-context-menu"
  role="menu"
  tabindex="-1"
  aria-label="Node actions"
  bind:this={menuEl}
  {style}
  on:contextmenu|preventDefault|stopPropagation
>
  {#each items as item (item.id)}
    {#if item.separatorBefore}
      <div class="separator" role="separator"></div>
    {/if}
    <button
      type="button"
      class="item"
      class:danger={item.danger}
      role="menuitem"
      tabindex="-1"
      disabled={item.disabled}
      data-item-id={item.id}
      on:click|stopPropagation={() => activate(item)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .node-context-menu {
    position: fixed;
    background: var(--surface-raised);
    border: 1px solid var(--border-divider);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 8px 24px var(--shadow-soft);
    z-index: 10000;
    min-width: 160px;
  }

  .item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .item:hover:not(:disabled),
  .item:focus-visible:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-bright);
    outline: none;
  }

  .item.danger {
    color: var(--status-error-soft);
  }

  .item.danger:hover:not(:disabled),
  .item.danger:focus-visible:not(:disabled) {
    background: var(--surface-hover);
    color: var(--status-error);
  }

  .item:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--border-divider);
  }
</style>
