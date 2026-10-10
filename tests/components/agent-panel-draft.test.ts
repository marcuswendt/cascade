// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { queueAgentDraft, drainAgentDrafts } from '@/editor/agentDraft';
import { setSharedContext } from '@/editor/dockview/renderer';

const mocks = vi.hoisted(() => ({
  sendAgentPrompt: vi.fn(async () => {}),
}));

vi.mock('@/editor/agentConsole', async () => {
  const actual = await vi.importActual<typeof import('@/editor/agentConsole')>('@/editor/agentConsole');
  return {
    ...actual,
    attachAgentSession: vi.fn(async () => {}),
    agentStatus: vi.fn(async () => ({
      sessions: [], root: '/project',
      agents: [{ alias: 'claude', command: 'claude', args: [], configured: true, resolved: '/bin/claude', hint: null }],
    })),
    sendAgentPrompt: mocks.sendAgentPrompt,
    cancelAgentSession: vi.fn(),
    resetAgentSession: vi.fn(),
  };
});

const { registerStudioDocumentBridge } = await import('@/editor/studioDocumentBridge');
const AgentPanel = (await import('@/editor/panels/AgentPanel.svelte')).default;
let disposeBridge: (() => void) | null = null;
let dirty = false;
const saveDocument = vi.fn(async () => {
  dirty = false;
  return true;
});

beforeEach(() => {
  drainAgentDrafts();
  mocks.sendAgentPrompt.mockClear();
  dirty = false;
  saveDocument.mockClear();
  disposeBridge = registerStudioDocumentBridge({ file: () => 'strategy.cascade', isDirty: () => dirty, save: saveDocument });
});

afterEach(() => {
  disposeBridge?.();
  setSharedContext(null as never);
});

describe('Agent panel drafts', () => {
  it('merges an external draft into the composer without submitting it', async () => {
    const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
    const textarea = view.getByPlaceholderText('Prompt the sketch');
    await fireEvent.input(textarea, { target: { value: 'Existing thought' } });

    queueAgentDraft('Challenge this observation');

    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toContain('Existing thought\n\n---\n\nChallenge this observation'));
    expect(mocks.sendAgentPrompt).not.toHaveBeenCalled();
  });

  it('adds selected-node context only when requested and sends through the existing path', async () => {
    const graph = new Graph();
    const node = new Node('positioning', 'project.Note', graph);
    graph.addElement(node);
    node.param('confidence', 0.7);
    node.out('opinion', 'param', { type: 'string' }).setValue('Judgment is the product.');
    setSharedContext({ graph, selectedNode: node, selectedAnnotation: null, activeTool: 'select', activeLibrary: null, documentName: 'strategy.cascade', presentationMode: false });
    dirty = true;

    const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
    await fireEvent.click(view.getByRole('button', { name: 'Use selected node' }));
    await fireEvent.input(view.getByPlaceholderText('Prompt the sketch'), { target: { value: 'Challenge this position.' } });
    await fireEvent.click(view.getByRole('button', { name: 'Send prompt' }));

    await waitFor(() => expect(mocks.sendAgentPrompt).toHaveBeenCalledOnce());
    expect(saveDocument).toHaveBeenCalledOnce();
    expect(saveDocument.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendAgentPrompt.mock.invocationCallOrder[0]);
    const sent = mocks.sendAgentPrompt.mock.calls[0][0].prompt;
    expect(sent).toContain('Current graph: "strategy.cascade"');
    expect(sent).toContain('untrusted graph data');
    expect(sent).toContain('"id": "positioning"');
    expect(sent).toContain('User request:\n\nChallenge this position.');
  });
});
