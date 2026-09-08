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
   *
   * And it **reconnects rather than stranding**. The agent is a detached child
   * of the Studio server, so a browser reload never ended it — it only ever
   * lost sight of it, leaving a Claude editing the project with nobody reading
   * its output. On mount the panel asks the server what is happening for this
   * sketch, replays the buffered transcript, and rejoins the live stream if
   * there is one. When there is nothing running it says so, which is the other
   * half of the same fix: a console that looks identical whether it is idle or
   * broken is what made a stranded agent invisible in the first place.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import type { CascadePanelParams } from '../dockview/types';
  import {
    agentStatus,
    attachAgentSession,
    cancelAgentSession,
    describeStreamLine,
    resetAgentSession,
    sendAgentPrompt,
    AgentUnavailableError,
    type AgentAvailability,
    type AgentEvent,
  } from '../agentConsole';
  import { studioDocument } from '../studioDocumentBridge';
  import { ownsKeyboard } from '../panelScope';

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
  /** The reader rejoining a run somebody else (or a previous page load)
   *  started. Separate from `controller`, which belongs to a prompt this panel
   *  sent, because aborting either must not touch the other. */
  let attachController: AbortController | null = null;
  let attachedTo: string | null = null;
  let attachedAgent: string | null = null;
  let live = false;
  let transcriptEl: HTMLDivElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let dropActive = false;
  let consoleEl: HTMLDivElement | null = null;

  /**
   * Text zoom, on the standard keys. A transcript is the one panel you read
   * rather than operate, and the graph-legible size is not the reading size.
   *
   * The scale is a multiplier on the panel's own font size, not the browser's
   * page zoom: page zoom would resize the graph and every other panel with it,
   * which is the opposite of what a per-panel control is for. Persisted,
   * because a size you have to reset on every reload is not a setting.
   */
  const ZOOM_KEY = 'cascade.agentPanel.zoom';
  const ZOOM_STEPS = [0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
  const ZOOM_DEFAULT = 1;
  let zoom = readZoom();

  function readZoom(): number {
    // A stored value is not trusted: localStorage survives across versions and
    // a bad number here would make the panel unreadable with no way back.
    try {
      const raw = Number(localStorage.getItem(ZOOM_KEY));
      return ZOOM_STEPS.includes(raw) ? raw : ZOOM_DEFAULT;
    } catch {
      return ZOOM_DEFAULT;
    }
  }

  function setZoom(next: number): void {
    zoom = next;
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Private windows throw on write. A zoom that does not persist is still
      // a working zoom.
    }
  }

  function stepZoom(direction: 1 | -1): void {
    const at = ZOOM_STEPS.indexOf(zoom);
    const from = at === -1 ? ZOOM_STEPS.indexOf(ZOOM_DEFAULT) : at;
    const to = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction));
    if (to !== from) setZoom(ZOOM_STEPS[to]);
  }

  /**
   * Bound on the window, gated on this panel owning the keyboard. A listener on
   * the panel element only ever fires for keys bubbling out of the prompt box,
   * so it would not work while you were simply reading the transcript.
   *
   * Bare `+ - 0` as well as the cmd forms, matching the graph canvas, which is
   * what "the standard keys" means here. The bare forms stand down while you
   * are typing — a prompt box that could not accept a `+` would be a poor
   * trade for a shortcut — and the cmd forms work either way.
   *
   * `-` and `=` are read from `event.key` alongside the shifted `_` and `+`,
   * because which one arrives depends on the keyboard layout, and a shortcut
   * that works on one layout and not another is worse than none.
   */
  function onZoomKeydown(event: KeyboardEvent): void {
    if (event.altKey) return;
    const command = event.metaKey || event.ctrlKey;
    if (!consoleEl || !ownsKeyboard('agent')) return;
    // `event.target` rather than `document.activeElement`: they agree here, and
    // the target is what actually receives the character.
    const typing =
      event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    if (!command && typing) return;

    if (event.key === '0') {
      event.preventDefault();
      setZoom(ZOOM_DEFAULT);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      stepZoom(1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      stepZoom(-1);
    }
  }

  $: selected = availability.find(entry => entry.alias === agent) ?? null;
  /** Busy is "this panel sent the prompt"; live is "an agent is running for
   *  this sketch", which is also true after a reload or in a second window.
   *  Everything the user can do is gated on the second one — a prompt sent
   *  while a run is live would be refused with BUSY anyway. */
  $: working = busy || live;
  $: launchable = !statusLoaded || Boolean(selected?.configured && selected?.resolved);
  // Polled rather than derived: the open document lives in App.svelte and a
  // panel has no reactive path to it, so the label would otherwise still name
  // the graph that was open when the panel was created.
  let sketch: string | null = studioDocument()?.file() ?? null;
  onMount(() => {
    void reconnect(sketch);
    const timer = setInterval(() => {
      const current = studioDocument()?.file() ?? null;
      if (current !== sketch) {
        sketch = current;
        void reconnect(current);
      } else if (!busy && attachedAgent !== agent) {
        // The selected agent changed — including the switch loadStatus makes
        // when Claude is not the one this project allows.
        void reconnect(current);
      } else {
        void watchForLiveRun();
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  void loadStatus();

  async function loadStatus(): Promise<void> {
    try {
      const status = await agentStatus(sketch ?? undefined);
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

  /**
   * What one stream event does to the transcript. Shared by the prompt stream
   * and the attach stream on purpose: a replayed line and a live one are the
   * same event, so a reconnected transcript reads exactly like one that was
   * never interrupted.
   */
  function handleEvent(event: AgentEvent): void {
    if (event.type === 'attached') {
      live = event.running;
      if (event.dropped > 0) {
        push('system', `${event.dropped} earlier ${event.dropped === 1 ? 'line' : 'lines'} were dropped from the server's buffer.`);
      }
      if (event.running) push('system', `Reconnected to the ${event.agent} session running for ${event.sketch}.`);
      else if (event.replayed > 0) push('system', `Showing the last ${event.agent} run for ${event.sketch}. Nothing is running now.`);
    } else if (event.type === 'started') {
      live = true;
      push('system', `${event.agent} ${event.resumed ? 'resumed' : 'started'} for ${event.sketch}`);
    } else if (event.type === 'stdout') {
      const described = describeStreamLine(event.text);
      if (described) push(described.kind === 'raw' ? 'system' : described.kind === 'text' ? 'agent' : described.kind, described.text);
    } else if (event.type === 'stderr') {
      push('error', event.text.trimEnd());
    } else if (event.type === 'exit') {
      live = false;
      if (event.cancelled) push('system', 'Stopped.');
      else if (event.timedOut) push('error', 'The agent was still running after 15 minutes and was stopped.');
      else if (event.code !== 0) push('error', `${agent} exited with code ${event.code}.`);
    } else if (event.type === 'error') {
      live = false;
      push('error', event.message);
    }
  }

  /**
   * Join whatever the server has for this sketch: the buffered transcript of
   * the last run, and the live stream if one is still going.
   *
   * Called on mount and whenever the open document changes. Never starts
   * anything — attaching to nothing is a one-line answer and an idle console.
   */
  async function reconnect(file: string | null): Promise<void> {
    attachController?.abort();
    attachController = null;
    attachedTo = file;
    attachedAgent = agent;
    live = false;
    if (busy) return;
    entries = [];
    if (!file) return;

    const controllerForAttach = new AbortController();
    attachController = controllerForAttach;
    try {
      await attachAgentSession({
        agent,
        sketch: file,
        onEvent: (event) => {
          // A document switched during the round trip must not paint the old
          // sketch's transcript over the new one.
          if (attachedTo !== file) return;
          handleEvent(event);
        },
      signal: controllerForAttach.signal,
      });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        push('error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (attachController === controllerForAttach) attachController = null;
      live = false;
    }
  }

  /**
   * Pick up a run this panel did not start — a second window on the same
   * sketch, or one launched before this page loaded. Cheap status poll rather
   * than a held-open request, so an idle console costs one small GET a second
   * and never a process.
   */
  async function watchForLiveRun(): Promise<void> {
    if (busy || live || attachController || !sketch || statusError) return;
    try {
      const status = await agentStatus(sketch);
      const running = status.sessions.find((entry) => entry.sketch === sketch && entry.agent === agent && entry.running);
      if (running && !busy && !attachController) await reconnect(sketch);
    } catch {
      // A transient status failure is not worth a line in the transcript; the
      // next tick tries again.
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

    // This panel becomes the run's reader through the prompt stream, so any
    // attach reader it is holding would double every line.
    attachController?.abort();
    attachController = null;

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
        onEvent: handleEvent,
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
      live = false;
    }
  }

  /**
   * Stop means stop the agent, not stop watching it.
   *
   * Aborting the request alone used to be enough because a closing socket
   * killed the child. It no longer does — that is what makes a reload
   * survivable — so the kill has to be asked for.
   */
  async function stop(): Promise<void> {
    const file = sketch ?? studioDocument()?.file() ?? null;
    if (file) await cancelAgentSession(agent, file);
    controller?.abort();
    attachController?.abort();
  }

  async function newSession(): Promise<void> {
    const file = studioDocument()?.file();
    attachController?.abort();
    attachController = null;
    if (file) await resetAgentSession(agent, file);
    entries = [];
    live = false;
    push('system', `New ${agent} session for ${file ?? 'this sketch'}.`);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Cmd-Enter is the one that matches the arrow button and works from
    // anywhere in a long prompt. Plain Enter still sends, and Shift-Enter
    // still breaks a line, because both were already true and neither is
    // worth taking away.
    if (event.key !== 'Enter') return;
    if (event.metaKey || event.ctrlKey || !event.shiftKey) {
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

  // Detaching both readers. Neither stops the agent, which is the point: this
  // panel closing is not a reason to abandon a run mid-edit.
  onDestroy(() => {
    controller?.abort();
    attachController?.abort();
  });
</script>

<svelte:window on:keydown={onZoomKeydown} />

<div
  class="console"
  data-panel-scope="agent"
  class:drop-active={dropActive}
  bind:this={consoleEl}
  style="--agent-zoom: {zoom}"
  on:dragover={onDragOver}
  on:dragleave={() => (dropActive = false)}
  on:drop={onDrop}
  role="group"
  aria-label="Agent console"
>
  <div class="bar">
    <select bind:value={agent} disabled={working} aria-label="Agent">
      {#each AGENTS as alias}
        <option value={alias}>{alias}</option>
      {/each}
    </select>
    {#if !sketch}
      <span class="sketch" title="Open the sketch through the cascade CLI">no project file</span>
    {/if}
    <span class="spacer"></span>
    {#if zoom !== ZOOM_DEFAULT}
      <button
        type="button"
        class="zoom"
        on:click={() => setZoom(ZOOM_DEFAULT)}
        title="Text size — click to reset (⌘0)"
      >{Math.round(zoom * 100)}%</button>
    {/if}
    {#if working}
      <span class="running" title="An agent is running for this sketch">running</span>
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
      <div class="hint">
        {#if !sketch}
          No project file is open, so there is nothing for an agent to edit.
        {:else}
          Say what the sketch should become. Drag in a node or a parameter for its exact path.
        {/if}
      </div>
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
      placeholder={working ? `${agent} is working…` : 'Prompt the sketch'}
      disabled={working}
    ></textarea>
    <button
      type="button"
      class="send"
      on:click={send}
      disabled={working || !prompt.trim() || !launchable}
      title="Send (⌘↵)"
      aria-label="Send prompt"
    >→</button>
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
    border-radius: 4px;
    font: inherit;
    padding: 2px 6px;
    cursor: pointer;
  }

  /* Only the send button is a square. This used to be folded into the shared
     rule above, which sized the agent picker and Reset to 30px as well — the
     picker clipped to one letter and Reset overflowed its own box. */
  .send {
    width: 30px;
    height: 30px;
    flex: none;
    font-size: 15px;
    line-height: 1;
    padding: 0;
  }

  .zoom {
    background: none;
    border: none;
    color: var(--text-secondary);
    font: inherit;
    padding: 0 4px;
    cursor: pointer;
  }

  .zoom:hover {
    color: var(--text-primary);
  }

  .bar button:hover,
  .send:hover:not(:disabled) {
    background: var(--surface-control-hover);
  }

  .send:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .running {
    color: var(--accent);
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
    /* The zoom lands on the text you read and type, and deliberately not on
       the bar: a toolbar that grew with the type size would push the
       transcript around every time you changed it, which is the opposite of
       what reading larger is for. */
    font-size: calc(12px * var(--agent-zoom, 1));
    line-height: 1.45;
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
    gap: 8px;
    align-items: flex-end;
    padding: 10px;
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
    border-radius: 4px;
    font-family: inherit;
    font-size: calc(12px * var(--agent-zoom, 1));
    line-height: 1.45;
    padding: 8px 10px;
  }

  .composer textarea:focus {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
