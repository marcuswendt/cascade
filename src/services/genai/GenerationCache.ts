/**
 * Generation Cache for storing AI-generated images
 *
 * Manages project-local caching of generated images and thumbnails.
 * Cache is stored in $project/cache/generate/<nodeId>/
 */

import type { GenerationBatch, GenerationResult, ImageData } from './types';
import type { ImageBuffer } from '../../nodes/lens/ImageBuffer';
import { ImageBuffer as ImageBufferClass } from '../../nodes/lens/ImageBuffer';

/**
 * Interface for file system operations
 * Allows different implementations for browser (File System Access API) vs server
 */
export interface FileSystemAdapter {
	/** Check if a directory exists */
	exists(path: string): Promise<boolean>;
	/** Create a directory (recursive) */
	mkdir(path: string): Promise<void>;
	/** Write a blob to a file */
	writeFile(path: string, data: Blob | ArrayBuffer): Promise<void>;
	/** Read a file as blob */
	readFile(path: string): Promise<Blob>;
	/** List files in a directory */
	listFiles(path: string): Promise<string[]>;
	/** Delete a file */
	deleteFile(path: string): Promise<void>;
	/** Delete a directory (recursive) */
	deleteDir(path: string): Promise<void>;
	/** Move/rename a directory */
	moveDir(from: string, to: string): Promise<void>;
}

/** Default thumbnail size */
const THUMBNAIL_SIZE = 256;

/** Cache format version for migration */
const CACHE_VERSION = 1;

/**
 * Manages caching of generated images in the project directory
 */
class GenerationCacheClass {
	private adapter: FileSystemAdapter | null = null;

	/**
	 * Set the file system adapter
	 * Must be called before using cache operations
	 */
	setAdapter(adapter: FileSystemAdapter): void {
		this.adapter = adapter;
	}

	/**
	 * Get the adapter or throw if not set
	 */
	private getAdapter(): FileSystemAdapter {
		if (!this.adapter) {
			throw new Error('GenerationCache: No file system adapter configured');
		}
		return this.adapter;
	}

	// =========================================================================
	// Directory Management
	// =========================================================================

	/**
	 * Get the cache directory for a node
	 */
	getCacheDir(projectDir: string, nodeId: string): string {
		return `${projectDir}/cache/generate/${nodeId}`;
	}

	/**
	 * Ensure the cache directory exists
	 */
	async ensureCacheDir(projectDir: string, nodeId: string): Promise<string> {
		const adapter = this.getAdapter();
		const cacheDir = this.getCacheDir(projectDir, nodeId);

		if (!(await adapter.exists(cacheDir))) {
			await adapter.mkdir(cacheDir);
		}

		return cacheDir;
	}

	/**
	 * Handle node rename - update cache directory
	 */
	async renameNodeCache(projectDir: string, oldId: string, newId: string): Promise<void> {
		const adapter = this.getAdapter();
		const oldDir = this.getCacheDir(projectDir, oldId);
		const newDir = this.getCacheDir(projectDir, newId);

		if (await adapter.exists(oldDir)) {
			await adapter.moveDir(oldDir, newDir);
		}
	}

	/**
	 * Delete cache for a node
	 */
	async deleteNodeCache(projectDir: string, nodeId: string): Promise<void> {
		const adapter = this.getAdapter();
		const cacheDir = this.getCacheDir(projectDir, nodeId);

		if (await adapter.exists(cacheDir)) {
			await adapter.deleteDir(cacheDir);
		}
	}

	/**
	 * Clean up orphaned cache directories (nodes that no longer exist)
	 */
	async cleanOrphanedCaches(projectDir: string, existingNodeIds: Set<string>): Promise<void> {
		const adapter = this.getAdapter();
		const cacheRoot = `${projectDir}/cache/generate`;

		if (!(await adapter.exists(cacheRoot))) {
			return;
		}

		const dirs = await adapter.listFiles(cacheRoot);
		for (const dir of dirs) {
			if (!existingNodeIds.has(dir)) {
				await adapter.deleteDir(`${cacheRoot}/${dir}`);
			}
		}
	}

