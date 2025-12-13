<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import CodeEditor from '../CodeEditor.svelte';
  import { sharedContextStore } from '../dockview/renderer';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let onRecordHistory: (() => void) | undefined = undefined;

  // Get the node from the graph using nodeId from params
  let node: Node | null = null;
  const nodeId = panelParams?.nodeId;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    onRecordHistory = $sharedContextStore.onRecordHistory;
  }

  // Get node when graph changes
  $: {
    if (graph && nodeId) {
      node = graph.getNode(nodeId) || null;
    } else {
      node = null;
    }
  }

  // Update panel title with node name
  $: {
    if (panelApi?.setTitle && node) {
      panelApi.setTitle(`Code: ${node.name}`);
    }
  }

  function handleClose() {
    if (panelApi?.close) {
      panelApi.close();
    }
  }
</script>

<div class="panel-wrapper">
  {#if node}
    <CodeEditor
      {node}
      packageManager={graph?.packageManager || null}
      onClose={handleClose}
      showCloseButton={false}
      {onRecordHistory}
    />
  {:else}
    <div class="error">
      Node not found: {nodeId}
    </div>
  {/if}
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #1e1e1e;
  }

  .error {
    padding: 16px;
    color: #ff6b6b;
  }
</style>
