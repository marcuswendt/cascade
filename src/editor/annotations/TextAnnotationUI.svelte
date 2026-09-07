<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { renderMarkdown } from '@/editor/utils/renderMarkdown';
  import { getPortColor } from '@/utils/portColors';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { content?: string };
  export let isSelected: boolean = false;
  export let isEditing: boolean = false;
  export let isDragging: boolean = false;

  const dispatch = createEventDispatcher();

  let inputElement: HTMLTextAreaElement;

  $: style = (annotation as any).style || {};
  $: width = annotation.size?.width || 540;
  $: height = annotation.size?.height || 'auto';
  $: styleStr = [
    `font-size: ${style.fontSize || 14}px`,
    `font-weight: ${style.fontWeight || 'normal'}`,
    `font-style: ${style.fontStyle || 'normal'}`,
    `text-align: ${style.textAlign || 'left'}`,
    // White was the dark-only default, and on a light canvas it disappears.
    // An authored colour still wins; only the fallback follows the theme.
    `color: ${style.color || 'var(--text-default)'}`,
    style.backgroundColor ? `background-color: ${style.backgroundColor}` : '',
    `padding: ${style.padding || 0}px`,
    `border-radius: ${style.borderRadius || 0}px`,
    style.borderLeft ? `border-left: ${style.borderLeft}` : '',
    `width: ${width}px`,
    typeof height === 'number' ? `min-height: ${height}px` : ''
  ].filter(Boolean).join('; ');

  export function focusInput() {
    inputElement?.focus();
  }

  export function getInputElement() {
    return inputElement;
  }
</script>

<div
  class="annotation annotation-text"
  class:selected={isSelected}
  class:editing={isEditing}
  class:dragging={isDragging}
  data-annotation-id={annotation.id}
  role="textbox"
  aria-label="Text annotation"
  tabindex="0"
  style="left: {annotation.position.x}px; top: {annotation.position.y}px; {styleStr}"
  on:click={(e) => dispatch('click', { id: annotation.id, event: e })}
  on:dblclick={(e) => dispatch('dblclick', { id: annotation.id, event: e })}
  on:mousedown={(e) => dispatch('mousedown', { id: annotation.id, event: e, width, height: typeof height === 'number' ? height : 60 })}
  on:mousemove={(e) => dispatch('mousemove', { id: annotation.id, event: e, width, height: typeof height === 'number' ? height : 60 })}
  on:keydown={(e) => dispatch('keydown', { id: annotation.id, event: e })}
>
  {#if isEditing}
    <textarea
      class="annotation-input"
      bind:this={inputElement}
      value={annotation.content || ''}
      style="width: {width - (style.padding || 8) * 2}px; min-height: {typeof height === 'number' ? height - (style.padding || 8) * 2 : 60}px"
      on:blur={() => dispatch('finishEdit')}
      on:keydown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          dispatch('finishEdit');
        } else if (e.key === 'Escape') {
          dispatch('finishEdit');
        } else if (e.key === 'Delete' && (e.metaKey || e.ctrlKey)) {
          dispatch('delete', { id: annotation.id });
        }
      }}
      on:input={(e) => dispatch('input', { id: annotation.id, event: e })}
      placeholder="Enter text..."
    ></textarea>
  {:else}
    <div class="annotation-content">
      {#if annotation.content}
        {@html renderMarkdown(annotation.content)}
      {/if}
    </div>
  {/if}
  {#if annotation.outputs && annotation.outputs.length > 0}
    {#each annotation.outputs as port (port.id)}
      {@const annotationWidth = annotation.size?.width || 540}
      {@const annotationHeight = typeof annotation.size?.height === 'number' ? annotation.size.height : 60}
      {@const portColor = getPortColor(port)}
      <div
        class="port annotation-port"
        data-node-id={annotation.id}
        data-port-id={port.id}
        data-port-type="output"
        style="position: absolute; left: {annotationWidth / 2}px; top: {annotationHeight}px; transform: translate(-50%, -50%);"
        on:mousedown={(e) => dispatch('portMouseDown', { nodeId: annotation.id, portId: port.id, portType: 'output', event: e })}
        role="button"
        aria-label="Output port {port.name}"
        tabindex="0"
      >
        <div class="port-dot" style="background-color: {portColor};"></div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .annotation {
    position: absolute;
    cursor: move;
    pointer-events: auto;
  }

  .annotation-text {
    user-select: none;
  }

  .annotation-text.editing {
    cursor: text;
  }

  .annotation-text.selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .annotation-text.dragging {
    opacity: 0.7;
  }

  .annotation-input {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    resize: none;
    outline: none;
    width: 100%;
  }

  .annotation-content {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .annotation-content :global(p) {
    margin: 0 0 0.5em 0;
  }

  .annotation-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .port {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: crosshair;
  }

  .port-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--tint-half);
  }

  .annotation-port {
    pointer-events: auto;
  }
</style>
