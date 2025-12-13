<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { endPosition?: { x: number; y: number } };
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  $: style = (annotation as any).style || {};
  $: startX = annotation.position.x;
  $: startY = annotation.position.y;
  $: endX = annotation.endPosition?.x || annotation.position.x;
  $: endY = annotation.endPosition?.y || annotation.position.y;
  $: strokeWidth = style.strokeWidth || 2;
  $: strokeColor = style.strokeColor || '#ffffff';
</script>

<svg
  class="annotation annotation-line"
  class:selected={isSelected}
  data-annotation-id={annotation.id}
  role="button"
  aria-label="Line annotation"
  tabindex="0"
  style="position: absolute; left: 0; top: 0; pointer-events: none;"
  on:click={(e) => dispatch('click', { id: annotation.id, event: e })}
  on:mousedown={(e) => dispatch('mousedown', { id: annotation.id, event: e })}
  on:keydown={(e) => dispatch('keydown', { id: annotation.id, event: e })}
>
  <line
    x1={startX}
    y1={startY}
    x2={endX}
    y2={endY}
    stroke={strokeColor}
    stroke-width={strokeWidth}
    pointer-events="stroke"
    style="cursor: pointer;"
  />
</svg>

<style>
  .annotation-line {
    overflow: visible;
    width: 100%;
    height: 100%;
  }

  .annotation-line.selected line {
    stroke-dasharray: 5, 5;
    animation: dash 0.5s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
