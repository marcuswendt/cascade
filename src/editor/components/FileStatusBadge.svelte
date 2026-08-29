<script lang="ts">
  import type { FileStatus } from '@/types/node.types';
  import { Check, AlertTriangle, FileX, RefreshCw } from '@lucide/svelte';

  export let status: FileStatus = 'synced';
  export let showLabel = true;
  export let size: 'sm' | 'md' = 'md';

  const statusConfig: Record<FileStatus, {
    icon: any;
    label: string;
    class: string;
    description: string;
  }> = {
    'synced': {
      icon: Check,
      label: 'Synced',
      class: 'status-synced',
      description: 'File is up to date'
    },
    'missing': {
      icon: FileX,
      label: 'Missing',
      class: 'status-missing',
      description: 'External file not found'
    },
    'conflict': {
      icon: AlertTriangle,
      label: 'Conflict',
      class: 'status-conflict',
      description: 'Local and external changes conflict'
    },
    'modified-external': {
      icon: RefreshCw,
      label: 'Modified',
      class: 'status-modified',
      description: 'External file has been modified'
    }
  };

  $: config = statusConfig[status];
  $: iconSize = size === 'sm' ? 12 : 14;
</script>

<span
  class="file-status-badge {config.class} size-{size}"
  title={config.description}
>
  <svelte:component this={config.icon} size={iconSize} />
  {#if showLabel}
    <span class="label">{config.label}</span>
  {/if}
</span>

<style>
  .file-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
  }

  .size-sm {
    padding: 1px 6px;
    font-size: 10px;
    gap: 3px;
  }

  .status-synced {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .status-missing {
    background: rgba(244, 67, 54, 0.2);
    color: #f44336;
  }

  .status-conflict {
    background: rgba(255, 152, 0, 0.2);
    color: #ff9800;
  }

  .status-modified {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }

  .label {
    white-space: nowrap;
  }
</style>
