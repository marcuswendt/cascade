<script lang="ts">
	/**
	 * ReferenceImageList - Manage reference images for generation
	 *
	 * Features:
	 * - Display list of reference images
	 * - Add new images via drag-drop or file picker
	 * - Set reference type (style, composition, character, etc.)
	 * - Adjust strength per image
	 * - Remove images
	 */
	import type { ReferenceImage, ReferenceImageType } from '@/services/genai/types';
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';

	export let references: ReferenceImage[] = [];
	export let maxReferences: number = 4;
	export let showStrength: boolean = true;
	export let defaultType: ReferenceImageType = 'style';

	const dispatch = createEventDispatcher();

	let isDragging = false;
	let fileInput: HTMLInputElement;

	const referenceTypes: { value: ReferenceImageType; label: string; icon: string }[] = [
		{ value: 'style', label: 'Style', icon: 'Palette' },
		{ value: 'composition', label: 'Composition', icon: 'Layout' },
		{ value: 'character', label: 'Character', icon: 'User' },
		{ value: 'general', label: 'General', icon: 'Image' }
	];

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;

		const files = e.dataTransfer?.files;
		if (files) {
			addFilesAsReferences(files);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			addFilesAsReferences(input.files);
			input.value = '';
		}
	}

	function addFilesAsReferences(files: FileList) {
		const remaining = maxReferences - references.length;
		const toAdd = Math.min(files.length, remaining);

		for (let i = 0; i < toAdd; i++) {
			const file = files[i];
			if (file.type.startsWith('image/')) {
				const url = URL.createObjectURL(file);
				const newRef: ReferenceImage = {
					id: crypto.randomUUID(),
					imageUrl: url,
					type: defaultType,
					strength: 0.5
				};
				dispatch('add', { reference: newRef });
			}
		}
	}

	function handleRemove(id: string) {
		dispatch('remove', { id });
	}

	function handleTypeChange(id: string, type: ReferenceImageType) {
		dispatch('update', { id, type });
	}

	function handleStrengthChange(id: string, strength: number) {
		dispatch('update', { id, strength });
	}

	function openFilePicker() {
		fileInput?.click();
	}

	$: canAddMore = references.length < maxReferences;
</script>

<div class="reference-list">
	<!-- Reference items -->
	{#each references as ref (ref.id)}
		<div class="reference-item">
			<img src={ref.imageUrl} alt={ref.label || 'Reference'} class="reference-thumb" />

			<div class="reference-controls">
				<!-- Type selector -->
				<select
					class="type-select"
					value={ref.type}
					on:change={(e) => handleTypeChange(ref.id ?? '', e.currentTarget.value as ReferenceImageType)}
				>
					{#each referenceTypes as type}
						<option value={type.value}>{type.label}</option>
					{/each}
				</select>

				<!-- Strength slider -->
				{#if showStrength}
					<div class="strength-control">
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={ref.strength ?? 0.5}
							on:input={(e) => handleStrengthChange(ref.id ?? '', parseFloat(e.currentTarget.value))}
							class="strength-slider"
						/>
						<span class="strength-value">{Math.round((ref.strength ?? 0.5) * 100)}%</span>
					</div>
				{/if}
			</div>

			<!-- Remove button -->
			<button
				class="remove-button"
				on:click={() => handleRemove(ref.id ?? '')}
				title="Remove reference"
			>
				<Icon name="X" size={12} />
			</button>
		</div>
	{/each}

	<!-- Add button / drop zone -->
	{#if canAddMore}
		<button
			class="add-zone"
			class:dragging={isDragging}
			on:click={openFilePicker}
			on:drop={handleDrop}
			on:dragover={handleDragOver}
			on:dragleave={handleDragLeave}
		>
			<Icon name="Plus" size={16} />
			<span>Add Reference</span>
			<span class="hint">or drop image</span>
		</button>
	{/if}

	<!-- Hidden file input -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden-input"
		on:change={handleFileSelect}
	/>
</div>

<style>
	.reference-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.reference-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		background: var(--color-surface-1);
		border-radius: 6px;
		position: relative;
	}

	.reference-thumb {
		width: 48px;
		height: 48px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.reference-controls {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.type-select {
		padding: 4px 8px;
		font-size: 11px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-1);
		cursor: pointer;
	}

	.type-select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.strength-control {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.strength-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--color-surface-3);
		border-radius: 2px;
		cursor: pointer;
	}

	.strength-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		background: var(--color-accent);
		border-radius: 50%;
		cursor: grab;
	}

	.strength-slider::-webkit-slider-thumb:active {
		cursor: grabbing;
	}

	.strength-value {
		font-size: 10px;
		color: var(--color-text-2);
		min-width: 32px;
		text-align: right;
	}

	.remove-button {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-2);
		border: none;
		border-radius: 50%;
		cursor: pointer;
		color: var(--color-text-2);
		opacity: 0;
		transition: opacity 0.15s, background 0.15s;
	}

	.reference-item:hover .remove-button {
		opacity: 1;
	}

	.remove-button:hover {
		background: var(--color-error);
		color: white;
	}

	.add-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 16px;
		background: var(--color-surface-0);
		border: 2px dashed var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		color: var(--color-text-2);
		transition: border-color 0.15s, background 0.15s;
	}

	.add-zone:hover,
	.add-zone.dragging {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-0));
	}

	.add-zone span {
		font-size: 12px;
	}

	.add-zone .hint {
		font-size: 10px;
		color: var(--color-text-3);
	}

	.hidden-input {
		display: none;
	}
</style>
