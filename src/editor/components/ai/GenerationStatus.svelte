<script lang="ts">
	/**
	 * GenerationStatus - Status bar indicator for active generations
	 *
	 * Shows a compact indicator in the status bar when generations are active.
	 * Clicking opens the generation history panel.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { GenerationManager } from '@/services/genai/GenerationManager';
	import type { ActiveGeneration } from '@/services/genai/types';
	import ProgressIndicator from './ProgressIndicator.svelte';
	import Icon from '../../Icon.svelte';

	export let onClick: (() => void) | null = null;

	let activeGenerations: ActiveGeneration[] = [];
	let totalProgress = 0;

	onMount(() => {
		// Subscribe to generation updates
		const unsubscribe = GenerationManager.subscribe((generations: ActiveGeneration[]) => {
			activeGenerations = generations;
			updateTotalProgress();
		});

		// Get initial state
		activeGenerations = GenerationManager.getActiveGenerations();
		updateTotalProgress();

		return unsubscribe;
	});

	function updateTotalProgress() {
		if (activeGenerations.length === 0) {
			totalProgress = 0;
			return;
		}

		// Average progress across all active generations
		const sum = activeGenerations.reduce((acc, gen) => acc + gen.progress, 0);
		totalProgress = Math.round(sum / activeGenerations.length);
	}

	function handleClick() {
		if (onClick) {
			onClick();
		}
	}

	function handleCancelAll() {
		activeGenerations.forEach((gen) => {
			GenerationManager.cancel(gen.batchId);
		});
	}
</script>

{#if activeGenerations.length > 0}
	<button class="generation-status" on:click={handleClick} title="View active generations">
		<ProgressIndicator
			progress={totalProgress}
			isGenerating={true}
			variant="circular"
			size="small"
			showCancel={false}
			showPercentage={false}
		/>

		<span class="count">{activeGenerations.length}</span>
		<span class="label">
			{activeGenerations.length === 1
				? 'Generating...'
				: `${activeGenerations.length} generating`}
		</span>

		{#if activeGenerations.length > 0}
			<button
				class="cancel-all"
				on:click|stopPropagation={handleCancelAll}
				title="Cancel all generations"
			>
				<Icon name="X" size={12} />
			</button>
		{/if}
	</button>
{/if}

<style>
	.generation-status {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-surface-2);
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.2s, border-color 0.2s;
		font-size: 12px;
		color: var(--color-text-2);
	}

	.generation-status:hover {
		background: var(--color-surface-2);
		border-color: var(--color-accent);
		color: var(--color-text-1);
	}

	.count {
		font-weight: 600;
		color: var(--color-accent);
	}

	.label {
		font-size: 11px;
	}

	.cancel-all {
		margin-left: 4px;
		padding: 2px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-3);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
		opacity: 0.6;
		transition: opacity 0.2s, background 0.2s;
	}

	.cancel-all:hover {
		opacity: 1;
		background: var(--color-surface-3);
		color: var(--color-error);
	}
</style>