	// =========================================================================
	// Image Saving
	// =========================================================================

	/**
	 * Save a generation result to cache
	 * Returns updated result with file references
	 */
	async saveResult(
		cacheDir: string,
		batchId: string,
		result: GenerationResult
	): Promise<GenerationResult> {
		const adapter = this.getAdapter();

		// Generate file names
		const imageFile = `${batchId}_${result.id}.png`;
		const thumbnailFile = `${batchId}_${result.id}_thumb.jpg`;

		// Save full image (only if it's an actual ImageBuffer)
		if (result.imageBuffer && this.isImageBuffer(result.imageBuffer)) {
			const imageBlob = await this.imageBufferToBlob(result.imageBuffer, 'image/png');
			await adapter.writeFile(`${cacheDir}/${imageFile}`, imageBlob);

			// Save thumbnail
			const thumbnailBlob = await this.createThumbnail(result.imageBuffer, THUMBNAIL_SIZE);
			await adapter.writeFile(`${cacheDir}/${thumbnailFile}`, thumbnailBlob);
		}

		// Return result with file references
		return {
			...result,
			imageFile,
			thumbnailFile
		};
	}

	/**
	 * Save all results from a batch
	 */
	async saveBatch(
		projectDir: string,
		nodeId: string,
		batch: GenerationBatch
	): Promise<GenerationBatch> {
		const cacheDir = await this.ensureCacheDir(projectDir, nodeId);

		const savedResults = await Promise.all(
			batch.results.map((result) => this.saveResult(cacheDir, batch.id, result))
		);

		return {
			...batch,
			results: savedResults
		};
	}

	// =========================================================================
	// Image Loading
	// =========================================================================

	/**
	 * Load an image from cache as ImageBuffer
	 */
	async loadImage(cacheDir: string, imageFile: string): Promise<ImageBuffer | null> {
		const adapter = this.getAdapter();
		const path = `${cacheDir}/${imageFile}`;

		try {
			const blob = await adapter.readFile(path);
			return this.blobToImageBuffer(blob);
		} catch {
			console.warn(`Failed to load cached image: ${path}`);
			return null;
		}
	}

	/**
	 * Load a thumbnail URL from cache
	 * Returns a blob: URL that should be revoked when no longer needed
	 */
	async loadThumbnailUrl(cacheDir: string, thumbnailFile: string): Promise<string | null> {
		const adapter = this.getAdapter();
		const path = `${cacheDir}/${thumbnailFile}`;

		try {
			const blob = await adapter.readFile(path);
			return URL.createObjectURL(blob);
		} catch {
			console.warn(`Failed to load cached thumbnail: ${path}`);
			return null;
		}
	}

	/**
	 * Load images for a batch from cache
	 */
	async loadBatchImages(
		cacheDir: string,
		batch: GenerationBatch,
		options: { loadFull?: boolean; loadThumbnails?: boolean } = {}
	): Promise<GenerationBatch> {
		const { loadFull = true, loadThumbnails = true } = options;

		const results = await Promise.all(
			batch.results.map(async (result) => {
				const updated = { ...result };

				if (loadFull && result.imageFile && !result.imageBuffer) {
					updated.imageBuffer = await this.loadImage(cacheDir, result.imageFile);
				}

				if (loadThumbnails && result.thumbnailFile && !result.thumbnailUrl) {
					updated.thumbnailUrl = await this.loadThumbnailUrl(cacheDir, result.thumbnailFile);
				}

				return updated;
			})
		);

		return {
			...batch,
			results
		};
	}

	// =========================================================================
	// Image Conversion Utilities
	// =========================================================================

	/**
	 * Type guard to check if ImageData is an ImageBuffer
	 */
	private isImageBuffer(data: ImageData): data is ImageBuffer {
		return data instanceof ImageBufferClass;
	}

