<script lang="ts">
  /**
   * The sketch's own console: type a prompt, a coding agent runs in the project
   * directory and rewrites the files, and the document watcher makes the graph
   * window pick the change up. Sits beside the Log panel because that is where
   * you are already looking while a scene cooks.
   *
   * Two rules it enforces rather than assumes. The document is **saved before
   * the prompt is handed over** — the agent rewrites the same file Studio holds,
   * so unsaved changes and the agent's rewrite would both believe they won, and
   * the loss would be silent. And nothing is launched that is not in the
   * project's own `cascade.json` allowlist; when it is missing, the panel prints
   * exactly the line to add rather than a permission error.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import type { CascadePanelParams } from '../dockview/types';
  import {
    agentStatus,
    describeStreamLine,
    resetAgentSession,
    sendAgentPrompt,
    AgentUnavailableError,
    type AgentAvailability,
  } from '../agentConsole';
  import { studioDocument } from '../studioDocumentBridge';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any = null;
  export let containerApi: any = null;

  type EntryKind = 'you' | 'agent' | 'tool' | 'result' | 'system' | 'error' | 'detail';
  interface Entry {
    kind: EntryKind;
    text: string;
  }

  const AGENTS = ['claude', 'codex'];

  let agent = 'claude';
  let prompt = '';
  let entries: Entry[] = [];
  /** Stream bookkeeping — rate_limit_event and anything else the format grows.
   *  Kept rather than dropped, because a line the console silently discards is
   *  one nobody can debug, but hidden by default: it is noise between the parts
   *  of the transcript that are actually a conversation. */
  let showDetail = false;
  let busy = false;
  let availability: AgentAvailability[] = [];
  let projectRoot = '';
  let statusError: string | null = null;
  let statusLoaded = false;
  let controller: AbortController | null = null;
  let transcriptEl: HTMLDivElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let dropActive = false;

  $: selected = availability.find(entry => entry.alias === agent) ?? null;
  $: launchable = !statusLoaded || Boolean(selected?.configured && selected?.resolved);
  // Polled rather than derived: the open document lives in App.svelte and a
  // panel has no reactive path to it, so the label would otherwise still name
  // the graph that was open when the panel was created.
  let sketch: string | null = studioDocument()?.file() ?? null;
  onMount(() => {
    const timer = setInterval(() => { sketch = studioDocument()?.file() ?? null; }, 1000);
    return () => clearInterval(timer);
  });

  void loadStatus();

  async function loadStatus(): Promise<void> {
    try {
      const status = await agentStatus();
      availability = status.agents;
      projectRoot = status.root;
      // Prefer whatever is actually runnable, still defaulting to Claude.
      if (!availability.find(entry => entry.alias === agent && entry.configured && entry.resolved)) {
        const usable = availability.find(entry => entry.configured && entry.resolved);
        if (usable) agent = usable.alias;
      }
    } catch (error) {
      statusError = error instanceof Error ? error.message : String(error);
    } finally {
      statusLoaded = true;
    }
  }

  function push(kind: EntryKind, text: string): void {
    if (!text.trim()) return;
    entries = [...entries, { kind, text }];
    void scrollToEnd();
  }

  $: detailCount = entries.filter((entry) => entry.kind === 'detail').length;
  $: visibleEntries = showDetail ? entries : entries.filter((entry) => entry.kind !== 'detail');

  /** Grow the prompt box with the prompt, up to a third of the panel.
   *  A two-line box is right for "make it blue" and wrong for the paragraph
   *  that describes a scene, which is most of what gets typed here. */
  function autoGrow(): void {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const cap = Math.max(120, Math.round((transcriptEl?.clientHeight ?? 400) / 2));
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, cap)}px`;
  }

  async function scrollToEnd(): Promise<void> {
    await tick();
    if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  /**
   * Saving is the precondition, not a courtesy. When the open document cannot
   * be written back to the project — an imported graph, or Studio running
   * without the `cascade` CLI — sending is refused, because the agent would be
   * editing a file that has nothing to do with what is on screen.
   */
  async function saveFirst(): Promise<string | null> {
    const bridge = studioDocument();
    if (!bridge) {
      push('error', 'Studio has not registered the open document, so it cannot be saved before the prompt runs. Nothing was sent.');
      return null;
    }
    const file = bridge.file();
    if (!file) {
      push('error', 'This graph is not a project file, so the agent has nothing to edit. Open the sketch through the `cascade` CLI, or save it into the project first.');
      return null;
    }
    if (bridge.isDirty()) {
      const saved = await bridge.save();
      if (!saved) {
        push('error', `Could not save ${file}, so the prompt was not sent — the agent would have rewritten the file underneath your unsaved changes.`);
        return null;
      }
      push('system', `Saved ${file} before handing the prompt over.`);
    }
    return file;
  }

  async function send(): Promise<void> {
    const text = prompt.trim();
    if (!text || busy) return;

    const file = await saveFirst();
    if (!file) return;

    push('you', text);
    prompt = '';
    void tick().then(autoGrow);
    busy = true;
    controller = new AbortController();

    try {
      await sendAgentPrompt({
        agent,
        sketch: file,
        prompt: text,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'started') {
            push('system', `${agent} ${event.resumed ? 'resumed' : 'started'} for ${event.sketch}`);
          } else if (event.type === 'stdout') {
            const described = describeStreamLine(event.text);
            if (described) push(described.kind === 'raw' ? 'system' : described.kind === 'text' ? 'agent' : described.kind, described.text);
          } else if (event.type === 'stderr') {
            push('error', event.text.trimEnd());
          } else if (event.type === 'exit') {
            if (event.cancelled) push('system', 'Stopped.');
            else if (event.timedOut) push('error', 'The agent was still running after 15 minutes and was stopped.');
            else if (event.code !== 0) push('error', `${agent} exited with code ${event.code}.`);
          } else if (event.type === 'error') {
            push('error', event.message);
          }
        },
      });
    } catch (error) {
      if (error instanceof AgentUnavailableError) {
        push('error', error.message);
        if (error.hint) push('system', error.hint);
      } else if ((error as Error)?.name === 'AbortError') {
        push('system', 'Stopped.');
      } else {
        push('error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      busy = false;
      controller = null;
    }
  }

  function stop(): void {
    controller?.abort();
  }

  async function newSession(): Promise<void> {
    const file = studioDocument()?.file();
    if (file) await resetAgentSession(agent, file);
    entries = [];
    push('system', `New ${agent} session for ${file ?? 'this sketch'}.`);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  /**
   * A node or parameter dragged in arrives as `text/plain` carrying its
   * expression address — the same string that could be typed into a parameter
   * field, `ch()`-style: `TRANSFORM/tx` for another node's parameter, `./tx`
   * for one on the node itself. The drop side is all this panel owns; whatever
   * starts the drag has to set that payload.
   */
  function onDrop(event: DragEvent): void {
    const text = event.dataTransfer?.getData('text/plain');
    dropActive = false;
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    insert(text.trim());
  }

  function onDragOver(event: DragEvent): void {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes('text/plain') || types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dropActive = true;
  }

  function insert(text: string): void {
    if (!text) return;
    const at = inputEl?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, at);
    const after = prompt.slice(at);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    prompt = `${before}${spacer}${text}${after}`;
    void tick().then(() => {
      inputEl?.focus();
      const caret = (before + spacer + text).length;
      inputEl?.setSelectionRange(caret, caret);
    });
  }

  onDestroy(() => controller?.abort());
</script>

<div
  class="console"
  class:drop-active={dropActive}
  on:dragover={onDragOver}
  on:dragleave={() => (dropActive = false)}
  on:drop={onDrop}
  role="group"
  aria-label="Agent console"
>
  <div class="bar">
    <select bind:value={agent} disabled={busy} aria-label="Agent">
      {#each AGENTS as alias}
        <option value={alias}>{alias}</option>
      {/each}
    </select>
    <span class="sketch" title={sketch ?? 'no project file'}>{sketch ?? 'no project file'}</span>
    <span class="spacer"></span>
    {#if busy}
      <button type="button" on:click={stop}>Stop</button>
    {:else}
      <button type="button" on:click={newSession} title="Forget the conversation for this sketch">Reset</button>
    {/if}
  </div>

  {#if statusError}
    <div class="notice">{statusError}</div>
  {:else if statusLoaded && !launchable}
    <div class="notice">
      <div>{selected?.hint ?? `Command "${agent}" is not allowed.`}</div>
      {#if projectRoot && !selected?.configured}
        <code>"commands": {'{'} "{agent}": "&lt;path&gt;" {'}'}</code>
      {/if}
    </div>
  {/if}

  <div class="transcript" bind:this={transcriptEl}>
    {#if entries.length === 0}
      <div class="hint">Say what the sketch should become. Drag a node in for its path.</div>
    {/if}
    {#each visibleEntries as entry, index (index)}
      <div class="entry {entry.kind}">{entry.text}</div>
    {/each}
    {#if detailCount > 0}
      <button class="detail-toggle" on:click={() => (showDetail = !showDetail)}>
        {showDetail ? 'Hide' : 'Show'} {detailCount} stream {detailCount === 1 ? 'event' : 'events'}
      </button>
    {/if}
  </div>

  <div class="composer">
    <textarea
      bind:this={inputEl}
      bind:value={prompt}
      on:keydown={onKeydown}
      on:input={autoGrow}
      rows="2"
      spellcheck="false"
      placeholder={busy ? `${agent} is working…` : 'Prompt the sketch'}
      disabled={busy}
    ></textarea>
    <button type="button" class="send" on:click={send} disabled={busy || !prompt.trim() || !launchable}>Send</button>
  </div>
</div>

<style>
  .console {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface-panel);
    color: var(--text-primary);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    min-height: 0;
  }

  .console.drop-active {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-divider);
    background: var(--surface-panel-alt);
  }

  .bar select,
  .bar button,
  .send {
    background: var(--surface-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 3px;
    font: inherit;
    padding: 2px 6px;
    cursor: pointer;
  }

  .bar button:hover,
  .send:hover:not(:disabled) {
    background: var(--surface-control-hover);
  }

  .send:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .sketch {
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }

  .spacer {
    flex: 1;
  }

  .notice {
    padding: 6px 8px;
    background: var(--banner-warn-bg);
    color: var(--banner-warn-text);
    border-bottom: 1px solid var(--banner-warn-border);
    line-height: 1.5;
  }

  .notice code {
    display: block;
    margin-top: 4px;
    color: var(--text-code);
    white-space: pre-wrap;
  }

  .transcript {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hint {
    color: var(--text-faint);
    line-height: 1.6;
  }

  .entry {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .entry.you {
    color: var(--accent);
  }

  .entry.agent {
    color: var(--text-primary);
  }

  .entry.result {
    color: var(--text-bright);
  }

  .entry.tool {
    color: var(--text-tertiary);
  }

  .entry.system {
    color: var(--text-faint);
  }

  .entry.detail {
    color: var(--text-faint);
    font-size: 0.9em;
  }

  .entry.error {
    color: var(--status-error);
  }

  .detail-toggle {
    align-self: flex-start;
    margin-top: 0.25rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    background: transparent;
    color: var(--text-faint);
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
  }

  .detail-toggle:hover {
    color: var(--text-secondary);
    border-color: var(--border-divider);
  }

  .composer {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    padding: 6px;
    border-top: 1px solid var(--border-divider);
    background: var(--surface-panel-alt);
  }

  .composer textarea {
    flex: 1;
    resize: none;
    max-height: 50%;
    overflow-y: auto;
    background: var(--surface-input);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 3px;
    font: inherit;
    padding: 4px 6px;
  }

  .composer textarea:focus {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
