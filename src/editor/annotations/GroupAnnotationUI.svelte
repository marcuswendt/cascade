<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { content?: string };
  export let isSelected: boolean = false;
  export let isEditing: boolean = false;
  export let isDragging: boolean = false;
  export let isDropTarget: boolean = false;

  const dispatch = createEventDispatcher();

  let inputElement: HTMLInputElement;

  $: width = annotation.size?.width || 300;
  $: height = annotation.size?.height || 200;
  $: content = annotation.content || 'Group';

  export function focusInput() {
    inputElement?.focus();
    inputElement?.select();
  }

  export function getInputElement() {
    return inputElement;
  }
</script>

<div
  class="annotation annotation-group"
  class:selected={isSelected}
  class:editing={isEditing}
  class:dragging={isDragging}
  class:drop-target={isDropTarget}
  data-annotation-id={annotation.id}
  role="button"
  aria-label="Group annotation"
  tabindex="0"
  style="left: {annotation.position.x}px; top: {annotation.position.y}px; width: {width}px; height: {height}px; pointer-events: none"
  on:click={(e) => dispatch('click', { id: annotation.id, event: e })}
  on:dblclick={(e) => dispatch('dblclick', { id: annotation.id, event: e })}
  on:mousedown={(e) => {
    if (e.button === 0) {
      dispatch('mousedown', { id: annotation.id, event: e });
    }
  }}
  on:keydown={(e) => dispatch('keydown', { id: annotation.id, event: e })}
>
  {#if isEditing}
    <input
      type="text"
      class="annotation-input"
      style="pointer-events: auto"
      bind:this={inputElement}
      value={content}
      on:blur={() => dispatch('finishEdit')}
      on:keydown={(e) => {
        if (e.key === 'Enter') {
          dispatch('finishEdit');
        } else if (e.key === 'Escape') {
          dispatch('finishEdit');
        } else if (e.key === 'Delete' && (e.metaKey || e.ctrlKey)) {
          dispatch('delete', { id: annotation.id });
        }
      }}
      on:input={(e) => dispatch('input', { id: annotation.id, event: e })}
      placeholder="Group name..."
    />
  {:else}
    <div class="group-header" style="pointer-events: auto">{content}<span class="group-count">{isDropTarget ? "Release to add" : `${annotation.containedElements?.length || 0} items`}</span></div>
  {/if}
  {#if isSelected && !isEditing}
    <div
      class="resize-handle resize-se"
      style="pointer-events: auto"
      role="button"
      aria-label="Resize southeast"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'se', event: e })}
    ></div>
    <div
      class="resize-handle resize-sw"
      style="pointer-events: auto"
      role="button"
      aria-label="Resize southwest"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'sw', event: e })}
    ></div>
    <div
      class="resize-handle resize-ne"
      style="pointer-events: auto"
      role="button"
      aria-label="Resize northeast"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'ne', event: e })}
    ></div>
    <div
      class="resize-handle resize-nw"
      style="pointer-events: auto"
      role="button"
      aria-label="Resize northwest"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'nw', event: e })}
    ></div>
  {/if}
</div>

<style>
  .annotation {
    position: absolute;
    cursor: move;
    pointer-events: auto;
  }

  .annotation-group {
    background: var(--tint-weak);
    border: 1px dashed var(--tint-stronger);
    border-radius: 8px;
    /* A group is a backdrop. Its empty body must not become a transparent
       shield over the nodes it contains; only the explicit controls below
       participate in hit testing. */
    pointer-events: none;
  }

  .annotation-group.selected {
    border-color: var(--accent);
    border-style: solid;
  }

  .annotation-group.dragging {
    opacity: 0.7;
  }

  .annotation-group.drop-target {
    border: 2px solid var(--accent);
    background: var(--tint-stronger);
  }

  .group-count {
    float: right;
    margin-left: 12px;
    font-weight: normal;
    text-transform: none;
    opacity: 0.75;
  }

  .group-header {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tint-strong);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: auto;
  }

  .annotation-input {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: auto;
  }

  .resize-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 2px;
    cursor: nwse-resize;
    pointer-events: auto;
  }

  .resize-se {
    bottom: -5px;
    right: -5px;
    cursor: nwse-resize;
  }

  .resize-sw {
    bottom: -5px;
    left: -5px;
    cursor: nesw-resize;
  }

  .resize-ne {
    top: -5px;
    right: -5px;
    cursor: nesw-resize;
  }

  .resize-nw {
    top: -5px;
    left: -5px;
    cursor: nwse-resize;
  }
</style>
