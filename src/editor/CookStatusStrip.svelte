<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CookStatus } from '@/nodes/CookScheduler';

  export let loading = false;
  export let status: Readonly<CookStatus>;

  let now = Date.now();
  let receivedAt = now;
  let previousStatus = status;
  let timer: ReturnType<typeof setInterval> | undefined;

  $: if (status !== previousStatus) {
    previousStatus = status;
    receivedAt = Date.now();
    now = receivedAt;
  }

  $: {
    const shouldTick = !loading && status.phase === 'cooking';
    if (shouldTick && !timer) {
      timer = setInterval(() => {
        now = Date.now();
      }, 100);
    } else if (!shouldTick && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  $: elapsed = status.elapsed + (status.phase === 'cooking' ? now - receivedAt : 0);
  $: ordinal = Math.min(status.total, status.completed + (status.currentNode ? 1 : 0));

  onDestroy(() => timer && clearInterval(timer));

  function formatElapsed(milliseconds: number): string {
    if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }
</script>

{#if loading}
  <div class="cook-status loading" role="status" aria-live="polite" data-phase="loading">
    <span class="status-mark" aria-hidden="true"></span>
    <strong>Loading graph</strong>
    <span>Fetching and compiling nodes…</span>
  </div>
{:else if status.phase !== 'idle'}
  <div class="cook-status" role="status" aria-live="polite" data-phase={status.phase}>
    <span class="status-mark" aria-hidden="true"></span>
    {#if status.phase === 'scheduled'}
      <strong>Queued {status.total} {status.total === 1 ? 'node' : 'nodes'}</strong>
    {:else}
      <strong>Cooking {ordinal} of {status.total}</strong>
      {#if status.currentNode}
        <span class="current-node">{status.currentNode.id}</span>
      {/if}
      <time>{formatElapsed(elapsed)}</time>
    {/if}
  </div>
{/if}

<style>
  .cook-status {
    position: absolute;
    z-index: 1000;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    height: 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 1px solid rgba(91, 192, 235, 0.42);
    border-radius: 5px;
    background: rgba(20, 24, 28, 0.94);
    color: #c8d0d8;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.38);
    font-size: 11px;
    line-height: 1;
    pointer-events: none;
  }

  .cook-status.loading {
    border-color: rgba(215, 186, 125, 0.5);
  }

  .cook-status strong {
    color: #f2f5f7;
    font-weight: 600;
  }

  .status-mark {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5bc0eb;
    animation: cascade-status-pulse 1.15s ease-in-out infinite;
  }

  .loading .status-mark {
    background: #d7ba7d;
  }

  .current-node {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #9cdcfe;
  }

  time {
    min-width: 42px;
    text-align: right;
    color: #8f9aa4;
    font-variant-numeric: tabular-nums;
  }

  @keyframes cascade-status-pulse {
    50% { opacity: 0.35; }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-mark { animation: none; }
  }
</style>