	/**
	 * Convert ImageBuffer to Blob
	 */
	private async imageBufferToBlob(
		imageBuffer: ImageBuffer,
		mimeType: 'image/png' | 'image/jpeg' = 'image/png',
		quality = 0.9
	): Promise<Blob> {
		const canvas = imageBuffer.toCanvas();
		return new Promise((resolve) => {
			canvas.toBlob(
				(blob) => {
					resolve(blob!);
				},
				mimeType,
				quality
			);
		});
	}

	/**
	 * Convert Blob to ImageBuffer
	 */
	private async blobToImageBuffer(blob: Blob): Promise<ImageBuffer> {
		// Import ImageBuffer dynamically to avoid circular deps
		const { ImageBuffer } = await import('../../nodes/lens/ImageBuffer');

		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();

		return ImageBuffer.fromCanvas(canvas);
	}

	/**
	 * Create a thumbnail from an ImageBuffer
	 */
	private async createThumbnail(imageBuffer: ImageBuffer, maxSize: number): Promise<Blob> {
		const { width, height } = imageBuffer;

		// Calculate thumbnail dimensions maintaining aspect ratio
		let thumbWidth: number;
		let thumbHeight: number;

		if (width >= height) {
			thumbWidth = Math.min(maxSize, width);
			thumbHeight = Math.round((height / width) * thumbWidth);
		} else {
			thumbHeight = Math.min(maxSize, height);
			thumbWidth = Math.round((width / height) * thumbHeight);
		}

		// Create resized canvas
		const sourceCanvas = imageBuffer.toCanvas();
		const thumbCanvas = document.createElement('canvas');
		thumbCanvas.width = thumbWidth;
		thumbCanvas.height = thumbHeight;

		const ctx = thumbCanvas.getContext('2d')!;
		ctx.drawImage(sourceCanvas, 0, 0, thumbWidth, thumbHeight);

		return new Promise((resolve) => {
			thumbCanvas.toBlob(
				(blob) => {
					resolve(blob!);
				},
				'image/jpeg',
				0.8
			);
		});
	}

	// =========================================================================
	// Blob URL Management
	// =========================================================================

	/**
	 * Revoke all thumbnail URLs for a batch
	 * Call this when a batch is no longer needed to free memory
	 */
	revokeThumbnailUrls(batch: GenerationBatch): void {
		for (const result of batch.results) {
			if (result.thumbnailUrl?.startsWith('blob:')) {
				URL.revokeObjectURL(result.thumbnailUrl);
			}
		}
	}

	/**
	 * Revoke thumbnail URLs for multiple batches
	 */
	revokeBatchThumbnails(batches: GenerationBatch[]): void {
		for (const batch of batches) {
			this.revokeThumbnailUrls(batch);
		}
	}

	// =========================================================================
	// Cache Statistics
	// =========================================================================

	/**
	 * Get cache size for a node
	 */
	async getCacheSize(projectDir: string, nodeId: string): Promise<number> {
		const adapter = this.getAdapter();
		const cacheDir = this.getCacheDir(projectDir, nodeId);

		if (!(await adapter.exists(cacheDir))) {
			return 0;
		}

		const files = await adapter.listFiles(cacheDir);
		let totalSize = 0;

		for (const file of files) {
			try {
				const blob = await adapter.readFile(`${cacheDir}/${file}`);
				totalSize += blob.size;
			} catch {
				// Ignore errors for individual files
			}
		}

		return totalSize;
	}

	/**
	 * Get total cache size for project
	 */
	async getTotalCacheSize(projectDir: string): Promise<number> {
		const adapter = this.getAdapter();
		const cacheRoot = `${projectDir}/cache/generate`;

		if (!(await adapter.exists(cacheRoot))) {
			return 0;
		}

		const nodeDirs = await adapter.listFiles(cacheRoot);
		let totalSize = 0;

		for (const nodeId of nodeDirs) {
			totalSize += await this.getCacheSize(projectDir, nodeId);
		}

		return totalSize;
	}

	/**
	 * Format bytes as human-readable string
	 */
	formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}
}

// Singleton instance
export const GenerationCache = new GenerationCacheClass();
