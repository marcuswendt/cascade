// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

/**
 * Which transcript lines become formatted text, driven the way the panel is
 * actually driven: real `claude --output-format stream-json` lines handed to
 * the attach stream, classified by the real `describeStreamLine`, and rendered.
 *
 * The point of going through the stream rather than poking `entries` is that
 * the classification is half the decision. An assistant text block and a
 * tool-use block arrive in the same event, and only one of them is prose.
 *
 * What this cannot prove: jsdom applies no CSS, so nothing here shows the
 * result is legible, that a wide table scrolls instead of stretching the
 * panel, or that the zoom still reaches it. Those are guarded at source level
 * in agent-panel-styles.test.ts and were checked by eye in Chrome.
 */

const attachAgentSession = vi.fn();

vi.mock('@/editor/agentConsole', async () => {
  // describeStreamLine is the classifier under test here, so it stays real.
  const actual = await vi.importActual<typeof import('@/editor/agentConsole')>('@/editor/agentConsole');
  return {
    ...actual,
    attachAgentSession,
    agentStatus: vi.fn(async () => ({ sessions: [], root: '/project', agents: [] })),
    sendAgentPrompt: vi.fn(),
    cancelAgentSession: vi.fn(),
    resetAgentSession: vi.fn(),
  };
});

const { registerStudioDocumentBridge } = await import('@/editor/studioDocumentBridge');
const AgentPanel = (await import('@/editor/panels/AgentPanel.svelte')).default;

let disposeBridge: (() => void) | null = null;

beforeEach(() => {
  disposeBridge = registerStudioDocumentBridge({
    file: () => 'sketch.cascade',
    isDirty: () => false,
    save: async () => true,
  });
});

afterEach(() => {
  disposeBridge?.();
  disposeBridge = null;
  attachAgentSession.mockReset();
  vi.restoreAllMocks();
});

/** One assistant text block, as the stream delivers it. */
function assistantText(text: string): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

/** Mount the panel and feed it stdout lines through the attach stream. */
async function transcript(lines: string[]): Promise<HTMLElement> {
  attachAgentSession.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
    onEvent({ type: 'attached', running: false, dropped: 0, replayed: lines.length, agent: 'claude', sketch: 'sketch.cascade' });
    for (const text of lines) onEvent({ type: 'stdout', text });
  });
  const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
  await tick();
  await tick();
  return view.container.querySelector('.transcript') as HTMLElement;
}

describe('agent prose is rendered as formatted text', () => {
  it('renders an assistant reply, headings and lists and all', async () => {
    const el = await transcript([
      assistantText('## What changed\n\n- moved `nodes/offset/index.ts` to `vec2`\n- **rebuilt** the graph'),
    ]);

    const entry = el.querySelector('.entry.agent');
    expect(entry).toBeTruthy();
    expect(entry?.querySelector('h2')?.textContent).toBe('What changed');
    expect(entry?.querySelectorAll('li')).toHaveLength(2);
    expect(entry?.querySelector('code')?.textContent).toBe('nodes/offset/index.ts');
    expect(entry?.querySelector('strong')?.textContent).toBe('rebuilt');
    // The source markers are gone from the text, which is the whole complaint.
    expect(entry?.textContent).not.toContain('##');
    expect(entry?.textContent).not.toContain('**');
  });

  it('renders a table and a code block in the final result', async () => {
    const el = await transcript([
      JSON.stringify({
        type: 'result',
        result: '| Gate | State |\n| --- | --- |\n| tests | green |\n\nRun:\n\n```sh\nnpm run check\n```',
      }),
    ]);

    const entry = el.querySelector('.entry.result');
    expect(entry).toBeTruthy();
    expect(entry?.querySelectorAll('th')).toHaveLength(2);
    expect(entry?.querySelector('td')?.textContent).toBe('tests');
    expect(entry?.querySelector('pre code')?.textContent).toContain('npm run check');
    expect(entry?.textContent).not.toContain('| --- |');
  });
});

describe('everything else stays literal', () => {
  it('leaves a tool line alone, underscores and asterisks included', async () => {
    // Real tool-use blocks: a path with underscores, and a glob with an
    // asterisk. Rendered as Markdown, `_index_` would become emphasis and the
    // path would be unrecoverable.
    const el = await transcript([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/nodes/_offset_index_.ts' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls src/**/*.ts' } },
          ],
        },
      }),
    ]);

    const entry = el.querySelector('.entry.tool');
    expect(entry).toBeTruthy();
    expect(entry?.querySelector('em')).toBeNull();
    expect(entry?.querySelector('strong')).toBeNull();
    expect(entry?.textContent).toContain('src/nodes/_offset_index_.ts');
    expect(entry?.textContent).toContain('ls src/**/*.ts');
  });

  it('leaves stderr literal', async () => {
    attachAgentSession.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'stderr', text: 'error in __init__: expected *args' });
    });
    const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
    await tick();
    await tick();

    const entry = view.container.querySelector('.entry.error');
    expect(entry?.querySelector('strong')).toBeNull();
    expect(entry?.textContent).toContain('error in __init__: expected *args');
  });

  it('leaves a raw non-JSON stdout line literal', async () => {
    const el = await transcript(['plain output with *stars* and _scores_']);

    // The attach event prints a system line of its own first, so it is the
    // last system entry that carries the stdout.
    const systems = [...el.querySelectorAll('.entry.system')];
    const entry = systems[systems.length - 1];
    expect(entry?.querySelector('em')).toBeNull();
    expect(entry?.textContent).toContain('*stars*');
    expect(entry?.textContent).toContain('_scores_');
  });

  it('only marks agent prose as markdown', async () => {
    const el = await transcript([
      assistantText('**prose**'),
      'raw line',
      JSON.stringify({ type: 'result', result: '**done**' }),
    ]);

    const marked = [...el.querySelectorAll('.entry.markdown')].map((node) => node.className);
    expect(marked.every((name) => name.includes('agent') || name.includes('result'))).toBe(true);
    expect(el.querySelector('.entry.system')?.classList.contains('markdown')).toBe(false);
  });
});
