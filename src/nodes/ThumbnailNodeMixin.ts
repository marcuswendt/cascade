/**
 * ThumbnailNodeMixin - Adds visual display mode capabilities to nodes
 *
 * This mixin provides:
 * - Display mode state (box, thumbnail, grid, minimal)
 * - Thumbnail size management
 * - Result status tracking (starred, approved, rejected)
 * - Visual rendering hints for the canvas
 */

import type { ResultStatus, NodeDisplayMode } from '../services/genai/types';

// Generic constructor type for mixin pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GConstructor<T = object> = abstract new (...args: any[]) => T;

// Minimal node interface that ThumbnailNodeMixin requires
interface NodeLike {
	id: string;
	type: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	props: Record<string, any>;
	addParm(name: string, config: unknown): void;
	markDirty(): void;
}

/**
 * Interface for thumbnail-enabled nodes
 */
export interface ThumbnailNodeInterface {
	/** Current display mode */
	displayMode: NodeDisplayMode;

	/** Thumbnail dimensions */
	thumbnailSize: { width: number; height: number };

	/** Whether the node is expanded (shows full content) */
	isExpanded: boolean;

	/** Set the display mode */
	setDisplayMode(mode: NodeDisplayMode): void;

	/** Cycle to the next display mode */
	cycleDisplayMode(): void;

	/** Set thumbnail size */
	setThumbnailSize(width: number, height: number): void;

	/** Toggle expanded state */
	toggleExpanded(): void;
}

/**
 * Default thumbnail sizes for different modes
 */
export const THUMBNAIL_SIZES = {
	small: { width: 64, height: 64 },
	medium: { width: 128, height: 128 },
	large: { width: 256, height: 256 },
	xlarge: { width: 512, height: 512 }
} as const;

/**
 * Display mode cycle order
 */
const DISPLAY_MODE_ORDER: NodeDisplayMode[] = ['box', 'thumbnail', 'grid', 'minimal'];

/**
 * ThumbnailNodeMixin factory
 *
 * Usage:
 * ```typescript
 * class MyNode extends ThumbnailNodeMixin(AINodeMixin(LensNode)) {
 *   // Implementation
 * }
 * ```
 */
export function ThumbnailNodeMixin<TBase extends GConstructor<NodeLike>>(Base: TBase) {
	abstract class ThumbnailNodeClass extends Base implements ThumbnailNodeInterface {
		displayMode: NodeDisplayMode = 'box';
		thumbnailSize: { width: number; height: number } = { ...THUMBNAIL_SIZES.medium };
		isExpanded: boolean = false;

		/**
		 * Setup thumbnail-specific props
		 * Call from subclass setup()
		 */
		protected setupThumbnail(): void {
			// Display mode prop (hidden, managed by UI)
			this.addParm('_displayMode', {
				value: 'box' as NodeDisplayMode,
				type: 'select',
				params: {
					options: [
						{ value: 'box', label: 'Box' },
						{ value: 'thumbnail', label: 'Thumbnail' },
						{ value: 'grid', label: 'Grid' },
						{ value: 'minimal', label: 'Minimal' }
					]
				},
				hidden: true
			});

			// Thumbnail size preset
			this.addParm('_thumbnailPreset', {
				value: 'medium',
				type: 'select',
				params: {
					options: [
						{ value: 'small', label: 'Small (64px)' },
						{ value: 'medium', label: 'Medium (128px)' },
						{ value: 'large', label: 'Large (256px)' },
						{ value: 'xlarge', label: 'XL (512px)' }
					]
				},
				hidden: true
			});
		}

		/**
		 * Set the display mode
		 */
		setDisplayMode(mode: NodeDisplayMode): void {
			this.displayMode = mode;
			this.props._displayMode = { ...this.props._displayMode, value: mode };
			this.markDirty();
		}

		/**
		 * Cycle to the next display mode
		 * Useful for keyboard shortcut (T key)
		 */
		cycleDisplayMode(): void {
			const currentIndex = DISPLAY_MODE_ORDER.indexOf(this.displayMode);
			const nextIndex = (currentIndex + 1) % DISPLAY_MODE_ORDER.length;
			this.setDisplayMode(DISPLAY_MODE_ORDER[nextIndex]);
		}

		/**
		 * Set thumbnail size
		 */
		setThumbnailSize(width: number, height: number): void {
			this.thumbnailSize = { width, height };
			this.markDirty();
		}

		/**
		 * Set thumbnail size from preset
		 */
		setThumbnailPreset(preset: keyof typeof THUMBNAIL_SIZES): void {
			const size = THUMBNAIL_SIZES[preset];
			this.thumbnailSize = { ...size };
			this.props._thumbnailPreset = { ...this.props._thumbnailPreset, value: preset };
			this.markDirty();
		}

		/**
		 * Toggle expanded state
		 */
		toggleExpanded(): void {
			this.isExpanded = !this.isExpanded;
			this.markDirty();
		}

		/**
		 * Get the node dimensions based on display mode
		 */
		getNodeDimensions(): { width: number; height: number } {
			switch (this.displayMode) {
				case 'box':
					return { width: 80, height: 36 };
				case 'thumbnail':
					return {
						width: this.thumbnailSize.width + 16, // padding
						height: this.thumbnailSize.height + 36 // header + padding
					};
				case 'grid':
					// Grid shows multiple results
					const cols = 2;
					const rows = 2;
					const cellSize = 64;
					return {
						width: cols * cellSize + 24,
						height: rows * cellSize + 36
					};
				case 'minimal':
					return {
						width: this.thumbnailSize.width,
						height: this.thumbnailSize.height
					};
				default:
					return { width: 80, height: 36 };
			}
		}

		/**
		 * Serialize thumbnail state
		 */
		serializeThumbnail(): Record<string, unknown> {
			return {
				displayMode: this.displayMode,
				thumbnailSize: this.thumbnailSize,
				isExpanded: this.isExpanded
			};
		}

		/**
		 * Deserialize thumbnail state
		 */
		deserializeThumbnail(data: Record<string, unknown>): void {
			if (data.displayMode && typeof data.displayMode === 'string') {
				this.displayMode = data.displayMode as NodeDisplayMode;
			}
			if (data.thumbnailSize && typeof data.thumbnailSize === 'object') {
				const size = data.thumbnailSize as { width?: number; height?: number };
				if (typeof size.width === 'number' && typeof size.height === 'number') {
					this.thumbnailSize = { width: size.width, height: size.height };
				}
			}
			if (typeof data.isExpanded === 'boolean') {
				this.isExpanded = data.isExpanded;
			}
		}
	}

	return ThumbnailNodeClass;
}

/**
 * Type helper for nodes that use ThumbnailNodeMixin
 */
export type ThumbnailNode = InstanceType<ReturnType<typeof ThumbnailNodeMixin>>;
