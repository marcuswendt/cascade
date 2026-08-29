<script lang="ts">
  import type { Prop } from '@/types/node.types';
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

  $: evaluatedDisplay = hasExpression && !expressionError ? formatEvaluatedValue(prop.value) : null;

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

  function handleContainerClick(e: MouseEvent) {
    // If we have an expression and click on the display, toggle or start editing
    if (hasExpression && viewMode === 'expression' && !isEditing) {
      const target = e.target as HTMLElement;
      // If clicking on the expression text itself, start editing
      if (target.classList.contains('expression-display') || target.closest('.expression-display')) {
        startEditExpression();
      }
    }
  }
</script>

<div
  class="expression-wrapper"
  class:has-expression={hasExpression}
  class:has-error={!!expressionError}
  class:editing={isEditing}
  on:click={handleContainerClick}
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
    background: rgba(74, 158, 255, 0.12);
    border: 1px solid rgba(74, 158, 255, 0.4);
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .expression-view:hover {
    background: rgba(74, 158, 255, 0.18);
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
    color: #6ab0ff;
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
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 10px;
    color: #aaa;
    cursor: pointer;
    white-space: nowrap;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s ease;
  }

  .evaluated-badge:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .expression-error {
    color: #ff6b6b;
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
    color: #888;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .remove-expression:hover {
    background: rgba(255, 100, 100, 0.2);
    color: #ff6b6b;
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
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(74, 158, 255, 0.6);
    border-radius: 3px;
    color: #6ab0ff;
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
  }

  .expression-input:focus {
    outline: none;
    border-color: #6ab0ff;
    box-shadow: 0 0 0 1px rgba(74, 158, 255, 0.3);
  }

  .expression-input.error {
    border-color: #ff6b6b;
    color: #ff6b6b;
  }

  /* Value view styling */
  .value-view {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    position: relative;
  }

  .value-view.expression-active {
    padding: 2px;
    background: rgba(74, 158, 255, 0.08);
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
    color: #666;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .value-view:hover .add-expression,
  .value-view:hover .toggle-to-expression {
    opacity: 1;
  }

  .add-expression:hover {
    background: rgba(74, 158, 255, 0.1);
    border-color: rgba(74, 158, 255, 0.3);
    color: #4a9eff;
  }

  .toggle-to-expression {
    opacity: 1;
    background: rgba(74, 158, 255, 0.2);
    border-color: rgba(74, 158, 255, 0.4);
    color: #4a9eff;
  }

  .toggle-to-expression:hover {
    background: rgba(74, 158, 255, 0.3);
  }

  /* Error state */
  .has-error .expression-view {
    background: rgba(255, 100, 100, 0.12);
    border-color: rgba(255, 100, 100, 0.4);
  }

  .has-error .expression-code {
    color: #ff6b6b;
  }

  /* Autocomplete dropdown */
  .autocomplete-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #252525;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
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
    color: #fff;
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: #3a3a3a;
  }

  .item-type {
    width: 14px;
    text-align: center;
    opacity: 0.6;
  }

  .type-func .item-type {
    color: #4a9eff;
  }

  .type-node .item-type {
    color: #ffa500;
  }

  .type-prop .item-type {
    color: #4aff4a;
  }

  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
