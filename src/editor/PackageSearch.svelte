<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { PackageManager, type PackageInfo } from '@/core/PackageManager';

  export let open = false;
  export let packageManager: PackageManager;

  const dispatch = createEventDispatcher();

  let searchQuery = '';
  let searchResults: PackageInfo[] = [];
  let isSearching = false;
  let searchError: string | null = null;
  let selectedIndex = -1;
  let searchInput: HTMLInputElement;

  // Popular packages for quick access
  const popularPackages = [
    { name: 'three', description: '3D graphics library' },
    { name: 'tone', description: 'Web Audio framework' },
    { name: 'd3', description: 'Data visualization' },
    { name: 'chroma-js', description: 'Color manipulation' },
    { name: 'matter-js', description: '2D physics engine' },
    { name: 'simplex-noise', description: 'Perlin noise generator' },
    { name: 'gsap', description: 'Animation library' },
    { name: 'pixi.js', description: '2D WebGL renderer' }
  ];

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  async function handleSearch() {
    if (!searchQuery.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    searchError = null;

    try {
      const results = await packageManager.search(searchQuery.trim(), 20);
      searchResults = results;
      selectedIndex = -1;
    } catch (error: any) {
      searchError = error.message || 'Search failed';
      searchResults = [];
    } finally {
      isSearching = false;
    }
  }

  // Debounced search
  $: if (searchQuery && open) {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => {
      handleSearch();
    }, 300);
  }

  function handlePackageSelect(pkg: PackageInfo | { name: string; description?: string }) {
    dispatch('select', { packageName: pkg.name });
    handleClose();
  }

  function handleClose() {
    open = false;
    searchQuery = '';
    searchResults = [];
    searchError = null;
    selectedIndex = -1;
    dispatch('close');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && searchResults[selectedIndex]) {
      e.preventDefault();
      handlePackageSelect(searchResults[selectedIndex]);
    }
  }

  // Auto-focus search input when opened
  $: if (open && searchInput) {
    setTimeout(() => {
      searchInput?.focus();
    }, 0);
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <div class="overlay" on:click={handleClose} on:click|self={handleClose}>
    <div class="dialog" on:click|stopPropagation>
      <div class="header">
        <h2>Search NPM Packages</h2>
        <button class="close-button" on:click={handleClose}>×</button>
      </div>

      <div class="search-section">
        <input
          type="text"
          class="search-input"
          bind:this={searchInput}
          bind:value={searchQuery}
          placeholder="Search packages (e.g., three, lodash, chroma-js)..."
          on:keydown={handleKeyDown}
        />
        {#if isSearching}
          <div class="loading">Searching...</div>
        {/if}
        {#if searchError}
          <div class="error">{searchError}</div>
        {/if}
      </div>

      <div class="content">
        {#if searchQuery && !isSearching}
          {#if searchResults.length > 0}
            <div class="results">
              {#each searchResults as result, index}
                <button
                  class="result-item"
                  class:selected={selectedIndex === index}
                  on:click={() => handlePackageSelect(result)}
                  on:mouseenter={() => selectedIndex = index}
                >
                  <div class="package-name">{result.name}</div>
                  {#if result.description}
                    <div class="package-description">{result.description}</div>
                  {/if}
                  <div class="package-meta">
                    <span class="version">v{result.version}</span>
                    {#if result.keywords && result.keywords.length > 0}
                      <span class="keywords">
                        {result.keywords.slice(0, 3).join(', ')}
                      </span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {:else if searchQuery && !isSearching}
            <div class="empty-state">No packages found</div>
          {/if}
        {:else if !searchQuery}
          <div class="popular-section">
            <h3>Popular Packages</h3>
            <div class="popular-list">
              {#each popularPackages as pkg}
                <button
                  class="popular-item"
                  on:click={() => handlePackageSelect(pkg)}
                >
                  <span class="name">{pkg.name}</span>
                  <span class="description">{pkg.description}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="footer">
        <div class="hint">
          Press Enter to select, Esc to close
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .dialog {
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header h2 {
    margin: 0;
    color: #fff;
    font-size: 20px;
    font-weight: 600;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .search-section {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .search-input {
    width: 100%;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    box-sizing: border-box;
  }

  .search-input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .loading {
    margin-top: 8px;
    color: #888;
    font-size: 12px;
  }

  .error {
    margin-top: 8px;
    color: #ff6b6b;
    font-size: 12px;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    min-height: 200px;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .result-item:hover,
  .result-item.selected {
    background: rgba(66, 133, 244, 0.15);
    border-color: #4a9eff;
  }

  .package-name {
    color: #fff;
    font-size: 14px;
    font-weight: 600;
  }

  .package-description {
    color: #aaa;
    font-size: 12px;
  }

  .package-meta {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }

  .version {
    color: #666;
    font-size: 11px;
  }

  .keywords {
    color: #666;
    font-size: 11px;
    font-style: italic;
  }

  .empty-state {
    text-align: center;
    color: #666;
    padding: 40px;
    font-size: 14px;
  }

  .popular-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .popular-section h3 {
    margin: 0;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
  }

  .popular-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .popular-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .popular-item:hover {
    background: rgba(66, 133, 244, 0.15);
    border-color: #4a9eff;
  }

  .popular-item .name {
    color: #4a9eff;
    font-size: 13px;
    font-weight: 600;
  }

  .popular-item .description {
    color: #aaa;
    font-size: 11px;
  }

  .footer {
    padding: 12px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .hint {
    color: #666;
    font-size: 11px;
    text-align: center;
  }
</style>



