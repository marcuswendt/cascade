/**
 * AINodeMixin - Adds AI generation capabilities to nodes
 *
 * This mixin provides:
 * - Generation history management (batches with results)
 * - Generate/cancel actions with abort support
 * - Auto-execute option (disabled by default, AI is expensive)
 * - Progress tracking and status display
 * - Serialization of history metadata (images stored in cache)
 */

import type {
	GenerationBatch,
	GenerationResult,
	GenerationHistory,
	ResultStatus,
	ProviderType
} from '../services/genai/types';
import { GenerationManager } from '../services/genai/GenerationManager';
import { AIError, AIErrorType } from '../services/genai/errors';

// Generic constructor type for mixin pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GConstructor<T = object> = abstract new (...args: any[]) => T;

// Minimal node interface that AINodeMixin requires
// Only include public members here - protected members are accessed via type assertions
interface NodeLike {
	id: string;
	type: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	props: Record<string, any>;
	position: { x: number; y: number };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	inputs: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	outputs: any[];
	addParm(name: string, config: unknown): void;
	addAction(name: string, config: unknown): void;
	setParm(name: string, value: unknown): void;
	markDirty(): void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	in(name: string, defaultValue?: any, options?: any): any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	out(name: string, portType?: string): any;
	onReady?: () => void;
	// LensNode method for setting output (made public for mixin access)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	setOutput?(output: any, buffer: any): void;
}

/**
 * Interface for AI-enabled nodes
 */
export interface AINodeInterface {
	/** Current generation history */
	history: GenerationHistory;

	/** Whether the node is currently generating */
	isGenerating: boolean;

	/** Current abort controller for cancellation */
	abortController: AbortController | null;

	/** Progress (0-100) of current generation */
	progress: number;

	/** Error from last generation attempt */
	generationError: AIError | null;

	/** Start a generation */
	generate(): Promise<void>;

	/** Cancel current generation */
	cancel(): void;

	/** Select a result from a batch */
	selectResult(batchId: string, index: number): void;

	/** Set result status (starred, approved, rejected) */
	setResultStatus(batchId: string, resultIndex: number, status: ResultStatus): void;

	/** Get the currently selected result */
	getSelectedResult(): GenerationResult | null;

	/** Get the most recent batch */
	getLatestBatch(): GenerationBatch | null;
}

/**
 * AINodeMixin factory
 *
 * Usage:
 * ```typescript
 * class GenerateNode extends AINodeMixin(LensNode) {
 *   protected async performGeneration(): Promise<GenerationResult[]> {
 *     // Implementation
 *   }
 * }
 * ```
 */
