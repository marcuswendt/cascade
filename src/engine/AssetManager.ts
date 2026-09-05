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

export class AssetManager {
  cache = new Map<string, Asset>(); // Made public for drag-drop access
  private projectRoot: string;
  private loader: AssetLoader;
  
  constructor(projectRoot: string = '', loader?: AssetLoader) {
    this.projectRoot = projectRoot;
    this.loader = loader ?? new BrowserAssetLoader();
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
