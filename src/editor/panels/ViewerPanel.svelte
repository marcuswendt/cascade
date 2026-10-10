<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import type { Annotation } from '@/nodes/annotations/Annotation';
  import Viewer from '../Viewer.svelte';
  import {
    sharedContextStore,
    panelLockStore,
    reconcilePanelLock,
    resolveLockedNode,
    restorePanelLock,
  } from '../dockview/renderer';
  import { graphStructure } from '../stores/graphStructure';
  import { dockviewStore } from '../dockview/dockview-store.svelte';
  import { viewerTitle } from '../viewerDrag';

  export let panelId: string;
  export let panelApi: any;
  export let panelParams: CascadePanelParams | undefined = undefined;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;
  export let selectedAnnotationId: string | null = null;

  // A lock saved with the layout comes back as an id; the node binds once
  // the graph holding it has loaded.
  if (panelParams?.lockedNodeId) restorePanelLock(panelId, panelParams.lockedNodeId);

  // The node to actually display (locked or selected)
  $: lockState = $panelLockStore.get(panelId);
  $: isLocked = lockState?.isLocked ?? false;
  $: lockedNode = lockState?.isLocked
    ? (lockState.lockedNode ?? (() => {
        const resolved = resolveLockedNode(lockState, graph);
        return resolved.kind === 'node' ? resolved.node : null;
      })())
    : null;
  $: displayNode = isLocked ? lockedNode : selectedNode;

  // Follow a rename or a rebuilt graph; drop the lock when its node is
  // deleted. Subscriptions rather than a `$:` block, because a store written
  // from inside a reactive pass does not re-run the statements that read it.
  onMount(() => {
    const reconcile = () => reconcilePanelLock(panelId, get(sharedContextStore)?.graph ?? graph);
    const unsubscribers = [
      sharedContextStore.subscribe(reconcile),
      graphStructure.subscribe(reconcile),
      panelLockStore.subscribe(reconcile),
    ];
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  });

  // Persist the lock with the layout (the layout autosaves panel params).
  let persistedLockId: string | undefined = panelParams?.lockedNodeId;
  $: {
    const nextId = lockState?.isLocked && !lockState.lockedAnnotationId
      ? (lockState.lockedNode?.id ?? lockState.lockedNodeId ?? undefined)
      : undefined;
    if (nextId !== persistedLockId && panelApi?.updateParameters) {
      persistedLockId = nextId;
      panelApi.updateParameters({ lockedNodeId: nextId });
      // The layout otherwise autosaves every 30 s; a lock should survive a
      // reload straight after it was set.
      dockviewStore.saveLayout();
    }
  }

  // Resolve the selected annotation
  let resolvedAnnotation: Annotation | null = null;
  $: {
    if (selectedAnnotationId && graph) {
      resolvedAnnotation = graph.getAnnotation(selectedAnnotationId);
    } else {
      resolvedAnnotation = null;
    }
  }

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
    selectedAnnotationId = $sharedContextStore.selectedAnnotation;
  }

  // Update panel title when display node/annotation changes. A lock reads
  // from the tab's lock icon, so the title carries only what is shown.
  $: {
    if (panelApi?.setTitle) {
      void $graphStructure;
      panelApi.setTitle(viewerTitle(displayNode?.id ?? null, resolvedAnnotation
        ? (resolvedAnnotation.caption || resolvedAnnotation.type)
        : null));
    }
  }
</script>

<div class="panel-wrapper" data-viewer-drop={panelId}>
  <Viewer {graph} selectedNode={displayNode} selectedAnnotation={resolvedAnnotation} />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface-void);
    position: relative;
  }

  /* A node dragged out of the graph is hovering this viewer (or its tab). */
  .panel-wrapper:global(.cascade-viewer-drop-target)::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--accent);
    background: color-mix(in oklch, var(--accent) 10%, transparent);
    pointer-events: none;
  }

  :global(.cascade-tab.cascade-viewer-drop-target) {
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--text-primary);
  }
</style>
