<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import Viewer from '../Viewer.svelte';
  import { sharedContextStore, panelLockStore } from '../dockview/renderer';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;

  // The node to actually display (locked or selected)
  $: lockState = $panelLockStore.get(panelId);
  $: isLocked = lockState?.isLocked ?? false;
  $: displayNode = isLocked ? lockState?.lockedNode : selectedNode;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
  }

  // Update panel title when display node changes
  $: {
    if (panelApi?.setTitle) {
      const lockPrefix = isLocked ? '~ ' : '';
      if (displayNode) {
        panelApi.setTitle(`${lockPrefix}Viewer: ${displayNode.id}`);
      } else {
        panelApi.setTitle(`${lockPrefix}Viewer`);
      }
    }
  }
</script>

<div class="panel-wrapper">
  <Viewer {graph} selectedNode={displayNode} />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0a0a0a;
  }
</style>
