<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph, CanvasAnnotation } from '@/core/engine/Graph';
  import type { Computation } from '@/core/engine/Computation';
  import Inspector from '../Inspector.svelte';
  import { sharedContextStore } from '../dockview/renderer';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Computation | null = null;
  export let selectedAnnotation: string | null = null;
  export let onRecordHistory: (() => void) | undefined = undefined;

  // Get annotation object from ID
  let annotation: CanvasAnnotation | null = null;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
    selectedAnnotation = $sharedContextStore.selectedAnnotation;
    onRecordHistory = $sharedContextStore.onRecordHistory;
  }

  // Get annotation when selectedAnnotation changes
  $: {
    if (graph && selectedAnnotation) {
      annotation = graph.elements.find(el => el.id === selectedAnnotation) || null;
    } else {
      annotation = null;
    }
  }

  // Update panel title when selected node changes
  $: {
    if (panelApi?.setTitle) {
      if (selectedNode) {
        panelApi.setTitle(`Inspector: ${selectedNode.name}`);
      } else if (annotation) {
        panelApi.setTitle(`Inspector: ${annotation.type}`);
      } else {
        panelApi.setTitle('Inspector');
      }
    }
  }
</script>

<div class="panel-wrapper">
  <Inspector
    node={selectedNode}
    {annotation}
    {graph}
    position="right"
    skipAnimation={true}
    {onRecordHistory}
  />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: #1a1a1a;
  }
</style>
