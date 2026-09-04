<script lang="ts">
  /** Port chrome only. CoreValue owns all type presentation. */
  import { normalizeType, typeColor } from '@/types/coreTypes';
  import CoreValue from './CoreValue.svelte';
  import { inferCascadeType } from './typePresentation';

  export let port: any;
  export let node: any = null;
  export let direction: 'input' | 'output' = 'input';
  export let onChange: ((value: any) => void) | null = null;

  $: declaredType = normalizeType(port?.dataType);
  $: value = port?.value;
  $: effectiveType = declaredType === 'any' ? inferCascadeType(value) : declaredType;
  $: connected = (port?.connections?.length ?? 0) > 0;
  $: readOnly = direction === 'output' || connected;
</script>

<div class="port-editor" class:read-only={readOnly}>
  <div class="row">
    <span class="dot" style="background:{typeColor(port?.dataType)}"></span>
    <span class="name" title={`${port?.name} · ${effectiveType}`}>{port?.name}</span>
  </div>

  {#if connected && direction === 'input'}
    <div class="source">from {port.connections[0]?.from?.nodeId ?? 'upstream'}</div>
  {/if}

  <div class="value">
    <CoreValue
      type={effectiveType}
      {value}
      {port}
      {node}
      mode="inspect"
      {readOnly}
      onChange={readOnly ? null : onChange}
    />
  </div>
</div>

<style>
  .port-editor { padding: 7px 0; border-bottom: 1px solid var(--border-faint); }
  .row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .name { flex: 1; overflow: hidden; color: var(--text-primary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .source { margin: -1px 0 5px 13px; color: var(--text-faint); font-size: 9px; }
  .value { margin-left: 13px; min-width: 0; }
  .read-only .value { opacity: 0.92; }
</style>
