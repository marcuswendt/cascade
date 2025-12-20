<script lang="ts">
	/**
	 * AINodeContent - Renders AI node content based on display mode
	 *
	 * Supports multiple display modes:
	 * - box: Standard node with icon
	 * - thumbnail: Shows selected result as large preview
	 * - grid: Shows batch results in a grid
	 * - minimal: Just the image, no chrome
	 */
	import type { GenerationBatch, GenerationResult, NodeDisplayMode } from '@/services/genai/types';
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';

	export let displayMode: NodeDisplayMode = 'box';
	export let latestBatch: GenerationBatch | null = null;
	export let selectedResult: GenerationResult | null = null;
	export let isGenerating: boolean = false;
	export let progress: number = 0;
	export let error: string | null = null;
	export let thumbnailSize: { width: number; height: number } = { width: 128, height: 128 };
	export let nodeIcon: string = 'Sparkles';

	const dispatch = createEventDispatcher();

	// Get thumbnail URL for a result
	function getThumbnailUrl(result: GenerationResult): string | null {
		if (result.thumbnailUrl) {
			return result.thumbnailUrl;
		}
		// If we have a blob, create a URL
		if (result.imageBuffer && 'blob' in result.imageBuffer) {
			return URL.createObjectURL(result.imageBuffer.blob);
		}
		return null;
	}

	function handleResultClick(batchId: string, index: number) {
		dispatch('selectResult', { batchId, index });
	}

	function handleGenerate() {
		dispatch('generate');
	}

	function handleCancel() {
		dispatch('cancel');
	}

	$: results = latestBatch?.results ?? [];
	$: selectedIndex = latestBatch?.selectedIndex ?? 0;
</script>

{#if displayMode === 'box'}
	<!-- Standard box mode - icon with optional mini preview -->
	<div class="box-content">
		{#if isGenerating}
			<div class="generating">
				<div class="spinner"></div>
				<span class="progress-text">{Math.round(progress)}%</span>
			</div>
		{:else if error}
			<div class="error-indicator" title={error}>
				<Icon name="AlertCircle" size={16} />
			</div>
		{:else if selectedResult?.thumbnailUrl}
			<img
				src={selectedResult.thumbnailUrl}
				alt="Result"
				class="mini-preview"
			/>
		{:else}
			<Icon name={nodeIcon} size={16} />
		{/if}
	</div>

{:else if displayMode === 'thumbnail'}
	<!-- Thumbnail mode - large preview of selected result -->
	<div
		class="thumbnail-content"
		style="width: {thumbnailSize.width}px; height: {thumbnailSize.height}px"
	>
		{#if isGenerating}
			<div class="generating-overlay">
				<div class="spinner large"></div>
				<span class="progress-text">{Math.round(progress)}%</span>
			</div>
		{:else if selectedResult}
			{@const url = getThumbnailUrl(selectedResult)}
			{#if url}
				<img src={url} alt="Generated result" class="thumbnail-image" />
			{:else}
				<div class="placeholder">
					<Icon name="Image" size={32} />
				</div>
			{/if}
		{:else}
			<div class="placeholder">
				<Icon name={nodeIcon} size={32} />
				<span class="placeholder-text">No results</span>
			</div>
		{/if}
	</div>

{:else if displayMode === 'grid'}
	<!-- Grid mode - shows batch results -->
	<div class="grid-content">
		{#if isGenerating}
			<div class="generating-overlay">
				<div class="spinner"></div>
				<span class="progress-text">{Math.round(progress)}%</span>
			</div>
		{:else if results.length > 0}
			<div class="results-grid">
				{#each results.slice(0, 4) as result, i}
					{@const url = getThumbnailUrl(result)}
					<button
						class="grid-cell"
						class:selected={i === selectedIndex}
						on:click={() => handleResultClick(latestBatch?.id ?? '', i)}
					>
						{#if url}
							<img src={url} alt="Result {i + 1}" />
						{:else}
							<div class="cell-placeholder">
								<Icon name="Image" size={16} />
							</div>
						{/if}
					</button>
				{/each}
			</div>
			{#if results.length > 4}
				<div class="more-indicator">+{results.length - 4} more</div>
			{/if}
		{:else}
			<div class="placeholder">
				<Icon name={nodeIcon} size={24} />
			</div>
		{/if}
	</div>

{:else if displayMode === 'minimal'}
	<!-- Minimal mode - just the image -->
	<div
		class="minimal-content"
		style="width: {thumbnailSize.width}px; height: {thumbnailSize.height}px"
	>
		{#if isGenerating}
			<div class="generating-overlay minimal">
				<div class="spinner"></div>
			</div>
		{:else if selectedResult}
			{@const url = getThumbnailUrl(selectedResult)}
			{#if url}
				<img src={url} alt="Generated result" class="minimal-image" />
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* Box mode */
	.box-content {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.mini-preview {
		width: 24px;
		height: 24px;
		object-fit: cover;
		border-radius: 2px;
	}

	/* Thumbnail mode */
	.thumbnail-content {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-1);
		border-radius: 4px;
		overflow: hidden;
	}

	.thumbnail-image {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	/* Grid mode */
	.grid-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px;
	}

	.results-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
	}

	.grid-cell {
		width: 56px;
		height: 56px;
		border: none;
		padding: 0;
		background: var(--color-surface-1);
		border-radius: 2px;
		overflow: hidden;
		cursor: pointer;
		transition: transform 0.1s, box-shadow 0.1s;
	}

	.grid-cell:hover {
		transform: scale(1.05);
	}

	.grid-cell.selected {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.grid-cell img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cell-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-3);
	}

	.more-indicator {
		font-size: 10px;
		color: var(--color-text-3);
		text-align: center;
	}

	/* Minimal mode */
	.minimal-content {
		position: relative;
		overflow: hidden;
		border-radius: 4px;
	}

	.minimal-image {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	/* Shared styles */
	.placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		height: 100%;
		color: var(--color-text-3);
	}

	.placeholder-text {
		font-size: 11px;
	}

	.generating, .generating-overlay {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}

	.generating-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		color: white;
	}

	.generating-overlay.minimal {
		background: rgba(0, 0, 0, 0.3);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-text-3);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.spinner.large {
		width: 24px;
		height: 24px;
		border-width: 3px;
	}

	.progress-text {
		font-size: 10px;
		color: var(--color-text-2);
	}

	.generating-overlay .progress-text {
		color: white;
	}

	.error-indicator {
		color: var(--color-error);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
