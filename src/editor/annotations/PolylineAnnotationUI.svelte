<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Annotation } from '@/nodes/annotations/Annotation';

  export let annotation: Annotation & { points?: { x: number; y: number }[] };
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  $: style = (annotation as any).style || {};
  $: points = annotation.points || [];
  $: strokeWidth = style.strokeWidth || 2;
  // Theme-following default; an authored stroke colour still wins.
  $: strokeColor = style.strokeColor || 'var(--text-default)';
  $: pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
</script>

{#if points.length > 0}
  <svg
    class="annotation annotation-polyline"
    class:selected={isSelected}
    data-annotation-id={annotation.id}
    role="button"
    aria-label="Polyline annotation"
    tabindex="0"
    style="position: absolute; left: 0; top: 0; pointer-events: none;"
    on:click={(e) => dispatch('click', { id: annotation.id, event: e })}
    on:mousedown={(e) => dispatch('mousedown', { id: annotation.id, event: e })}
    on:keydown={(e) => dispatch('keydown', { id: annotation.id, event: e })}
  >
    <path
      d={pathData}
      fill="none"
      stroke={strokeColor}
      stroke-width={strokeWidth}
      pointer-events="stroke"
      style="cursor: pointer;"
    />
  </svg>
{/if}

<style>
  .annotation-polyline {
    overflow: visible;
    width: 100%;
    height: 100%;
  }

  .annotation-polyline.selected path {
    stroke-dasharray: 5, 5;
    animation: dash 0.5s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
