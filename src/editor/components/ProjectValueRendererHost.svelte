<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadProjectPanel,
    type ProjectPanelModule,
    type ProjectValueRendererInstance,
    type ProjectValueRendererProps,
  } from '../projectPanels';

  export let panelName: string;
  export let rendererType: string;
  export let value: unknown;
  export let readOnly = true;
  export let mode: ProjectValueRendererProps['mode'] = 'inspect';
  export let onChange: ((value: unknown) => void) | null = null;
  export let loader: (name: string) => Promise<ProjectPanelModule> = loadProjectPanel;

  let host: HTMLDivElement;
  let instance: ProjectValueRendererInstance | null = null;
  let error = '';
  $: props = { value, readOnly, mode, onChange } satisfies ProjectValueRendererProps;
  $: instance?.update?.(props);

  onMount(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    loader(panelName).then(async loaded => {
      if (disposed) return;
      const renderer = loaded.renderers?.[rendererType];
      if (!renderer) throw new Error(`Project module "${panelName}" does not export renderer "${rendererType}"`);
      const mounted = await renderer.mount(host, props);
      if (typeof mounted === 'function') cleanup = mounted;
      else if (mounted) instance = mounted;
      if (disposed) {
        cleanup?.();
        instance?.dispose();
      }
    }).catch(cause => {
      if (!disposed) error = cause instanceof Error ? cause.message : String(cause);
    });
    return () => {
      disposed = true;
      cleanup?.();
      instance?.dispose();
    };
  });
</script>

{#if error}<span class="renderer-error" role="alert">{error}</span>{:else}<div bind:this={host}></div>{/if}

<style>.renderer-error { color: #ff6b6b; }</style>
