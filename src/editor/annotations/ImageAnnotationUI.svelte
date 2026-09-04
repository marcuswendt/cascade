<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { getPortColor } from '@/utils/portColors';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { src?: string; caption?: string };
  export let isSelected: boolean = false;
  export let isDragging: boolean = false;

  const dispatch = createEventDispatcher();

  $: width = annotation.size?.width || 200;
  $: height = annotation.size?.height || 150;
  $: src = annotation.src || '';
  $: caption = annotation.caption || '';
</script>

<div
  class="annotation annotation-image"
  class:selected={isSelected}
  class:dragging={isDragging}
  data-annotation-id={annotation.id}
  role="button"
  aria-label="Image annotation"
  tabindex="0"
  style="left: {annotation.position.x}px; top: {annotation.position.y}px; width: {width}px; height: {height}px"
  on:click={(e) => dispatch('click', { id: annotation.id, event: e })}
  on:dblclick={(e) => dispatch('dblclick', { id: annotation.id, event: e })}
  on:mousedown={(e) => {
    if (e.button === 0) {
      e.preventDefault();
      dispatch('mousedown', { id: annotation.id, event: e });
    }
  }}
  on:dragstart={(e) => e.preventDefault()}
  on:keydown={(e) => dispatch('keydown', { id: annotation.id, event: e })}
>
  <img src={src} alt={caption} draggable="false" on:dragstart={(e) => e.preventDefault()} />
  {#if caption}
    <div class="annotation-caption">{caption}</div>
  {/if}
  {#if annotation.outputs && annotation.outputs.length > 0}
    {#each annotation.outputs as port (port.id)}
      {@const portColor = getPortColor(port)}
      <div
        class="port annotation-port"
        data-node-id={annotation.id}
        data-port-id={port.id}
        data-port-type="output"
        style="position: absolute; left: {width / 2}px; top: {height}px; transform: translate(-50%, -50%);"
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

  .annotation-image {
    overflow: hidden;
    border-radius: 4px;
    background: var(--shade-weak);
  }

  .annotation-image.selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .annotation-image.dragging {
    opacity: 0.7;
  }

  .annotation-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }

  .annotation-caption {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 4px 8px;
    background: var(--shade-stronger);
    color: var(--text-bright);
    font-size: 12px;
    text-align: center;
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
