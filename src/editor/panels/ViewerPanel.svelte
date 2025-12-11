<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/core/engine/Graph';
  import type { Computation } from '@/core/engine/Computation';
  import Viewer from '../Viewer.svelte';
  import { sharedContextStore } from '../dockview/renderer';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Computation | null = null;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
  }
</script>

<div class="panel-wrapper">
  <Viewer {graph} {selectedNode} />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0a0a0a;
  }
</style>
