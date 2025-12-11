<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph, CanvasAnnotation } from '@/core/engine/Graph';
  import type { Computation } from '@/core/engine/Computation';
  import Inspector from '../Inspector.svelte';
  import { sharedContextStore, panelLockStore } from '../dockview/renderer';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Computation | null = null;
  export let selectedAnnotation: string | null = null;
  export let onRecordHistory: (() => void) | undefined = undefined;

  // The node/annotation to actually display (locked or selected)
  $: lockState = $panelLockStore.get(panelId);
  $: isLocked = lockState?.isLocked ?? false;
  $: displayNode = isLocked ? lockState?.lockedNode : selectedNode;
  $: displayAnnotationId = isLocked ? lockState?.lockedAnnotationId : selectedAnnotation;

  // Get annotation object from ID
  let annotation: CanvasAnnotation | null = null;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
    selectedAnnotation = $sharedContextStore.selectedAnnotation;
    onRecordHistory = $sharedContextStore.onRecordHistory;
  }

  // Get annotation when displayAnnotationId changes
  $: {
    if (graph && displayAnnotationId) {
      annotation = graph.elements.find(el => el.id === displayAnnotationId) || null;
    } else {
      annotation = null;
    }
  }

  // Update panel title when display node changes
  $: {
    if (panelApi?.setTitle) {
      const lockPrefix = isLocked ? '~ ' : '';
      if (displayNode) {
        panelApi.setTitle(`${lockPrefix}Inspector: ${displayNode.id}`);
      } else if (annotation) {
        panelApi.setTitle(`${lockPrefix}Inspector: ${annotation.type}`);
      } else {
        panelApi.setTitle(`${lockPrefix}Inspector`);
      }
    }
  }
</script>

<div class="panel-wrapper">
  <Inspector
    node={displayNode}
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
