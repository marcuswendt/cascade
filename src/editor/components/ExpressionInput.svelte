<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import type { Node } from '@/nodes/Node';
  import type { Graph } from '@/nodes/Graph';
  import { Sigma, AlertCircle, CircleEqual } from 'lucide-svelte';
  import { createEventDispatcher, onMount } from 'svelte';

  export let prop: Prop;
  export let propKey: string;
  export let node: Node;
  export let onValueChange: (value: any) => void;

  // Get graph from node for autocomplete
  $: graph = (node as any).graph as Graph | undefined;

  // Expression mode state
  $: hasExpression = !!prop.expression;
  $: expressionError = prop.expressionError;

  let editingExpression = false;
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
      // Format numbers nicely (max 4 decimal places)
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(4).replace(/\.?0+$/, '');
    }
    if (Array.isArray(value)) {
      // Format arrays compactly
      const formatted = value.map(v =>
        typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v
      );
      return `[${formatted.join(', ')}]`;
    }
    if (typeof value === 'string') {
      return value.length > 20 ? value.slice(0, 17) + '...' : value;
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
    { label: 'Math.sin(x)', value: 'Math.sin()', type: 'func' as const, desc: 'Sine function' },
    { label: 'Math.cos(x)', value: 'Math.cos()', type: 'func' as const, desc: 'Cosine function' },
    { label: 'Math.abs(x)', value: 'Math.abs()', type: 'func' as const, desc: 'Absolute value' },
  ];

  function toggleExpressionMode() {
    if (hasExpression) {
      const parm = node.parm(propKey);
      if (parm) {
        parm.deleteExpression();
        node.markDirty();
      }
    } else {
      editingExpression = true;
      expressionText = String(prop.value);
      // Focus input after render
      setTimeout(() => inputElement?.focus(), 0);
    }
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

    // Get text before cursor
    const textBeforeCursor = expressionText.slice(0, cursorPosition);

    // Check if we're inside a ch/chs/chv path string
    const pathMatch = textBeforeCursor.match(/ch[sv]?\s*\(\s*['"]([^'"]*?)$/);

    if (pathMatch) {
      // Path autocomplete mode
      const partialPath = pathMatch[1];
      autocompleteItems = getPathSuggestions(partialPath);
      showAutocomplete = autocompleteItems.length > 0;
      selectedIndex = 0;
    } else {
      // Check if at start of expression or after operator
      const wordMatch = textBeforeCursor.match(/(?:^|[\s(,+\-*/%])(\w*)$/);
      if (wordMatch && wordMatch[1].length > 0) {
        const partial = wordMatch[1].toLowerCase();
        autocompleteItems = expressionFunctions
          .filter(f => f.label.toLowerCase().startsWith(partial))
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

    // Determine context: absolute or relative
    const isAbsolute = partialPath.startsWith('/');
    const isRelative = partialPath.startsWith('.') || partialPath.startsWith('..');

    // Get nodes to search from
    let searchNodes: Node[] = [];
    let pathPrefix = '';

    if (isAbsolute) {
      // Absolute path - search from root
      searchNodes = graph.nodes.filter(n => !n.parent);
      pathPrefix = '/';
    } else if (partialPath.startsWith('../')) {
      // Parent relative - go up and search siblings
      if (node.parent) {
        searchNodes = node.parent.children().filter(n => n !== node);
        pathPrefix = '../';
      }
    } else if (partialPath.startsWith('./')) {
      // Self relative - search own props
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
      // No prefix - search siblings and suggest prefixes
      if (node.parent) {
        searchNodes = node.parent.children().filter(n => n !== node);
        pathPrefix = '../';
      } else {
        searchNodes = graph.nodes.filter(n => !n.parent && n !== node);
        pathPrefix = '/';
      }
    }

    // Get partial path segment after prefix
    const pathAfterPrefix = isAbsolute ? partialPath.slice(1) :
                           partialPath.startsWith('../') ? partialPath.slice(3) :
                           partialPath;
    const segments = pathAfterPrefix.split('/');
    const currentSegment = segments[segments.length - 1].toLowerCase();

    // Navigate to correct level
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

    // Add matching nodes
    currentNodes.forEach(n => {
      if (n.id.toLowerCase().startsWith(currentSegment)) {
        suggestions.push({
          label: `${pathPrefix}${n.id}`,
          value: `${pathPrefix}${n.id}`,
          type: 'node'
        });

        // Also suggest props on this node
        Object.keys(n.props).forEach(propName => {
          suggestions.push({
            label: `${pathPrefix}${n.id}/${propName}`,
            value: `${pathPrefix}${n.id}/${propName}`,
            type: 'prop'
          });
        });
      }
    });

    return suggestions.slice(0, 10); // Limit results
  }

  function selectAutocompleteItem(item: typeof autocompleteItems[0]) {
    const textBeforeCursor = expressionText.slice(0, cursorPosition);
    const textAfterCursor = expressionText.slice(cursorPosition);

    // Check if we're in path mode
    const pathMatch = textBeforeCursor.match(/ch[sv]?\s*\(\s*['"]([^'"]*?)$/);

    if (pathMatch) {
      // Replace the partial path
      const beforePath = textBeforeCursor.slice(0, textBeforeCursor.length - pathMatch[1].length);
      expressionText = beforePath + item.value + textAfterCursor;
    } else {
      // Replace word/function
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
    editingExpression = false;
  }

  function cancelExpression() {
    showAutocomplete = false;
    expressionText = prop.expression || '';
    editingExpression = false;
  }

  function handleBlur() {
    // Delay to allow autocomplete click to register
    setTimeout(() => {
      if (!showAutocomplete) {
        applyExpression();
      }
    }, 150);
  }
</script>

<div class="expression-wrapper" class:has-expression={hasExpression} class:has-error={!!expressionError}>
  <button
    class="expression-toggle"
    class:active={hasExpression}
    on:click={toggleExpressionMode}
    title={hasExpression ? 'Remove expression' : 'Add expression'}
  >
    <Sigma size={12} />
  </button>

  {#if hasExpression || editingExpression}
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
        placeholder="e.g., ch('../timer1/value') * 2"
      />
      {#if expressionError}
        <div class="expression-error" title={expressionError}>
          <AlertCircle size={12} />
        </div>
      {:else if evaluatedDisplay !== null}
        <div class="expression-value" title="Evaluated value: {evaluatedDisplay}">
          <CircleEqual size={10} />
          <span class="value-text">{evaluatedDisplay}</span>
        </div>
      {/if}

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
    <div class="value-input-container">
      <slot />
    </div>
  {/if}
</div>

<style>
  .expression-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }

  .expression-toggle {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 3px;
    color: var(--text-secondary, #888);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .expression-toggle:hover {
    background: var(--bg-hover, #3a3a3a);
    color: var(--text-primary, #fff);
  }

  .expression-toggle.active {
    background: var(--accent-color, #4a9eff);
    border-color: var(--accent-color, #4a9eff);
    color: white;
  }

  .expression-input-container {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;
  }

  .expression-input {
    flex: 1;
    padding: 4px 8px;
    background: var(--bg-input, #1a1a1a);
    border: 1px solid var(--accent-color, #4a9eff);
    border-radius: 3px;
    color: var(--accent-color, #4a9eff);
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
  }

  .expression-input:focus {
    outline: none;
    border-color: var(--accent-color-bright, #6ab0ff);
    box-shadow: 0 0 0 1px var(--accent-color, #4a9eff);
  }

  .expression-input.error {
    border-color: var(--error-color, #ff4a4a);
    color: var(--error-color, #ff4a4a);
  }

  .expression-error {
    color: var(--error-color, #ff4a4a);
    cursor: help;
  }

  .expression-value {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    background: var(--bg-panel, #252525);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 3px;
    color: var(--text-secondary, #888);
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 10px;
    white-space: nowrap;
    max-width: 100px;
    overflow: hidden;
  }

  .expression-value .value-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .value-input-container {
    flex: 1;
    min-width: 0;
  }

  .has-expression .value-input-container {
    display: none;
  }

  .has-error .expression-toggle.active {
    background: var(--error-color, #ff4a4a);
    border-color: var(--error-color, #ff4a4a);
  }

  /* Autocomplete dropdown */
  .autocomplete-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 2px;
    background: var(--bg-panel, #252525);
    border: 1px solid var(--border-color, #3a3a3a);
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
    color: var(--text-primary, #fff);
    font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--bg-hover, #3a3a3a);
  }

  .item-type {
    width: 14px;
    text-align: center;
    opacity: 0.6;
  }

  .type-func .item-type {
    color: var(--accent-color, #4a9eff);
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
