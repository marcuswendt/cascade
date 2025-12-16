/**
 * Generation Manager for coordinating parallel AI generations
 *
 * Manages active generations across all nodes, provides UI feedback,
 * and maintains a global generation history.
 */

import type { ActiveGeneration, GenerationBatch, HistoryEntry } from './types';

type GenerationListener = (generations: ActiveGeneration[]) => void;
type HistoryListener = (entries: HistoryEntry[]) => void;

/**
 * Singleton manager for coordinating AI generations
 */
class GenerationManagerClass {
	/** Currently active generations */
	private activeGenerations = new Map<string, ActiveGeneration>();

	/** Global generation history (newest first) */
	private history: HistoryEntry[] = [];

	/** Listeners for active generation updates */
	private generationListeners = new Set<GenerationListener>();

	/** Listeners for history updates */
	private historyListeners = new Set<HistoryListener>();

	/** Maximum history entries to keep */
	private maxHistorySize = 100;

	// =========================================================================
	// Active Generation Management
	// =========================================================================

	/**
	 * Register a new generation and get an AbortController for it
	 *
	 * @param nodeId - ID of the node starting generation
	 * @param nodeName - Display name of the node
	 * @param batchId - ID of the batch being generated
	 * @returns AbortController for cancelling the generation
	 */
	register(nodeId: string, nodeName: string, batchId: string): AbortController {
		const abortController = new AbortController();

		const generation: ActiveGeneration = {
			nodeId,
			nodeName,
			batchId,
			status: 'generating',
			progress: 0,
			startTime: new Date(),
			abortController
		};

		this.activeGenerations.set(batchId, generation);
		this.notifyGenerationListeners();

		return abortController;
	}

	/**
	 * Update the progress of an active generation
	 */
	updateProgress(batchId: string, progress: number): void {
		const gen = this.activeGenerations.get(batchId);
		if (gen) {
			gen.progress = Math.min(100, Math.max(0, progress));
			this.notifyGenerationListeners();
		}
	}

	/**
	 * Update the status of an active generation
	 */
	updateStatus(batchId: string, status: 'queued' | 'generating'): void {
		const gen = this.activeGenerations.get(batchId);
		if (gen) {
			gen.status = status;
			this.notifyGenerationListeners();
		}
	}

	/**
	 * Mark a generation as complete and remove from active list
	 */
	complete(batchId: string): void {
		this.activeGenerations.delete(batchId);
		this.notifyGenerationListeners();
	}

	/**
	 * Cancel a specific generation
	 */
	cancel(batchId: string): void {
		const gen = this.activeGenerations.get(batchId);
		if (gen) {
			gen.abortController.abort();
			this.activeGenerations.delete(batchId);
			this.notifyGenerationListeners();
		}
	}

	/**
	 * Cancel all active generations
	 */
	cancelAll(): void {
		for (const gen of this.activeGenerations.values()) {
			gen.abortController.abort();
		}
		this.activeGenerations.clear();
		this.notifyGenerationListeners();
	}

	/**
	 * Cancel all generations for a specific node
	 */
	cancelForNode(nodeId: string): void {
		for (const [batchId, gen] of this.activeGenerations.entries()) {
			if (gen.nodeId === nodeId) {
				gen.abortController.abort();
				this.activeGenerations.delete(batchId);
			}
		}
		this.notifyGenerationListeners();
	}

	/**
	 * Get an active generation by batch ID
	 */
	getGeneration(batchId: string): ActiveGeneration | null {
		return this.activeGenerations.get(batchId) ?? null;
	}

	/**
	 * Get all active generations
	 */
	getActiveGenerations(): ActiveGeneration[] {
		return Array.from(this.activeGenerations.values());
	}

	/**
	 * Get active generations for a specific node
	 */
	getActiveForNode(nodeId: string): ActiveGeneration[] {
		return this.getActiveGenerations().filter((g) => g.nodeId === nodeId);
	}

	/**
	 * Check if there are any active generations
	 */
	get isGenerating(): boolean {
		return this.activeGenerations.size > 0;
	}

	/**
	 * Get count of active generations
	 */
	get activeCount(): number {
		return this.activeGenerations.size;
	}

