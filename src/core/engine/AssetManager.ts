export type AssetType = 'image' | 'audio' | 'video' | 'json' | 'text' | 'binary';

export interface Asset {
  id: string;
  path: string;
  type: AssetType;
  data: any;
  size: number;
  metadata: Record<string, any>;
}

/**
 * Interface for environment-specific asset loaders
 */
export interface AssetLoader {
  loadImage(path: string): Promise<any>;
  loadJSON(path: string): Promise<any>;
  loadText(path: string): Promise<string>;
  loadBinary(path: string): Promise<ArrayBuffer>;
}

/**
 * Browser-based asset loader (uses Image, fetch)
 */
export class BrowserAssetLoader implements AssetLoader {
  async loadImage(path: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        reject(new Error('Image API not available (not in browser environment)'));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
      img.src = path;
    });
  }

  async loadJSON(path: string): Promise<any> {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch API not available (not in browser environment)');
    }
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load JSON: ${path} - ${response.statusText}`);
    }
    return response.json();
  }

  async loadText(path: string): Promise<string> {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch API not available (not in browser environment)');
    }
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load text: ${path} - ${response.statusText}`);
    }
    return response.text();
  }

  async loadBinary(path: string): Promise<ArrayBuffer> {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch API not available (not in browser environment)');
    }
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load binary: ${path} - ${response.statusText}`);
    }
    return response.arrayBuffer();
  }
}

/**
 * Node.js-based asset loader (uses fs)
 */
export class NodeAssetLoader implements AssetLoader {
  private fs: any;
  private path: any;

  constructor(fsModule?: any, pathModule?: any) {
    // Accept fs and path modules as parameters for ES module compatibility
    // If not provided, try to use require (for CommonJS)
    if (fsModule && pathModule) {
      this.fs = fsModule;
      this.path = pathModule;
    } else if (typeof require !== 'undefined') {
      try {
        this.fs = require('fs/promises');
        this.path = require('path');
      } catch (err) {
        throw new Error('Node.js modules not available. Are you running in Node.js?');
      }
    } else {
      throw new Error('NodeAssetLoader requires fs and path modules. Pass them as constructor parameters.');
    }
  }

  async loadImage(path: string): Promise<Buffer> {
    // In Node.js, we return Buffer instead of HTMLImageElement
    // The actual image processing would need to be done by the consumer
    return this.fs.readFile(path);
  }

  async loadJSON(path: string): Promise<any> {
    const data = await this.fs.readFile(path, 'utf-8');
    return JSON.parse(data);
  }

  async loadText(path: string): Promise<string> {
    return this.fs.readFile(path, 'utf-8');
  }

  async loadBinary(path: string): Promise<ArrayBuffer> {
    const buffer = await this.fs.readFile(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
}

export class AssetManager {
  cache = new Map<string, Asset>(); // Made public for drag-drop access
  private projectRoot: string;
  private loader: AssetLoader;
  
  constructor(projectRoot: string = '', loader?: AssetLoader) {
    this.projectRoot = projectRoot;
    // Auto-detect environment if no loader provided
    if (loader) {
      this.loader = loader;
    } else if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
      // Browser environment
      this.loader = new BrowserAssetLoader();
    } else {
      // Node.js environment
      this.loader = new NodeAssetLoader();
    }
  }
  
  async load(path: string): Promise<Asset> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }
    
    const absolutePath = this.resolve(path);
    const type = this.getAssetType(path);
    
    let data: any;
    
    switch (type) {
      case 'image':
        data = await this.loader.loadImage(absolutePath);
        break;
      case 'json':
        data = await this.loader.loadJSON(absolutePath);
        break;
      case 'text':
        data = await this.loader.loadText(absolutePath);
        break;
      default:
        throw new Error(`Unsupported asset type: ${type}`);
    }
    
    const asset: Asset = {
      id: this.generateId(path),
      path,
      type,
      data,
      size: 0,
      metadata: {}
    };
    
    this.cache.set(path, asset);
    return asset;
  }
  
  private resolve(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    if (path.startsWith('/')) {
      return path;
    }
    return `${this.projectRoot}${path}`;
  }
  
  private getAssetType(path: string): AssetType {
    const ext = path.split('.').pop()?.toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return 'image';
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext || '')) return 'audio';
    if (['mp4', 'webm', 'mov'].includes(ext || '')) return 'video';
    if (ext === 'json') return 'json';
    if (['txt', 'md', 'csv'].includes(ext || '')) return 'text';
    
    return 'binary';
  }
  
  private generateId(path: string): string {
    return path.replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  getAsset(path: string): Asset | undefined {
    return this.cache.get(path);
  }
  
  clearCache() {
    this.cache.clear();
  }
  
  removeAsset(path: string) {
    this.cache.delete(path);
  }
  
  /**
   * Reload an asset from its path (useful for hot reload)
   */
  async reloadAsset(path: string): Promise<Asset> {
    // Remove from cache first
    this.cache.delete(path);
    // Reload
    return this.load(path);
  }
  
  /**
   * Reload all cached assets (useful for hot reload)
   */
  async reloadAll(): Promise<void> {
    const paths = Array.from(this.cache.keys());
    this.cache.clear();
    await Promise.all(paths.map(path => this.load(path).catch(err => {
      console.warn(`Failed to reload asset ${path}:`, err);
    })));
  }

  list(): Asset[] {
    return Array.from(this.cache.values());
  }
}

