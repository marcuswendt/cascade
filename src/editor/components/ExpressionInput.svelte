<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { currentFrame } from '../stores/frameStore';
  import type { Node } from '@/nodes/Node';
  import type { Graph } from '@/nodes/Graph';
  import { Sigma, AlertCircle, X } from '@lucide/svelte';
  import { onMount } from 'svelte';

  export let prop: Prop;
  export let propKey: string;
  export let node: Node;
  export let onValueChange: (value: any) => void;

  // Get graph from node for autocomplete
  $: graph = (node as any).graph as Graph | undefined;

  // Expression state
  $: hasExpression = !!prop.expression;
  $: expressionError = prop.expressionError;

  // View mode: 'value' shows the normal control, 'expression' shows the expression editor
  // When there's an expression, default to showing the expression
  let viewMode: 'value' | 'expression' = 'value';

  // Update viewMode when expression state changes
  $: if (hasExpression && viewMode === 'value' && !isEditing) {
    viewMode = 'expression';
  }
  $: if (!hasExpression && viewMode === 'expression') {
    viewMode = 'value';
  }

  let isEditing = false;
  let expressionText = prop.expression || '';
  let inputElement: HTMLInputElement;
  let showAutocomplete = false;
  let autocompleteItems: { label: string; value: string; type: 'node' | 'prop' | 'func' }[] = [];
  let selectedIndex = 0;
  let cursorPosition = 0;

  // Sync expression text when prop changes
  $: if (prop.expression !== undefined) {
    expressionText = prop.expression || '';
  }

  // Format evaluated value for display
  function formatEvaluatedValue(value: any): string {
    if (value === undefined || value === null) return '—';
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(4).replace(/\.?0+$/, '');
    }
    if (Array.isArray(value)) {
      const formatted = value.map(v =>
        typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v
      );
      return `[${formatted.join(', ')}]`;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'string') {
      return value.length > 30 ? value.slice(0, 27) + '...' : value;
    }
    if (typeof value === 'object' && value !== null) {
      // Handle color objects
      if ('r' in value && 'g' in value && 'b' in value) {
        return `rgb(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)})`;
      }
      return JSON.stringify(value).slice(0, 30);
    }
    return String(value);
  }

  /**
   * What the expression currently comes to.
   *
   * Asked of the node rather than read from `prop.value`, because for a prop
   * that backs a `param()` declaration `value` is the RAW value the author
   * typed — the resolved one is what `evalParm` returns, and pushing it into
   * `value` would overwrite what the document records.
   */
  function resolvedValue(_prop: Prop, key: string, _frame?: number): any {
    try {
      const resolved = node?.evalParm?.(key);
      return resolved === undefined ? _prop.value : resolved;
    } catch {
      return _prop.value;
    }
  }

  // `$currentFrame` is in here as a dependency, not as an argument: the badge
  // shows a value that depends on time, so it has to recompute when the frame
  // moves. Without it the statement's dependencies were prop and propKey alone,
  // so `$T * 0.5` showed the value it had at frame 1 — zero — for every
  // position of the playhead.
  $: evaluatedDisplay = hasExpression && !expressionError
    ? formatEvaluatedValue(resolvedValue(prop, propKey, $currentFrame))
    : null;

  // Expression functions for autocomplete
  const expressionFunctions = [
    { label: 'ch(path)', value: 'ch("")', type: 'func' as const, desc: 'Get parameter as number' },
    { label: 'chs(path)', value: 'chs("")', type: 'func' as const, desc: 'Get parameter as string' },
    { label: 'chv(path)', value: 'chv("")', type: 'func' as const, desc: 'Get parameter as vector' },
    { label: 'time', value: 'time', type: 'func' as const, desc: 'Current time in seconds' },
    { label: 'frame', value: 'frame', type: 'func' as const, desc: 'Current frame number' },
    { label: 'fps', value: 'fps', type: 'func' as const, desc: 'Frames per second' },
    { label: 'fit(v, oMin, oMax, nMin, nMax)', value: 'fit(, 0, 1, 0, 100)', type: 'func' as const, desc: 'Remap value range' },
    { label: 'clamp(v, min, max)', value: 'clamp(, 0, 1)', type: 'func' as const, desc: 'Clamp value' },
    { label: 'lerp(a, b, t)', value: 'lerp(0, 1, )', type: 'func' as const, desc: 'Linear interpolation' },
    { label: 'noise(x)', value: 'noise()', type: 'func' as const, desc: 'Perlin noise (-1 to 1)' },
    { label: 'random(seed)', value: 'random()', type: 'func' as const, desc: 'Deterministic random (0-1)' },
    { label: 'true', value: 'true', type: 'func' as const, desc: 'Boolean true' },
    { label: 'false', value: 'false', type: 'func' as const, desc: 'Boolean false' },
    { label: 'Math.sin(x)', value: 'Math.sin()', type: 'func' as const, desc: 'Sine function' },
    { label: 'Math.cos(x)', value: 'Math.cos()', type: 'func' as const, desc: 'Cosine function' },
    { label: 'Math.abs(x)', value: 'Math.abs()', type: 'func' as const, desc: 'Absolute value' },
  ];

  // Toggle between expression and value view
  function toggleView() {
    if (!hasExpression) return;
    viewMode = viewMode === 'expression' ? 'value' : 'expression';
  }

  // Start adding an expression
  function startAddExpression(e: MouseEvent) {
    e.stopPropagation();
    isEditing = true;
    viewMode = 'expression';
    // Initialize with current value as string
    expressionText = formatInitialExpression(prop.value);
    setTimeout(() => {
      inputElement?.focus();
      inputElement?.select();
    }, 0);
  }

  function formatInitialExpression(value: any): string {
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `[${value.join(', ')}]`;
    if (typeof value === 'object' && value !== null) {
      if ('r' in value && 'g' in value && 'b' in value) {
        return `{ r: ${value.r}, g: ${value.g}, b: ${value.b}${value.a !== undefined ? `, a: ${value.a}` : ''} }`;
      }
    }
    return String(value ?? '');
  }

  // Start editing existing expression
  function startEditExpression() {
    isEditing = true;
    expressionText = prop.expression || '';
    setTimeout(() => {
      inputElement?.focus();
    }, 0);
  }

  // Remove expression
  function removeExpression(e: MouseEvent) {
    e.stopPropagation();
    const parm = node.parm(propKey);
    if (parm) {
      parm.deleteExpression();
      node.markDirty();
      // Same reason as applyExpression: the model forgets the expression and
      // the panel has to be told, or the removal is invisible.
      onValueChange?.(prop.value);
    }
    isEditing = false;
    viewMode = 'value';
  }

  function handleExpressionInput(e: Event) {
    const input = e.target as HTMLInputElement;
    expressionText = input.value;
    cursorPosition = input.selectionStart || 0;
    updateAutocomplete();
  }

  function updateAutocomplete() {
    if (!graph) {
      showAutocomplete = false;
      return;
    }

    const textBeforeCursor = expressionText.slice(0, cursorPosition);
    const pathMatch = textBeforeCursor.match(/ch[sv]?\s*\(\s*['"]([^'"]*?)$/);

    if (pathMatch) {
      const partialPath = pathMatch[1];
      autocompleteItems = getPathSuggestions(partialPath);
      showAutocomplete = autocompleteItems.length > 0;
      selectedIndex = 0;
    } else {
      const wordMatch = textBeforeCursor.match(/(?:^|[\s(,+\-*/%])(\w*)$/);
      if (wordMatch && wordMatch[1].length > 0) {
        const partial = wordMatch[1].toLowerCase();
        autocompleteItems = expressionFunctions
          .filter(f => f.label.toLowerCase().startsWith(partial) || f.value.toLowerCase().startsWith(partial))
          .map(f => ({ label: f.label, value: f.value, type: f.type }));
        showAutocomplete = autocompleteItems.length > 0;
        selectedIndex = 0;
      } else {
        showAutocomplete = false;
      }
    }
  }

  function getPathSuggestions(partialPath: string): { label: string; value: string; type: 'node' | 'prop' }[] {
    if (!graph) return [];
    const suggestions: { label: string; value: string; type: 'node' | 'prop' }[] = [];

    const isAbsolute = partialPath.startsWith('/');

    let searchNodes: Node[] = [];
    let pathPrefix = '';

    if (isAbsolute) {
      searchNodes = graph.nodes.filter(n => !n.parent);
      pathPrefix = '/';
    } else if (partialPath.startsWith('../')) {
      if (node.parent) {
        searchNodes = node.parent.children().filter(n => n !== node);
        pathPrefix = '../';
      }
    } else if (partialPath.startsWith('./')) {
      const propPartial = partialPath.slice(2).toLowerCase();
      Object.keys(node.props).forEach(propName => {
        if (propName.toLowerCase().startsWith(propPartial)) {
          suggestions.push({
            label: `./${propName}`,
            value: `./${propName}`,
            type: 'prop'
          });
        }
      });
      return suggestions;
    } else {
      if (node.parent) {
        searchNodes = node.parent.children().filter(n => n !== node);
        pathPrefix = '../';
      } else {
        searchNodes = graph.nodes.filter(n => !n.parent && n !== node);
        pathPrefix = '/';
      }
    }

    const pathAfterPrefix = isAbsolute ? partialPath.slice(1) :
                           partialPath.startsWith('../') ? partialPath.slice(3) :
                           partialPath;
    const segments = pathAfterPrefix.split('/');
    const currentSegment = segments[segments.length - 1].toLowerCase();

    let currentNodes = searchNodes;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const found = currentNodes.find(n => n.id === seg);
      if (found && found.isNetwork()) {
        currentNodes = found.children();
        pathPrefix += seg + '/';
      } else {
        return suggestions;
      }
    }

    currentNodes.forEach(n => {
      if (n.id.toLowerCase().startsWith(currentSegment)) {
        suggestions.push({
          label: `${pathPrefix}${n.id}`,
          value: `${pathPrefix}${n.id}`,
          type: 'node'
        });

        Object.keys(n.props).forEach(propName => {
          suggestions.push({
            label: `${pathPrefix}${n.id}/${propName}`,
            value: `${pathPrefix}${n.id}/${propName}`,
            type: 'prop'
          });
        });
      }
    });

    return suggestions.slice(0, 10);
  }

  function selectAutocompleteItem(item: typeof autocompleteItems[0]) {
    const textBeforeCursor = expressionText.slice(0, cursorPosition);
    const textAfterCursor = expressionText.slice(cursorPosition);
    const pathMatch = textBeforeCursor.match(/ch[sv]?\s*\(\s*['"]([^'"]*?)$/);

    if (pathMatch) {
      const beforePath = textBeforeCursor.slice(0, textBeforeCursor.length - pathMatch[1].length);
      expressionText = beforePath + item.value + textAfterCursor;
    } else {
      const wordMatch = textBeforeCursor.match(/(?:^|[\s(,+\-*/%])(\w*)$/);
      if (wordMatch) {
        const beforeWord = textBeforeCursor.slice(0, textBeforeCursor.length - wordMatch[1].length);
        expressionText = beforeWord + item.value + textAfterCursor;
      }
    }

    showAutocomplete = false;
    inputElement?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % autocompleteItems.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + autocompleteItems.length) % autocompleteItems.length;
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (autocompleteItems.length > 0) {
          e.preventDefault();
          selectAutocompleteItem(autocompleteItems[selectedIndex]);
          return;
        }
      } else if (e.key === 'Escape') {
        showAutocomplete = false;
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !showAutocomplete) {
      e.preventDefault();
      applyExpression();
    } else if (e.key === 'Escape' && !showAutocomplete) {
      cancelExpression();
    }
  }

  function applyExpression() {
    showAutocomplete = false;
    if (expressionText.trim()) {
      const parm = node.parm(propKey);
      if (parm) {
        parm.setExpression(expressionText);
        node.markDirty();
        // Tell the Inspector. Setting an expression mutates node.props in
        // place, which Svelte cannot see, so without this the panel kept
        // rendering the old state and the expression looked like it had not
        // been applied at all. `onValueChange` was declared and never called —
        // svelte-check had been reporting it as an unused export the whole
        // time, which is the kind of warning that turns out to be a bug.
        onValueChange?.(node.evalParm(propKey));
      }
    }
    isEditing = false;
  }

  function cancelExpression() {
    showAutocomplete = false;
    expressionText = prop.expression || '';
    isEditing = false;
    if (!hasExpression) {
      viewMode = 'value';
    }
  }

  function handleBlur() {
    setTimeout(() => {
      if (!showAutocomplete) {
        if (expressionText.trim()) {
          applyExpression();
        } else {
          cancelExpression();
        }
      }
    }, 150);
  }

</script>

<div
  class="expression-wrapper"
  class:has-expression={hasExpression}
  class:has-error={!!expressionError}
  class:editing={isEditing}
>
  {#if viewMode === 'expression' && hasExpression}
    <!-- Expression view: shows expression code -->
    <div class="expression-view">
      {#if isEditing}
        <div class="expression-input-container">
          <input
            type="text"
            class="expression-input"
            class:error={!!expressionError}
            bind:this={inputElement}
            bind:value={expressionText}
            on:input={handleExpressionInput}
            on:keydown={handleKeydown}
            on:blur={handleBlur}
            placeholder="e.g., ch('../node/value') * 2"
          />

          {#if showAutocomplete && autocompleteItems.length > 0}
            <div class="autocomplete-dropdown">
              {#each autocompleteItems as item, i}
                <button
                  class="autocomplete-item"
                  class:selected={i === selectedIndex}
                  class:type-node={item.type === 'node'}
                  class:type-prop={item.type === 'prop'}
                  class:type-func={item.type === 'func'}
                  on:mousedown|preventDefault={() => selectAutocompleteItem(item)}
                  on:mouseenter={() => selectedIndex = i}
                >
                  <span class="item-type">{item.type === 'func' ? 'ƒ' : item.type === 'node' ? '□' : '•'}</span>
                  <span class="item-label">{item.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button class="expression-display" on:click={startEditExpression} title="Click to edit expression">
          <span class="expression-code">{prop.expression}</span>
        </button>
      {/if}

      <div class="expression-actions">
        {#if expressionError}
          <span class="expression-error" title={expressionError}>
            <AlertCircle size={12} />
          </span>
        {:else if evaluatedDisplay !== null}
          <button
            class="evaluated-badge"
            on:click|stopPropagation={toggleView}
            title="Click to see value: {evaluatedDisplay}"
          >
            = {evaluatedDisplay}
          </button>
        {/if}

        <button
          class="remove-expression"
          on:click={removeExpression}
          title="Remove expression"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  {:else}
    <!-- Value view: shows normal control -->
    <div class="value-view" class:expression-active={hasExpression}>
      <slot />

      {#if hasExpression}
        <button
          class="toggle-to-expression"
          on:click|stopPropagation={toggleView}
          title="Click to see expression"
        >
          <Sigma size={10} />
        </button>
      {:else}
        <button
          class="add-expression"
          on:click={startAddExpression}
          title="Add expression"
        >
          <Sigma size={10} />
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .expression-wrapper {
    width: 100%;
    position: relative;
  }

  /* Expression view styling */
  .expression-view {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    background: var(--accent-tint-weak);
    border: 1px solid var(--accent-tint-stronger);
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .expression-view:hover {
    background: var(--accent-tint);
  }

  .expression-display {
    flex: 1;
    display: flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    cursor: text;
    min-width: 0;
  }

  .expression-code {
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    color: var(--accent-hover);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expression-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .evaluated-badge {
    padding: 2px 6px;
    background: var(--shade-weak);
    border: 1px solid var(--tint);
    border-radius: 3px;
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 10px;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s ease;
  }

  .evaluated-badge:hover {
    background: var(--tint);
    color: var(--text-bright);
  }

  .expression-error {
    color: var(--status-error);
    display: flex;
    align-items: center;
    cursor: help;
  }

  .remove-expression {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--text-subtle);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .remove-expression:hover {
    background: var(--status-error-tint);
    color: var(--status-error);
  }

  /* Expression input container */
  .expression-input-container {
    flex: 1;
    position: relative;
    min-width: 0;
  }

  .expression-input {
    width: 100%;
    padding: 2px 4px;
    background: var(--shade-weak);
    border: 1px solid var(--accent-tint-heavy);
    border-radius: 3px;
    color: var(--accent-hover);
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
  }

  .expression-input:focus {
    outline: none;
    border-color: var(--accent-hover);
    box-shadow: 0 0 0 1px var(--accent-tint-strong);
  }

  .expression-input.error {
    border-color: var(--status-error);
    color: var(--status-error);
  }

  /* Value view styling */
  .value-view {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    position: relative;
  }

  /* The control keeps the row; the sigma is a 10px afterthought beside it.
     Without this a slotted block control collapses to its content width. */
  .value-view > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }

  .value-view.expression-active {
    padding: 2px;
    background: var(--accent-tint-weakest);
    border-radius: 4px;
  }

  .value-view > :global(*:first-child) {
    flex: 1;
    min-width: 0;
  }

  .add-expression,
  .toggle-to-expression {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-faintest);
    cursor: pointer;
    /* Visible at rest rather than hover-only. It was opacity 0 until you
       happened to hover the row, so the only way to discover that a parameter
       could hold an expression was to already know. Faint enough not to
       compete with the value, present enough to aim at. */
    opacity: 0.4;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .value-view:hover .add-expression,
  .value-view:hover .toggle-to-expression {
    opacity: 1;
  }

  .add-expression:hover {
    background: var(--accent-tint-weak);
    border-color: var(--accent-tint-strong);
    color: var(--accent);
  }

  .toggle-to-expression {
    opacity: 1;
    background: var(--accent-tint-medium);
    border-color: var(--accent-tint-stronger);
    color: var(--accent);
  }

  .toggle-to-expression:hover {
    background: var(--accent-tint-strong);
  }

  /* Error state */
  .has-error .expression-view {
    background: var(--status-error-tint-weak);
    border-color: var(--status-error-tint-strong);
  }

  .has-error .expression-code {
    color: var(--status-error);
  }

  /* Autocomplete dropdown */
  .autocomplete-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: var(--surface-raised);
    border: 1px solid var(--border-raised);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--shadow-soft);
    max-height: 200px;
    overflow-y: auto;
    z-index: 1000;
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    color: var(--text-bright);
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--surface-hover);
  }

  .item-type {
    width: 14px;
    text-align: center;
    opacity: 0.6;
  }

  .type-func .item-type {
    color: var(--accent);
  }

  .type-node .item-type {
    color: var(--status-warn-bright);
  }

  .type-prop .item-type {
    color: var(--status-ok-bright);
  }

  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
