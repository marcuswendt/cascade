<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import Log from '../Log.svelte';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  let logRef: any = null;

  export function clearLog() {
    if (logRef?.clearLog) {
      logRef.clearLog();
    }
  }
</script>

<div class="panel-wrapper">
  <Log bind:this={logRef} />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: auto;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    background: #1a1a1a;
  }
</style>
