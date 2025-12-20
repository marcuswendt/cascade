<script lang="ts">
	/**
	 * ProgressIndicator - Shows generation progress
	 *
	 * Features:
	 * - Circular or linear progress display
	 * - Animated spinner for indeterminate progress
	 * - Cancel button
	 */
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';

	export let progress: number = 0;
	export let isGenerating: boolean = false;
	export let variant: 'circular' | 'linear' = 'circular';
	export let size: 'small' | 'medium' | 'large' = 'medium';
	export let showCancel: boolean = true;
	export let showPercentage: boolean = true;

	const dispatch = createEventDispatcher();

	function handleCancel() {
		dispatch('cancel');
	}

	$: displayProgress = Math.round(progress);
	$: isIndeterminate = progress === 0 && isGenerating;

	// Size mappings
	const sizes = {
		small: { diameter: 24, stroke: 2, fontSize: 8 },
		medium: { diameter: 40, stroke: 3, fontSize: 11 },
		large: { diameter: 64, stroke: 4, fontSize: 14 }
	};

	$: sizeConfig = sizes[size];
	$: radius = (sizeConfig.diameter - sizeConfig.stroke) / 2;
	$: circumference = 2 * Math.PI * radius;
	$: strokeDashoffset = circumference - (progress / 100) * circumference;
</script>

{#if variant === 'circular'}
	<div class="circular-progress" class:generating={isGenerating}>
		<svg
			width={sizeConfig.diameter}
			height={sizeConfig.diameter}
			viewBox="0 0 {sizeConfig.diameter} {sizeConfig.diameter}"
		>
			<!-- Background circle -->
			<circle
				cx={sizeConfig.diameter / 2}
				cy={sizeConfig.diameter / 2}
				r={radius}
				fill="none"
				stroke="var(--color-surface-2)"
				stroke-width={sizeConfig.stroke}
			/>

			<!-- Progress circle -->
			{#if isIndeterminate}
				<circle
					class="spinner-track"
					cx={sizeConfig.diameter / 2}
					cy={sizeConfig.diameter / 2}
					r={radius}
					fill="none"
					stroke="var(--color-accent)"
					stroke-width={sizeConfig.stroke}
					stroke-linecap="round"
					stroke-dasharray="{circumference * 0.25} {circumference * 0.75}"
				/>
			{:else}
				<circle
					class="progress-track"
					cx={sizeConfig.diameter / 2}
					cy={sizeConfig.diameter / 2}
					r={radius}
					fill="none"
					stroke="var(--color-accent)"
					stroke-width={sizeConfig.stroke}
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={strokeDashoffset}
					transform="rotate(-90 {sizeConfig.diameter / 2} {sizeConfig.diameter / 2})"
				/>
			{/if}
		</svg>

		{#if showPercentage && !isIndeterminate}
			<span class="percentage" style="font-size: {sizeConfig.fontSize}px">
				{displayProgress}%
			</span>
		{/if}

		{#if showCancel && isGenerating}
			<button
				class="cancel-overlay"
				on:click={handleCancel}
				title="Cancel generation"
			>
				<Icon name="X" size={sizeConfig.diameter * 0.4} />
			</button>
		{/if}
	</div>

{:else}
	<!-- Linear progress bar -->
	<div class="linear-progress" class:generating={isGenerating}>
		<div class="track">
			{#if isIndeterminate}
				<div class="bar indeterminate"></div>
			{:else}
				<div class="bar" style="width: {progress}%"></div>
			{/if}
		</div>

		<div class="linear-info">
			{#if showPercentage && !isIndeterminate}
				<span class="percentage">{displayProgress}%</span>
			{:else if isIndeterminate}
				<span class="status">Generating...</span>
			{/if}

			{#if showCancel && isGenerating}
				<button class="cancel-button" on:click={handleCancel} title="Cancel">
					<Icon name="X" size={14} />
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Circular variant */
	.circular-progress {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.circular-progress svg {
		display: block;
	}

	.spinner-track {
		animation: spin 1s linear infinite;
		transform-origin: center;
	}

	.progress-track {
		transition: stroke-dashoffset 0.3s ease;
	}

	.percentage {
		position: absolute;
		font-weight: 600;
		color: var(--color-text-1);
	}

	.cancel-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.2s;
		color: var(--color-text-1);
	}

	.circular-progress:hover .cancel-overlay {
		opacity: 1;
		background: rgba(0, 0, 0, 0.4);
		border-radius: 50%;
	}

	.circular-progress:hover .percentage {
		opacity: 0;
	}

	/* Linear variant */
	.linear-progress {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
	}

	.track {
		height: 4px;
		background: var(--color-surface-2);
		border-radius: 2px;
		overflow: hidden;
	}

	.bar {
		height: 100%;
		background: var(--color-accent);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.bar.indeterminate {
		width: 30%;
		animation: slide 1s ease-in-out infinite;
	}

	.linear-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		color: var(--color-text-2);
	}

	.status {
		color: var(--color-text-3);
	}

	.cancel-button {
		background: none;
		border: none;
		padding: 2px;
		cursor: pointer;
		color: var(--color-text-2);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
	}

	.cancel-button:hover {
		background: var(--color-surface-2);
		color: var(--color-text-1);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(400%);
		}
	}
</style>