	/**
	 * Check if a specific node is generating
	 */
	isNodeGenerating(nodeId: string): boolean {
		return this.getActiveForNode(nodeId).length > 0;
	}

	// =========================================================================
	// Generation Subscriptions
	// =========================================================================

	/**
	 * Subscribe to active generation updates
	 * @returns Unsubscribe function
	 */
	subscribe(callback: GenerationListener): () => void {
		this.generationListeners.add(callback);
		// Immediately call with current state
		callback(this.getActiveGenerations());
		return () => this.generationListeners.delete(callback);
	}

	private notifyGenerationListeners(): void {
		const generations = this.getActiveGenerations();
		for (const listener of this.generationListeners) {
			try {
				listener(generations);
			} catch (error) {
				console.error('Error in generation listener:', error);
			}
		}
	}

	// =========================================================================
	// History Management
	// =========================================================================

	/**
	 * Record a completed generation in history
	 */
	recordGeneration(
		nodeId: string,
		nodeName: string,
		nodeType: string,
		batch: GenerationBatch
	): void {
		const entry: HistoryEntry = {
			nodeId,
			nodeName,
			nodeType,
			batch,
			timestamp: new Date()
		};

		// Add to beginning (newest first)
		this.history.unshift(entry);

		// Trim to max size
		if (this.history.length > this.maxHistorySize) {
			this.history = this.history.slice(0, this.maxHistorySize);
		}

		this.notifyHistoryListeners();
	}

	/**
	 * Get all history entries
	 */
	getHistory(): HistoryEntry[] {
		return this.history;
	}

	/**
	 * Get history entries filtered by node type
	 */
	getHistoryByType(filter: 'all' | 'images' | 'text'): HistoryEntry[] {
		if (filter === 'all') {
			return this.history;
		}
		return this.history.filter((entry) => {
			if (filter === 'images') {
				return entry.nodeType.startsWith('lens/');
			}
			if (filter === 'text') {
				return entry.nodeType.startsWith('quill/');
			}
			return true;
		});
	}

	/**
	 * Get history entries for a specific node
	 */
	getHistoryForNode(nodeId: string): HistoryEntry[] {
		return this.history.filter((e) => e.nodeId === nodeId);
	}

	/**
	 * Clear all history
	 */
	clearHistory(): void {
		this.history = [];
		this.notifyHistoryListeners();
	}

	/**
	 * Remove history entries for a deleted node
	 */
	removeHistoryForNode(nodeId: string): void {
		this.history = this.history.filter((e) => e.nodeId !== nodeId);
		this.notifyHistoryListeners();
	}

	/**
	 * Subscribe to history updates
	 * @returns Unsubscribe function
	 */
	subscribeToHistory(callback: HistoryListener): () => void {
		this.historyListeners.add(callback);
		// Immediately call with current state
		callback(this.history);
		return () => this.historyListeners.delete(callback);
	}

	private notifyHistoryListeners(): void {
		for (const listener of this.historyListeners) {
			try {
				listener(this.history);
			} catch (error) {
				console.error('Error in history listener:', error);
			}
		}
	}

	// =========================================================================
	// Statistics
	// =========================================================================

	/**
	 * Get statistics about generations
	 */
	getStats(): {
		active: number;
		totalGenerated: number;
		imageCount: number;
		textCount: number;
	} {
		let imageCount = 0;
		let textCount = 0;

		for (const entry of this.history) {
			if (entry.nodeType.startsWith('lens/')) {
				imageCount += entry.batch.results.length;
			} else if (entry.nodeType.startsWith('quill/')) {
				textCount += entry.batch.results.length;
			}
		}

		return {
			active: this.activeCount,
			totalGenerated: this.history.length,
			imageCount,
			textCount
		};
	}

	// =========================================================================
	// Lifecycle
	// =========================================================================

	/**
	 * Reset all state (for testing or cleanup)
	 */
	reset(): void {
		this.cancelAll();
		this.history = [];
		this.generationListeners.clear();
		this.historyListeners.clear();
	}
}

// Singleton instance
export const GenerationManager = new GenerationManagerClass();
