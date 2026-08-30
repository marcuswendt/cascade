// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Inspector from '@/editor/Inspector.svelte';
import ProjectPanelHost from '@/editor/panels/ProjectPanelHost.svelte';
import ProjectValueRendererHost from '@/editor/components/ProjectValueRendererHost.svelte';
import { createProjectPanelApi, discoverProjectPanels } from '@/editor/projectPanels';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import PanelIcon from '@/editor/components/PanelIcon.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('project panels', () => {
  it('renders named Lucide panel icons without exposing the metadata name', () => {
    const view = render(PanelIcon, { props: { icon: 'Aperture' } });

    expect(view.container.querySelector('svg')).not.toBeNull();
    expect(view.queryByText('Aperture')).toBeNull();
  });

  it('preserves literal built-in panel icons', () => {
    const view = render(PanelIcon, { props: { icon: '⬡' } });

    expect(view.getByText('⬡')).toBeTruthy();
    expect(view.container.querySelector('svg')).toBeNull();
  });

  it('discovers project panel metadata and preserves an empty project', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ panels: [] }) });
    await expect(discoverProjectPanels(fetcher as any)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith('/api/panels');
  });

  it('sets parameters through the graph history path', () => {
    const graph = new Graph();
    const node = new Node('source', 'project.Source', graph);
    graph.addElement(node);
    node.param('moment_id', 'old');
    const record = vi.fn();
    const api = createProjectPanelApi({
      context: () => ({ graph, selectedNode: node, selectedAnnotation: null, activeTool: 'select', activeLibrary: null, documentName: 'test', presentationMode: false, onRecordHistory: record }),
      close: vi.fn(),
      sourceNodeId: 'source',
    });

    api.setParam('source', 'moment_id', 'new');
    expect(api.getParam('source', 'moment_id')).toBe('new');
    expect(api.selectedNodeId()).toBe('source');
    expect(api.sourceNodeId).toBe('source');
    expect(record).toHaveBeenCalledOnce();
    expect(node.cookState).toBe('stale');
  });

  it('runs a project stage through capability-protected generic transport', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'exec-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stdout: '{"items":[]}', stderr: '' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const api = createProjectPanelApi({ context: () => null, close: vi.fn() });

    await expect(api.runStage('assets.list', { limit: 4 })).resolves.toEqual({ items: [] });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/exec/capability', { cache: 'no-store' });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/exec', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': 'exec-token' },
      body: JSON.stringify({ stage: 'assets.list', args: { limit: 4 } }),
    }));
  });

  it('renders action parameters as buttons', async () => {
    const graph = new Graph();
    const node = new Node('source', 'project.Source', graph);
    node.param('asset_id', '', { label: 'Choose asset', action: 'panel:asset-browser' });
    const action = vi.fn();
    const view = render(Inspector, { props: { node, graph, onAction: action } });
    await fireEvent.click(view.getByRole('button', { name: 'Choose asset' }));
    expect(action).toHaveBeenCalledWith('panel:asset-browser', 'source');
    expect(view.queryByText('pin')).toBeNull();
  });

  it('mounts and cleans up a plain TypeScript panel module', async () => {
    const cleanup = vi.fn();
    const loader = vi.fn().mockResolvedValue({
      mount(element: HTMLElement) { element.textContent = 'hello'; return cleanup; },
    });
    const view = render(ProjectPanelHost, {
      props: {
        panelParams: { id: 'project:hello', type: 'project:hello', title: 'Hello', projectPanelName: 'hello' },
        panelApi: { close: vi.fn() },
        loader,
      },
    });
    expect(await view.findByText('hello')).toBeTruthy();
    view.unmount();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('cleans up an async mount that resolves after the panel closes', async () => {
    let finish!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    const loader = vi.fn().mockResolvedValue({
      mount: () => new Promise<() => void>(resolve => { finish = resolve; }),
    });
    const view = render(ProjectPanelHost, {
      props: {
        panelParams: { id: 'project:slow', type: 'project:slow', title: 'Slow', projectPanelName: 'slow' },
        panelApi: { close: vi.fn() },
        loader,
      },
    });
    await vi.waitFor(() => expect(loader).toHaveBeenCalled());
    view.unmount();
    finish(cleanup);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it('updates and disposes a project value renderer instance', async () => {
    const update = vi.fn();
    const dispose = vi.fn();
    const loader = vi.fn().mockResolvedValue({
      mount() {},
      renderers: {
        'project.asset': {
          mount(element: HTMLElement, props: { value: unknown }) {
            element.textContent = String(props.value);
            return { update, dispose };
          },
        },
      },
    });
    const view = render(ProjectValueRendererHost, {
      props: { panelName: 'assets', rendererType: 'project.asset', value: 'first', loader },
    });
    expect(await view.findByText('first')).toBeTruthy();

    await view.rerender({ panelName: 'assets', rendererType: 'project.asset', value: 'second', loader });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ value: 'second' }));
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('shows a safe error when a declared project renderer is missing', async () => {
    const view = render(ProjectValueRendererHost, {
      props: {
        panelName: 'assets',
        rendererType: 'project.missing',
        value: null,
        loader: vi.fn().mockResolvedValue({ mount() {}, renderers: {} }),
      },
    });
    expect((await view.findByRole('alert')).textContent).toContain('does not export renderer');
  });
});
