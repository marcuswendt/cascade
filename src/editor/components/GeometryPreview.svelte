<script lang="ts">
  import { geometryPresentation } from './typePresentation';

  export let value: any;
  export let type: string;

  $: geometry = geometryPresentation(value, type);
  $: minX = geometry.bounds?.min[0] ?? 0;
  $: minY = geometry.bounds?.min[1] ?? 0;
  $: spanX = Math.max(geometry.bounds ? geometry.bounds.max[0] - minX : 1, 1e-6);
  $: spanY = Math.max(geometry.bounds ? geometry.bounds.max[1] - minY : 1, 1e-6);
  $: padding = Math.max(spanX, spanY) * 0.04;
  $: viewBox = `${minX - padding} ${minY - padding} ${spanX + padding * 2} ${spanY + padding * 2}`;
  $: pointRadius = Math.max(spanX, spanY) * 0.008;
</script>

<div class="geometry-preview">
  {#if geometry.bounds}
    <svg {viewBox} role="img" aria-label="{type} preview" preserveAspectRatio="xMidYMid meet">
      {#each geometry.rects as rect}
        <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      {/each}
      {#each geometry.paths as path}
        <polyline points={path.map(point => point.join(',')).join(' ')} />
      {/each}
      {#each geometry.points as point}
        <circle cx={point[0]} cy={point[1]} r={pointRadius} />
      {/each}
    </svg>
  {:else}
    <div class="empty">No previewable geometry</div>
  {/if}
  <div class="meta">
    <span>{geometry.countLabel}</span>
    {#if geometry.bounds}
      <span>{Number(spanX.toFixed(2))}×{Number(spanY.toFixed(2))}</span>
    {/if}
  </div>
</div>

<style>
  .geometry-preview {
    overflow: hidden;
    border: 1px solid var(--border-faint);
    border-radius: 4px;
    background: var(--surface-void);
  }

  svg {
    display: block;
    width: 100%;
    min-height: 100px;
    max-height: 420px;
    background-image: linear-gradient(var(--surface-app) 1px, transparent 1px), linear-gradient(90deg, var(--surface-app) 1px, transparent 1px);
    background-size: 16px 16px;
  }

  polyline,
  rect {
    fill: none;
    stroke: var(--status-ok-bright);
    stroke-width: 0.5%;
    vector-effect: non-scaling-stroke;
  }

  circle {
    fill: var(--status-ok-bright);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 7px;
    color: var(--text-subtle);
    font: 9px ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .empty {
    display: grid;
    min-height: 80px;
    place-items: center;
    color: var(--text-faintest);
    font-size: 10px;
  }
</style>
