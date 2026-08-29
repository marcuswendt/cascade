<script lang="ts">
  import type { Prop } from '@/types/node.types';

  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: any) => void;

  type Option = { value: string; label: string; group?: string; disabled?: boolean } | string;
  type GroupedOptions = { group: string; options: Option[] }[];

  let showDropdown = false;
  let searchQuery = '';
  let dropdownElement: HTMLDivElement;

  $: value = prop.value;
  $: options = (prop.params?.options || []) as Option[];
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;

  // Filter options based on search
  $: filteredOptions = searchQuery
    ? options.filter(opt => {
        const label = typeof opt === 'object' && 'label' in opt ? opt.label : String(opt);
        return label.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : options;

  // Group options by their group property, sorted alphabetically
  $: groupedOptions = (() => {
    const groups = new Map<string, Option[]>();
    const ungrouped: Option[] = [];

    for (const opt of filteredOptions) {
      if (typeof opt === 'object' && 'group' in opt && opt.group) {
        if (!groups.has(opt.group)) {
          groups.set(opt.group, []);
        }
        groups.get(opt.group)!.push(opt);
      } else {
        ungrouped.push(opt);
      }
    }

    // Sort groups alphabetically, sort options within groups
    const sortedGroups: GroupedOptions = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, opts]) => ({
        group,
        options: opts.sort((a, b) => {
          const labelA = typeof a === 'object' && 'label' in a ? a.label : String(a);
          const labelB = typeof b === 'object' && 'label' in b ? b.label : String(b);
          return labelA.localeCompare(labelB);
        })
      }));

    // Add ungrouped options at the end if any
    if (ungrouped.length > 0) {
      sortedGroups.push({ group: '', options: ungrouped });
    }

    return sortedGroups;
  })();

  $: hasGroups = groupedOptions.some(g => g.group !== '');
  
  function selectOption(option: any) {
    const optValue = typeof option === 'object' && 'value' in option ? option.value : option;
    onValueChange(optValue);
    showDropdown = false;
    searchQuery = '';
  }
  
  function handleClickOutside(e: MouseEvent) {
    if (dropdownElement && !dropdownElement.contains(e.target as Node)) {
      showDropdown = false;
      searchQuery = '';
    }
  }
  
  // Close on escape
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showDropdown = false;
      searchQuery = '';
    }
  }
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<div class="select-input-container" bind:this={dropdownElement}>
  <button
    class="select-button"
    class:open={showDropdown}
    disabled={disabled}
    on:click={() => {
      if (!disabled) {
        showDropdown = !showDropdown;
        if (showDropdown) {
          searchQuery = '';
        }
      }
    }}
  >
    <span class="select-value">
      {#each options as option}
        {@const optValue = typeof option === 'object' && 'value' in option ? option.value : option}
        {@const optLabel = typeof option === 'object' && 'label' in option ? option.label : String(option)}
        {#if String(optValue) === String(value)}
          {optLabel}
        {/if}
      {/each}
    </span>
    <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 4.5L6 7.5L9 4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  
  {#if showDropdown && options.length > 0}
    <div class="dropdown-menu">
      {#if options.length > 5}
        <div class="search-box">
          <input
            type="text"
            class="search-input"
            placeholder="Search..."
            bind:value={searchQuery}
            on:click|stopPropagation
          />
        </div>
      {/if}
      <div class="options-list">
        {#if hasGroups}
          {#each groupedOptions as { group, options: groupOpts }}
            {#if group}
              <div class="option-group-header">{group}</div>
            {/if}
            {#each groupOpts as option}
              {@const optValue = typeof option === 'object' && 'value' in option ? option.value : option}
              {@const optLabel = typeof option === 'object' && 'label' in option ? option.label : String(option)}
              {@const optDisabled = typeof option === 'object' && 'disabled' in option ? option.disabled : false}
              <button
                class="option-item"
                class:selected={String(optValue) === String(value)}
                class:grouped={!!group}
                disabled={optDisabled}
                on:click={() => selectOption(option)}
              >
                {optLabel}
              </button>
            {/each}
          {/each}
        {:else}
          {#each filteredOptions as option}
            {@const optValue = typeof option === 'object' && 'value' in option ? option.value : option}
            {@const optLabel = typeof option === 'object' && 'label' in option ? option.label : String(option)}
            {@const optDisabled = typeof option === 'object' && 'disabled' in option ? option.disabled : false}
            <button
              class="option-item"
              class:selected={String(optValue) === String(value)}
              disabled={optDisabled}
              on:click={() => selectOption(option)}
            >
              {optLabel}
            </button>
          {/each}
        {/if}
        {#if filteredOptions.length === 0}
          <div class="no-results">No results</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .select-input-container {
    position: relative;
    width: 100%;
  }
  
  .select-button {
    width: 100%;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition: all 0.15s ease;
  }
  
  .select-button:hover:not(:disabled) {
    border-color: #4a9eff;
    background: rgba(0, 0, 0, 0.4);
  }
  
  .select-button.open {
    border-color: #4a9eff;
  }
  
  .select-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .select-value {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .dropdown-icon {
    flex-shrink: 0;
    color: #aaa;
    transition: transform 0.15s ease;
  }
  
  .select-button.open .dropdown-icon {
    transform: rotate(180deg);
  }
  
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 1000;
    background: rgba(20, 20, 20, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    max-height: 200px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .search-box {
    padding: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .search-input {
    width: 100%;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    font-family: inherit;
  }
  
  .search-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .options-list {
    overflow-y: auto;
    max-height: 160px;
  }
  
  .option-item {
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .option-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  .option-item.selected {
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
  }

  .option-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .option-item.grouped {
    padding-left: 20px;
  }

  .option-group-header {
    padding: 6px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: rgba(255, 255, 255, 0.02);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .option-group-header:first-child {
    border-top: none;
  }

  .no-results {
    padding: 12px;
    text-align: center;
    color: #666;
    font-size: 11px;
  }
</style>

