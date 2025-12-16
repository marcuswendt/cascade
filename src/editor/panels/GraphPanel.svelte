<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import Canvas from '../Canvas.svelte';
  import { sharedContextStore } from '../dockview/renderer';
  import { dockviewStore } from '../dockview/dockview-store.svelte';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // These props are passed during mount but we'll use the store for reactivity
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;
  export let selectedAnnotation: string | null = null;
  export let activeTool: string = 'select';
  export let presentationMode: boolean = false;
  export let onRecordHistory: (() => void) | undefined = undefined;
  export let onNodeSelect: ((node: Node | null) => void) | undefined = undefined;
  export let onAnnotationSelect: ((annotationId: string | null) => void) | undefined = undefined;
  export let onToolChange: ((tool: string) => void) | undefined = undefined;
  export let onOpenNodePanel: ((position?: { x: number; y: number }) => void) | undefined = undefined;

  const dispatch = createEventDispatcher();
  let canvasRef: any = null;
  let wrapperEl: HTMLElement;

  // Track panel dimensions for resize handling
  let width = 0;
  let height = 0;

  // Store canvas transform state to preserve viewport when switching tabs
  let canvasTransform = { x: 0, y: 0, zoom: 1 };

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
    selectedAnnotation = $sharedContextStore.selectedAnnotation;
    activeTool = $sharedContextStore.activeTool || 'select';
    presentationMode = $sharedContextStore.presentationMode || false;
    onRecordHistory = $sharedContextStore.onRecordHistory;
    onNodeSelect = $sharedContextStore.onNodeSelect;
    onAnnotationSelect = $sharedContextStore.onAnnotationSelect;
    onToolChange = $sharedContextStore.onToolChange;
    onOpenNodePanel = $sharedContextStore.onOpenNodePanel;
  }

  function handleNodeSelect(e: CustomEvent<{ node: Node | null }>) {
    if (onNodeSelect) {
      onNodeSelect(e.detail.node);
    }
  }

  function handleAnnotationSelect(e: CustomEvent<{ annotationId: string | null }>) {
    if (onAnnotationSelect) {
      onAnnotationSelect(e.detail.annotationId);
    }
  }

  function handleTransformChange(e: CustomEvent<{ transform: { x: number; y: number; zoom: number } }>) {
    canvasTransform = e.detail.transform;
  }

  function handleOpenNodePanelFromCanvas(e: CustomEvent<{ x: number; y: number }>) {
    if (onOpenNodePanel) {
      onOpenNodePanel(e.detail);
    }
  }

  function handleNodeEdit(e: CustomEvent<{ node: Node }>) {
    const node = e.detail.node;
    if (node) {
      dockviewStore.openCodeEditor(node.id, node.type || 'Code');
    }
  }

  // Expose methods for parent container
  export function addNode(params: { type: string; category: string | null; customConfig?: { name: string; modulePath: string; baseClass: string; code: string } }) {
    if (canvasRef && canvasRef.addNode) {
      canvasRef.addNode(params);
    }
  }

  export function centerOnNodes() {
    if (canvasRef && canvasRef.centerOnNodes) {
      canvasRef.centerOnNodes();
    }
  }

  export function selectAll() {
    if (canvasRef && canvasRef.selectAll) {
      canvasRef.selectAll();
    }
  }

  export function deselectAll() {
    if (canvasRef && canvasRef.deselectAll) {
      canvasRef.deselectAll();
    }
  }

  export function deleteSelected() {
    if (canvasRef && canvasRef.deleteSelected) {
      canvasRef.deleteSelected();
    }
  }

  onMount(() => {
    // Listen for custom events from container
    wrapperEl?.addEventListener('addNode', ((e: CustomEvent) => {
      addNode(e.detail);
    }) as EventListener);

    wrapperEl?.addEventListener('centerOnNodes', () => {
      centerOnNodes();
    });

    wrapperEl?.addEventListener('selectAll', () => {
      selectAll();
    });

    wrapperEl?.addEventListener('deselectAll', () => {
      deselectAll();
    });

    wrapperEl?.addEventListener('deleteSelected', () => {
      deleteSelected();
    });

    // Track panel resize
    if (panelApi) {
      const disposable = panelApi.onDidDimensionsChange?.((dimensions: { width: number; height: number }) => {
        width = dimensions.width;
        height = dimensions.height;
      });

      return () => {
        disposable?.dispose?.();
      };
    }
  });
</script>

<div class="panel-wrapper" bind:this={wrapperEl} data-panel-type="graph" data-window-id="graph">
  {#if graph}
    <Canvas
      bind:this={canvasRef}
      {graph}
      {activeTool}
      {selectedNode}
      {selectedAnnotation}
      transform={canvasTransform}
      {onRecordHistory}
      on:nodeSelect={handleNodeSelect}
      on:annotationSelect={handleAnnotationSelect}
      on:transformChange={handleTransformChange}
      on:openNodePanel={handleOpenNodePanelFromCanvas}
      on:nodeEdit={handleNodeEdit}
    />
  {:else}
    <div class="empty-state">Loading graph...</div>
  {/if}
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    font-size: 14px;
  }
</style>
