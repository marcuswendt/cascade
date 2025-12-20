<script lang="ts">
	/**
	 * GenerationHistoryPanel - Global history panel for all generations
	 *
	 * Shows a scrollable list of all recent generations across all nodes.
	 * Allows browsing, filtering, and reusing previous generations.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { GenerationManager } from '@/services/genai/GenerationManager';
	import type { HistoryEntry } from '@/services/genai/types';
	import GenerationGrid from './GenerationGrid.svelte';
	import Icon from '../../Icon.svelte';

	export let onSelectNode: ((nodeId: string) => void) | null = null;
	export let onSelectResult: ((entry: HistoryEntry, resultIndex: number) => void) | null = null;
	export let onClose: (() => void) | null = null;

	let history: HistoryEntry[] = [];
	let filter: 'all' | 'generate' | 'edit' | 'describe' | 'enhance' = 'all';
	let searchQuery = '';

	onMount(() => {
		// Subscribe to history updates
		const unsubscribe = GenerationManager.subscribeToHistory((entries: HistoryEntry[]) => {
			history = entries;
		});

		// Get initial history
		history = GenerationManager.getHistory();

		return unsubscribe;
	});

	$: filteredHistory = history.filter((entry) => {
		// Filter by type
		if (filter !== 'all' && entry.nodeType !== filter) {
			return false;
		}

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			return (
				entry.nodeName.toLowerCase().includes(query) ||
				entry.batch.results.some((r) => r.prompt?.toLowerCase().includes(query))
			);
		}

		return true;
	});

	function formatTimestamp(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}

	function handleSelectNode(entry: HistoryEntry) {
		if (onSelectNode) {
			onSelectNode(entry.nodeId);
		}
	}

	function handleSelectResult(entry: HistoryEntry, index: number) {
		if (onSelectResult) {
			onSelectResult(entry, index);
		}
	}
</script>

<div class="history-panel">
	<div class="header">
		<h3>Generation History</h3>
		{#if onClose}
			<button class="close" on:click={onClose}>
				<Icon name="X" size={16} />
			</button>
		{/if}
	</div>

	<div class="controls">
		<div class="filter-tabs">
			<button
				class="tab"
				class:active={filter === 'all'}
				on:click={() => (filter = 'all')}
			>
				All
			</button>
			<button
				class="tab"
				class:active={filter === 'generate'}
				on:click={() => (filter = 'generate')}
			>
				Generate
			</button>
			<button
				class="tab"
				class:active={filter === 'edit'}
				on:click={() => (filter = 'edit')}
			>
				Edit
			</button>
			<button
				class="tab"
				class:active={filter === 'describe'}
				on:click={() => (filter = 'describe')}
			>
				Describe
			</button>
			<button
				class="tab"
				class:active={filter === 'enhance'}
				on:click={() => (filter = 'enhance')}
			>
				Enhance
			</button>
		</div>

		<div class="search">
			<Icon name="Search" size={14} />
			<input
				type="text"
				placeholder="Search prompts..."
				bind:value={searchQuery}
			/>
		</div>
	</div>

	<div class="history-list">
		{#if filteredHistory.length === 0}
			<div class="empty">
				<Icon name="History" size={32} />
				<p>No generations yet</p>
				<p class="hint">Generate some images to see them here</p>
			</div>
		{:else}
			{#each filteredHistory as entry (entry.batch.id)}
				<div class="history-item">
					<div class="item-header">
						<button
							class="node-link"
							on:click={() => handleSelectNode(entry)}
							title="Go to node"
						>
							<Icon name="ArrowRight" size={12} />
							<span class="node-name">{entry.nodeName}</span>
						</button>
						<span class="timestamp">{formatTimestamp(entry.timestamp)}</span>
					</div>

					{#if entry.batch.results.length > 0}
						<div class="batch-preview">
							<GenerationGrid
								batch={entry.batch}
								selectedIndex={entry.batch.selectedIndex ?? 0}
								resultStatuses={new Map()}
								columns={Math.min(entry.batch.results.length, 4)}
								cellSize={60}
								on:select={(e) => handleSelectResult(entry, e.detail.index)}
							/>
						</div>

						{#if entry.batch.results[0]?.prompt}
							<div class="prompt-preview" title={entry.batch.results[0].prompt}>
								{entry.batch.results[0].prompt.slice(0, 100)}
								{#if entry.batch.results[0].prompt.length > 100}...{/if}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.history-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface-0);
		border-left: 1px solid var(--color-surface-2);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-surface-2);
	}

	.header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-1);
	}

	.close {
		background: none;
		border: none;
		padding: 4px;
		cursor: pointer;
		color: var(--color-text-3);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
		transition: background 0.2s, color 0.2s;
	}

	.close:hover {
		background: var(--color-surface-2);
		color: var(--color-text-1);
	}

	.controls {
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-surface-2);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.filter-tabs {
		display: flex;
		gap: 4px;
	}

	.tab {
		padding: 4px 8px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-surface-2);
		border-radius: 4px;
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s;
		color: var(--color-text-2);
	}

	.tab:hover {
		background: var(--color-surface-2);
		color: var(--color-text-1);
	}

	.tab.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-surface-2);
		border-radius: 4px;
		color: var(--color-text-3);
	}

	.search input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		font-size: 12px;
		color: var(--color-text-1);
	}

	.search input::placeholder {
		color: var(--color-text-3);
	}

	.history-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.history-item {
		padding: 12px;
		margin-bottom: 8px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-surface-2);
		border-radius: 4px;
		transition: border-color 0.2s;
	}

	.history-item:hover {
		border-color: var(--color-accent);
	}

	.item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		font-size: 11px;
	}

	.node-link {
		display: flex;
		align-items: center;
		gap: 4px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-accent);
		font-weight: 500;
		transition: opacity 0.2s;
	}

	.node-link:hover {
		opacity: 0.8;
	}

	.node-name {
		font-size: 12px;
	}

	.timestamp {
		color: var(--color-text-3);
		font-size: 10px;
	}

	.batch-preview {
		margin-bottom: 8px;
	}

	.prompt-preview {
		font-size: 11px;
		color: var(--color-text-2);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		text-align: center;
		color: var(--color-text-3);
	}

	.empty p {
		margin: 8px 0 0 0;
		font-size: 13px;
	}

	.empty .hint {
		font-size: 11px;
		color: var(--color-text-4);
	}
</style>



