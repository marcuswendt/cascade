<script lang="ts">
	/**
	 * GenerationGrid - Grid view of generation results for selection
	 *
	 * Features:
	 * - Displays results in a responsive grid
	 * - Click to select a result
	 * - Keyboard navigation (1-9 to select)
	 * - Status indicators (starred, approved, rejected)
	 * - Hover preview
	 */
	import type { GenerationBatch, GenerationResult, ResultStatus } from '@/services/genai/types';
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';

	export let batch: GenerationBatch;
	export let selectedIndex: number = 0;
	export let resultStatuses: Map<string, ResultStatus> = new Map();
	export let columns: number = 3;
	export let cellSize: number = 80;

	const dispatch = createEventDispatcher();

	function getThumbnailUrl(result: GenerationResult): string | null {
		if (result.thumbnailUrl) {
			return result.thumbnailUrl;
		}
		if (result.imageBuffer && 'blob' in result.imageBuffer) {
			return URL.createObjectURL(result.imageBuffer.blob);
		}
		return null;
	}

	function getStatusIcon(status: ResultStatus): string | null {
		switch (status) {
			case 'starred':
				return 'Star';
			case 'approved':
				return 'Check';
			case 'rejected':
				return 'X';
			case 'reference':
				return 'Link';
			default:
				return null;
		}
	}

	function getStatusColor(status: ResultStatus): string {
		switch (status) {
			case 'starred':
				return 'var(--color-warning)';
			case 'approved':
				return 'var(--color-success)';
			case 'rejected':
				return 'var(--color-error)';
			case 'reference':
				return 'var(--color-accent)';
			default:
				return 'transparent';
		}
	}

	function handleSelect(index: number) {
		dispatch('select', { batchId: batch.id, index });
	}

	function handleStatusChange(index: number, status: ResultStatus) {
		dispatch('statusChange', { batchId: batch.id, index, status });
	}

	function handleKeydown(e: KeyboardEvent) {
		// Number keys 1-9 to select
		const num = parseInt(e.key);
		if (num >= 1 && num <= batch.results.length) {
			handleSelect(num - 1);
		}

		// Arrow keys for navigation
		if (e.key === 'ArrowRight' && selectedIndex < batch.results.length - 1) {
			handleSelect(selectedIndex + 1);
		}
		if (e.key === 'ArrowLeft' && selectedIndex > 0) {
			handleSelect(selectedIndex - 1);
		}
		if (e.key === 'ArrowDown') {
			const newIndex = selectedIndex + columns;
			if (newIndex < batch.results.length) {
				handleSelect(newIndex);
			}
		}
		if (e.key === 'ArrowUp') {
			const newIndex = selectedIndex - columns;
			if (newIndex >= 0) {
				handleSelect(newIndex);
			}
		}

		// S to star, X to reject, A to approve
		if (e.key === 's' || e.key === 'S') {
			const current = resultStatuses.get(batch.results[selectedIndex].id) ?? 'none';
			handleStatusChange(selectedIndex, current === 'starred' ? 'none' : 'starred');
		}
		if (e.key === 'x' || e.key === 'X') {
			const current = resultStatuses.get(batch.results[selectedIndex].id) ?? 'none';
			handleStatusChange(selectedIndex, current === 'rejected' ? 'none' : 'rejected');
		}
		if (e.key === 'a' || e.key === 'A') {
			const current = resultStatuses.get(batch.results[selectedIndex].id) ?? 'none';
			handleStatusChange(selectedIndex, current === 'approved' ? 'none' : 'approved');
		}
	}

	$: gridStyle = `
		grid-template-columns: repeat(${columns}, ${cellSize}px);
		gap: 4px;
	`;
</script>

<div
	class="generation-grid"
	style={gridStyle}
	tabindex="0"
	on:keydown={handleKeydown}
	role="grid"
	aria-label="Generation results"
>
	{#each batch.results as result, i}
		{@const url = getThumbnailUrl(result)}
		{@const status = resultStatuses.get(result.id) ?? 'none'}
		{@const statusIcon = getStatusIcon(status)}
		{@const statusColor = getStatusColor(status)}

		<button
			class="grid-cell"
			class:selected={i === selectedIndex}
			class:rejected={status === 'rejected'}
			style="width: {cellSize}px; height: {cellSize}px"
			on:click={() => handleSelect(i)}
			role="gridcell"
			aria-selected={i === selectedIndex}
			title="Result {i + 1} (Seed: {result.seed})"
		>
			{#if url}
				<img src={url} alt="Result {i + 1}" draggable="false" />
			{:else}
				<div class="placeholder">
					<Icon name="Image" size={20} />
				</div>
			{/if}

			<!-- Index badge -->
			<span class="index-badge">{i + 1}</span>

			<!-- Status indicator -->
			{#if statusIcon}
				<span class="status-badge" style="background: {statusColor}">
					<Icon name={statusIcon} size={10} />
				</span>
			{/if}

			<!-- Selection ring -->
			{#if i === selectedIndex}
				<div class="selection-ring"></div>
			{/if}
		</button>
	{/each}
</div>

<style>
	.generation-grid {
		display: grid;
		padding: 8px;
		background: var(--color-surface-0);
		border-radius: 4px;
		outline: none;
	}

	.generation-grid:focus-visible {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.grid-cell {
		position: relative;
		border: none;
		padding: 0;
		background: var(--color-surface-1);
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		transition: transform 0.1s ease, opacity 0.1s ease;
	}

	.grid-cell:hover {
		transform: scale(1.05);
		z-index: 1;
	}

	.grid-cell.selected {
		transform: scale(1.02);
	}

	.grid-cell.rejected {
		opacity: 0.5;
	}

	.grid-cell img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-3);
	}

	.index-badge {
		position: absolute;
		bottom: 2px;
		right: 2px;
		font-size: 9px;
		font-weight: bold;
		color: white;
		background: rgba(0, 0, 0, 0.6);
		padding: 1px 4px;
		border-radius: 2px;
		pointer-events: none;
	}

	.status-badge {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		color: white;
		pointer-events: none;
	}

	.selection-ring {
		position: absolute;
		inset: 0;
		border: 2px solid var(--color-accent);
		border-radius: 4px;
		pointer-events: none;
	}
</style>
