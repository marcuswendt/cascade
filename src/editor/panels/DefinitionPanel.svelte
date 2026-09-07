<!--
  The Definition panel — where the selected node comes from.

  The Parameters panel answers "what is this node set to". This answers the
  question that used to require reading the source: which module supplies this
  node, which file that is on disk, which node format it is written in, and
  where its work happens. Those four together explain most of the behaviour
  that otherwise looks arbitrary — a Python-backed node classified `browser`
  and never given the server it needs, or a deliberately-written definition-v1
  node that simply never cooks in Studio.

  Nothing here is inferred. A fact that could not be read is shown as unknown
  with the reason, because a plausible-looking wrong answer in this panel is
  worse than a gap.
-->
<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import { sharedContextStore, panelLockStore } from '../dockview/renderer';
  import { runsOnByModule, iconByModule, loadExecutionLocus } from '../stores/executionLocus';
  import { readDefinitionFacts, type DefinitionFacts, type DeclaredPort } from './nodeDefinitionFacts';
  import { onMount } from 'svelte';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;

  // The node to actually display (locked or selected), same contract as the
  // Parameters and Node Info panels.
  $: lockState = $panelLockStore.get(panelId);
  $: isLocked = lockState?.isLocked ?? false;
  $: displayNode = isLocked ? lockState?.lockedNode : selectedNode;

  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
  }

  onMount(() => { void loadExecutionLocus(); });

  let facts: DefinitionFacts | null = null;
  let loading = false;
  /** Guards against an earlier read landing after a later one. */
  let readToken = 0;

  async function refresh(node: Node | null | undefined) {
    const token = ++readToken;
    if (!node) {
      facts = null;
      loading = false;
      return;
    }
    loading = true;
    const result = await readDefinitionFacts(node, $runsOnByModule, $iconByModule);
    if (token !== readToken) return;
    facts = result;
    loading = false;
  }

  $: void refresh(displayNode);

  $: {
    if (panelApi?.setTitle) {
      const lockPrefix = isLocked ? '~ ' : '';
      panelApi.setTitle(displayNode ? `${lockPrefix}Definition: ${displayNode.id}` : `${lockPrefix}Definition`);
    }
  }

  const FLAVOUR_LABELS: Record<string, string> = {
    'definition-v1': 'definition-v1',
    'legacy-dynamic': 'dynamic',
    'core-class': 'core class',
    unknown: 'Unknown',
  };

  const RUNS_ON_LABELS: Record<string, string> = {
    portable: 'portable — either side',
    server: 'server',
    browser: 'browser',
  };

  function formatDefault(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return `"${value}"`;
    if (Array.isArray(value)) return `[${value.join(', ')}]`;
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function portTypeLabel(port: DeclaredPort): string {
    if (port.kind === 'trigger') return 'trigger';
    return port.type ?? 'unknown';
  }

  /** Read-only until the graph side is complete. See the comment below. */
  const RETARGET_PENDING = 'Not wired up yet. Graph.retargetDefinition can carry parameters across a swap, but nothing enumerates the versions to retarget to, and there is no parameter-preserving duplicate.';
</script>

<div class="definition-panel">
  {#if !displayNode}
    <div class="empty-state">
      <p>Select a node to see where it is defined</p>
    </div>
  {:else if loading && !facts}
    <div class="empty-state">
      <p>Reading the module…</p>
    </div>
  {:else if facts}
    <div class="info-sections">
      <section class="info-section">
        <h3>Module</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Node</span>
            <span class="value mono">{displayNode.id}</span>
          </div>
          <div class="info-row">
            <span class="label">Module id</span>
            <span class="value mono wrap">{facts.moduleId}</span>
          </div>
          <div class="info-row">
            <span class="label">Defined in</span>
            <span class="value">
              {facts.originLabel}{#if facts.libraryId}<span class="dim"> · {facts.libraryId}</span>{/if}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Path</span>
            {#if facts.path}
              <span class="value mono wrap">{facts.path}</span>
            {:else}
              <span class="value unknown">unknown</span>
            {/if}
          </div>
          {#if !facts.path && facts.pathNote}
            <p class="note">{facts.pathNote}</p>
          {/if}
        </div>
      </section>

      <section class="info-section">
        <h3>Format</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Flavour</span>
            <span class="value" class:unknown={facts.flavour === 'unknown'}>
              {FLAVOUR_LABELS[facts.flavour] ?? facts.flavour}
            </span>
          </div>
          {#if facts.definition && (facts.definition as any).apiVersion !== undefined}
            <div class="info-row">
              <span class="label">API version</span>
              <span class="value">{(facts.definition as any).apiVersion}</span>
            </div>
          {/if}
          <div class="info-row">
            <span class="label">execute() export</span>
            {#if facts.hasLegacyExecute === null}
              <span class="value unknown">unknown</span>
            {:else}
              <span class="value">{facts.hasLegacyExecute ? 'yes' : 'no'}</span>
            {/if}
          </div>
          <div class="info-row">
            <span class="label">Runs on</span>
            {#if facts.runsOn}
              <span class="value highlight">{RUNS_ON_LABELS[facts.runsOn] ?? facts.runsOn}</span>
            {:else}
              <span class="value unknown">unknown</span>
            {/if}
          </div>
          <div class="info-row">
            <span class="label">Declared icon</span>
            {#if facts.icon}
              <span class="value mono">{facts.icon}</span>
            {:else}
              <span class="value dim">none</span>
            {/if}
          </div>
          {#if facts.definition && (facts.definition as any).label}
            <div class="info-row">
              <span class="label">Declared label</span>
              <span class="value">{(facts.definition as any).label}</span>
            </div>
          {/if}
        </div>
        {#if facts.flavourNote}<p class="note">{facts.flavourNote}</p>{/if}
        {#if facts.runsOnNote && !facts.runsOn}<p class="note">{facts.runsOnNote}</p>{/if}
        {#if facts.iconNote && !facts.icon}<p class="note">{facts.iconNote}</p>{/if}
      </section>

      {#if facts.error}
        <section class="info-section">
          <h3>Read failed</h3>
          <p class="failure mono">{facts.error}</p>
        </section>
      {/if}

      {#each facts.warnings as warning}
        <p class="warning">{warning}</p>
      {/each}

      {#if facts.definition}
        {#each [
          { title: 'Declared inputs', ports: facts.inputs, showDefault: true },
          { title: 'Declared outputs', ports: facts.outputs, showDefault: false },
          { title: 'Declared props', ports: facts.props, showDefault: true },
        ] as block}
          {#if block.ports.length}
            <section class="info-section">
              <h3>{block.title}</h3>
              <div class="port-list">
                {#each block.ports as port}
                  <div class="port">
                    <span class="port-name mono">{port.name}</span>
                    <span class="port-type mono">{portTypeLabel(port)}</span>
                    {#if block.showDefault && port.default !== undefined}
                      <span class="port-default mono">= {formatDefault(port.default)}</span>
                    {/if}
                    {#if port.description}
                      <p class="port-description">{port.description}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        {/each}
      {:else if facts.flavour === 'legacy-dynamic'}
        <p class="note standalone">A dynamic module declares nothing up front — its ports appear only once it has cooked, so what it takes and returns is in the Parameters panel rather than here. It is also the style that runs everywhere today: definition-v1 gives you a statically readable declaration, which is where Cascade is heading, but Studio cannot cook one yet.</p>
      {/if}

      <!--
        Placeholders, not features. The other half of Marcus's ask — duplicate a
        node, or point it at a different version while keeping its parameter
        values — is graph surgery, and it belongs with whoever owns Graph.ts.

        Half of it has now landed there. What this panel will call:

          graph.retargetDefinition(nodeId, modulePath, source, code?, {
            parameters: parameterDeclarations(facts),
          }): RetargetResult

        Its own note says the synchronous path needs the incoming definition's
        declarations and that "a Definition panel has them" — nodeDefinitionFacts
        exports `parameterDeclarations(facts)` for exactly that, so wiring the
        button is a call plus a report to render. `RetargetResult` carries
        kept / defaulted / dropped / retyped, and `dropped` keeps the value it
        held, which is what should be shown before the swap is accepted.

        Still missing, and both belong to the graph side:

          duplicateNode(nodeId): string | null
            A copy beside the original — same module, same parameter values and
            expressions, no connections — returning the new id so this panel can
            select it.

          availableVersions(moduleId): Array<{ modulePath, label, source }>
            The list to retarget *to*. Nothing enumerates this today: /api/nodes
            returns one module per folder with no version axis at all, so
            versioning is a design decision rather than a lookup, and a picker
            built on a guessed convention would be worse than none.
      -->
      <section class="info-section">
        <h3>Actions</h3>
        <div class="actions">
          <button class="action-btn" disabled title={RETARGET_PENDING}>Duplicate node</button>
          <button class="action-btn" disabled title={RETARGET_PENDING}>Retarget…</button>
        </div>
        <p class="note">{RETARGET_PENDING}</p>
      </section>
    </div>
  {/if}
</div>

<style>
  .definition-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: var(--surface-void);
    color: var(--text-primary);
    font-size: 12px;
  }

  .info-sections {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .info-section {
    background: var(--surface-void);
    border-radius: 6px;
    padding: 12px;
  }

  .info-section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-subtle);
    margin: 0 0 10px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-faint);
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  .label {
    color: var(--text-faint);
    font-size: 11px;
    flex: 0 0 auto;
  }

  .value {
    color: var(--text-secondary);
    text-align: right;
  }

  .value.mono {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
  }

  .value.wrap {
    word-break: break-all;
    text-align: right;
  }

  .value.highlight {
    color: var(--accent-lighter);
    font-weight: 500;
  }

  .value.unknown {
    color: var(--text-disabled);
    font-style: italic;
  }

  .value.dim,
  .dim {
    color: var(--text-faint);
  }

  .note {
    margin: 8px 0 0 0;
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.45;
  }

  .note.standalone {
    margin: 0 12px;
  }

  .failure {
    margin: 0;
    color: var(--status-error);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .warning {
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--status-warn-tint);
    border: 1px solid var(--status-warn-tint-strong);
    color: var(--status-warn-soft);
    font-size: 11px;
    line-height: 1.45;
  }

  .port-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .port {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }

  .port-name {
    color: var(--text-secondary);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
  }

  .port-type {
    color: var(--accent-light);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--accent-tint-weak);
  }

  .port-default {
    color: var(--text-faint);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 10px;
  }

  .port-description {
    flex: 1 0 100%;
    margin: 0;
    color: var(--text-faint);
    font-size: 10px;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    background: var(--surface-control);
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    color: var(--text-subtle);
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
  }

  .action-btn:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-disabled);
  }

  .empty-state p {
    margin: 0;
    font-size: 13px;
    padding: 0 16px;
    text-align: center;
  }
</style>
