<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { content?: string };
  export let isSelected: boolean = false;
  export let isEditing: boolean = false;
  export let isDragging: boolean = false;

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
  data-annotation-id={annotation.id}
  role="button"
  aria-label="Group annotation"
  tabindex="0"
  style="left: {annotation.position.x}px; top: {annotation.position.y}px; width: {width}px; height: {height}px"
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
    <div class="group-header">{content}</div>
  {/if}
  {#if isSelected && !isEditing}
    <div
      class="resize-handle resize-se"
      role="button"
      aria-label="Resize southeast"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'se', event: e })}
    ></div>
    <div
      class="resize-handle resize-sw"
      role="button"
      aria-label="Resize southwest"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'sw', event: e })}
    ></div>
    <div
      class="resize-handle resize-ne"
      role="button"
      aria-label="Resize northeast"
      tabindex="0"
      on:mousedown={(e) => dispatch('resizeStart', { id: annotation.id, handle: 'ne', event: e })}
    ></div>
    <div
      class="resize-handle resize-nw"
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
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.3);
    border-radius: 8px;
  }

  .annotation-group.selected {
    border-color: var(--accent-color, #4a9eff);
    border-style: solid;
  }

  .annotation-group.dragging {
    opacity: 0.7;
  }

  .group-header {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
  }

  .resize-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--accent-color, #4a9eff);
    border-radius: 2px;
    cursor: nwse-resize;
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
