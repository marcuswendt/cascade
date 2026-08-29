<script lang="ts">
  import { onMount } from 'svelte';
  import type { CascadePanelParams } from '../dockview/types';
  import { getSharedContext } from '../dockview/renderer';
  import {
    createProjectPanelApi,
    loadProjectPanel,
    type ProjectPanelModule,
  } from '../projectPanels';

  export let panelParams: CascadePanelParams;
  export let panelApi: { close(): void };
  export let loader: (name: string) => Promise<ProjectPanelModule> = loadProjectPanel;

  let host: HTMLDivElement;
  let error = '';

  onMount(() => {
    let disposed = false;
    let cleanup: (() => void) | void;
    const controller = new AbortController();
    const name = panelParams.projectPanelName;
    if (!name) {
      error = 'Project panel name is missing';
      return;
    }

    loader(name).then(async loaded => {
      if (disposed) return;
      const mounted = await loaded.mount(host, createProjectPanelApi({
        context: getSharedContext,
        close: () => panelApi.close(),
        sourceNodeId: panelParams.sourceNodeId,
        signal: controller.signal,
      }));
      if (disposed) mounted?.();
      else cleanup = mounted;
    }).catch(cause => {
      if (!disposed) error = cause instanceof Error ? cause.message : String(cause);
    });

    return () => {
      disposed = true;
      controller.abort();
      cleanup?.();
    };
  });
</script>

{#if error}
  <div class="panel-error" role="alert">{error}</div>
{:else}
  <div class="project-panel" bind:this={host}></div>
{/if}

<style>
  .project-panel { width: 100%; height: 100%; overflow: auto; }
  .panel-error { padding: 16px; color: #ff6b6b; }
</style>
