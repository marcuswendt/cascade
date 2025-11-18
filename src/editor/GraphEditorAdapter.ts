import { Graph } from '@/core/engine/Graph';
import { AssetManager, BrowserAssetLoader } from '@/core/engine/AssetManager';
import { PackageManager } from '@/core/engine/PackageManager';

/**
 * Adapter class that bridges the pure graph execution engine with the editor UI
 * Handles UI-specific concerns like scene container creation
 */
export class GraphEditorAdapter {
  private graph: Graph;
  private sceneContainer: HTMLElement | null = null;

  constructor(graph?: Graph) {
    if (graph) {
      this.graph = graph;
    } else {
      // Create new graph with browser-specific managers
      const assetManager = new AssetManager('', new BrowserAssetLoader());
      const packageManager = new PackageManager();
      this.graph = new Graph(assetManager, packageManager);
    }
    
    // Create scene container for browser environment
    if (typeof document !== 'undefined') {
      this.sceneContainer = document.createElement('div');
      this.sceneContainer.id = 'cascade-scene';
    }
  }

  getGraph(): Graph {
    return this.graph;
  }

  getSceneContainer(): HTMLElement | null {
    return this.sceneContainer;
  }

  /**
   * Create a new graph instance
   */
  static create(): GraphEditorAdapter {
    return new GraphEditorAdapter();
  }

  /**
   * Load graph from JSON
   */
  static fromJSON(json: any): GraphEditorAdapter {
    const assetManager = new AssetManager('', new BrowserAssetLoader());
    const packageManager = new PackageManager();
    const graph = Graph.fromJSON(json, assetManager, packageManager);
    return new GraphEditorAdapter(graph);
  }
}