export function AINodeMixin<TBase extends GConstructor<NodeLike>>(Base: TBase) {
	abstract class AINodeClass extends Base implements AINodeInterface {
		history: GenerationHistory = {
			batches: [],
			selectedBatchIndex: null
		};

		isGenerating: boolean = false;
		abortController: AbortController | null = null;
		progress: number = 0;
		generationError: AIError | null = null;

		// Result statuses (persisted separately)
		protected resultStatuses: Map<string, ResultStatus> = new Map();

		/**
		 * Setup AI-specific props and actions
		 * Call from subclass setup()
		 */
		protected setupAI(): void {
			// Auto-execute toggle (off by default - AI is expensive)
			this.addParm('autoExecute', {
				value: false,
				type: 'boolean',
				displayName: 'Auto Generate',
				group: 'ai'
			});

			// Add generate action
			this.addAction('generate', {
				label: 'Generate',
				icon: 'Sparkles',
				callback: () => this.generate(),
				condition: () => !this.isGenerating
			});

			// Add cancel action
			this.addAction('cancel', {
				label: 'Cancel',
				icon: 'X',
				callback: () => this.cancel(),
				condition: () => this.isGenerating
			});
		}

		/**
		 * Abstract method - subclasses implement the actual generation
		 */
		protected abstract performGeneration(signal: AbortSignal): Promise<GenerationResult[]>;

		/**
		 * Optional: Get batch metadata for history
		 */
		protected getBatchMetadata(): Record<string, unknown> {
			return {};
		}

		/**
		 * Start a generation
		 */
		async generate(): Promise<void> {
			if (this.isGenerating) {
				console.warn('Generation already in progress');
				return;
			}

			// Clear previous error
			this.generationError = null;

			// Create abort controller
			this.abortController = new AbortController();
			this.isGenerating = true;
			this.progress = 0;

			// Create batch ID
			const batchId = crypto.randomUUID();

			// Register with global manager
			const registeredController = GenerationManager.register(
				this.id,
				this.id,
				batchId
			);

			// Use the manager's controller for coordinated cancellation
			this.abortController = registeredController;

			// Create pending batch
			const batch: GenerationBatch = {
				id: batchId,
				results: [],
				selectedIndex: null,
				status: 'generating',
				timestamp: new Date(),
				metadata: this.getBatchMetadata()
			};

			// Add to history
			this.history.batches.unshift(batch);
			this.history.selectedBatchIndex = 0;

			// Trim history if needed
			if (this.history.batches.length > 50) {
				this.history.batches = this.history.batches.slice(0, 50);
			}

			try {
				// Perform the actual generation
				const results = await this.performGeneration(this.abortController.signal);

				// Update batch with results
				batch.results = results;
				batch.status = 'complete';
				batch.selectedIndex = 0;

				// Record in global history
				GenerationManager.recordGeneration(
					this.id,
					this.id,
					this.type,
					batch
				);

				// Trigger UI update
				this.markDirty();

				// Call onGenerationComplete hook
				this.onGenerationComplete(batch);
			} catch (error) {
				if (error instanceof AIError) {
					this.generationError = error;
					batch.status = 'error';
					batch.error = error.getUserMessage();
				} else if ((error as Error).name === 'AbortError') {
					batch.status = 'error';
					batch.error = 'Cancelled';
				} else {
					this.generationError = new AIError(
						AIErrorType.UNKNOWN,
						(error as Error).message || 'Unknown error'
					);
					batch.status = 'error';
					batch.error = (error as Error).message;
				}
			} finally {
				this.isGenerating = false;
				this.abortController = null;
				this.progress = 100;
				GenerationManager.complete(batchId);
			}
		}

		/**
		 * Cancel current generation
		 */
		cancel(): void {
			if (this.abortController) {
				this.abortController.abort();
				this.isGenerating = false;
				this.abortController = null;
			}
		}

		/**
		 * Hook called when generation completes successfully
		 */
		protected onGenerationComplete(_batch: GenerationBatch): void {
			// Override in subclass
		}

		/**
		 * Update progress (called by performGeneration)
		 */
		protected updateProgress(progress: number): void {
			this.progress = Math.min(100, Math.max(0, progress));

			// Update global manager
			const latestBatch = this.getLatestBatch();
			if (latestBatch) {
				GenerationManager.updateProgress(latestBatch.id, this.progress);
			}
		}

		/**
		 * Select a result from a batch
		 */
		selectResult(batchId: string, index: number): void {
			const batchIndex = this.history.batches.findIndex((b) => b.id === batchId);
			if (batchIndex === -1) return;

			const batch = this.history.batches[batchIndex];
			if (index < 0 || index >= batch.results.length) return;

			batch.selectedIndex = index;
			this.history.selectedBatchIndex = batchIndex;

			// Trigger update
			this.markDirty();
			this.onResultSelected(batch.results[index]);
		}

		/**
		 * Hook called when a result is selected
		 */
		protected onResultSelected(_result: GenerationResult): void {
			// Override in subclass to update outputs
		}

		/**
		 * Set status on a result
		 */
		setResultStatus(batchId: string, resultIndex: number, status: ResultStatus): void {
			const batch = this.history.batches.find((b) => b.id === batchId);
			if (!batch || resultIndex < 0 || resultIndex >= batch.results.length) return;

			const resultId = batch.results[resultIndex].id;
			this.resultStatuses.set(resultId, status);
		}

		/**
		 * Get status for a result
		 */
		getResultStatus(resultId: string): ResultStatus {
			return this.resultStatuses.get(resultId) ?? 'none';
		}

		/**
		 * Get the currently selected result
		 */
		getSelectedResult(): GenerationResult | null {
			if (this.history.selectedBatchIndex === null) return null;

			const batch = this.history.batches[this.history.selectedBatchIndex];
			if (!batch || batch.selectedIndex === null) return null;

			return batch.results[batch.selectedIndex] ?? null;
		}

		/**
		 * Get the most recent batch
		 */
		getLatestBatch(): GenerationBatch | null {
			return this.history.batches[0] ?? null;
		}

		/**
		 * Serialize AI state (history metadata, not images)
		 */
		serializeAI(): Record<string, unknown> {
			return {
				history: {
					batches: this.history.batches.map((batch) => ({
						id: batch.id,
						status: batch.status,
						selectedIndex: batch.selectedIndex,
						timestamp: batch.timestamp.toISOString(),
						metadata: batch.metadata,
						error: batch.error,
						// Store result metadata only (images in cache)
						results: batch.results.map((r) => ({
							id: r.id,
							seed: r.seed,
							prompt: r.prompt,
							negativePrompt: r.negativePrompt,
							model: r.model,
							provider: r.provider,
							timestamp: r.timestamp.toISOString(),
							metadata: r.metadata
							// imageBuffer and thumbnailUrl not serialized here
						}))
					})),
					selectedBatchIndex: this.history.selectedBatchIndex
				},
				resultStatuses: Object.fromEntries(this.resultStatuses)
			};
		}

		/**
		 * Deserialize AI state
		 */
		deserializeAI(data: Record<string, unknown>): void {
			if (data.history && typeof data.history === 'object') {
				const historyData = data.history as Record<string, unknown>;

				this.history = {
					batches: (historyData.batches as unknown[] || []).map((b: unknown) => {
						const batchData = b as Record<string, unknown>;
						return {
							id: batchData.id as string,
							status: batchData.status as GenerationBatch['status'],
							selectedIndex: batchData.selectedIndex as number | null,
							timestamp: new Date(batchData.timestamp as string),
							metadata: (batchData.metadata as Record<string, unknown>) || {},
							error: batchData.error as string | undefined,
							results: ((batchData.results as unknown[]) || []).map((r: unknown) => {
								const resultData = r as Record<string, unknown>;
								return {
									id: resultData.id as string,
									seed: resultData.seed as number,
									imageBuffer: null, // Will be loaded from cache
									thumbnailUrl: null,
									prompt: resultData.prompt as string,
									negativePrompt: resultData.negativePrompt as string | undefined,
									model: resultData.model as string,
									provider: resultData.provider as ProviderType,
									timestamp: new Date(resultData.timestamp as string),
									metadata: (resultData.metadata as Record<string, unknown>) || {}
								};
							})
						};
					}),
					selectedBatchIndex: historyData.selectedBatchIndex as number | null
				};
			}

			if (data.resultStatuses && typeof data.resultStatuses === 'object') {
				this.resultStatuses = new Map(
					Object.entries(data.resultStatuses as Record<string, ResultStatus>)
				);
			}
		}
	}

	return AINodeClass;
}

/**
 * Type helper for nodes that use AINodeMixin
 */
export type AINode = InstanceType<ReturnType<typeof AINodeMixin>>;
