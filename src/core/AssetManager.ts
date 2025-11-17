export type AssetType = 'image' | 'audio' | 'video' | 'json' | 'text' | 'binary';

export interface Asset {
  id: string;
  path: string;
  type: AssetType;
  data: any;
  size: number;
  metadata: Record<string, any>;
}

export class AssetManager {
  private cache = new Map<string, Asset>();
  private projectRoot: string;
  
  constructor(projectRoot: string = '') {
    this.projectRoot = projectRoot;
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
        data = await this.loadImage(absolutePath);
        break;
      case 'json':
        data = await this.loadJSON(absolutePath);
        break;
      case 'text':
        data = await this.loadText(absolutePath);
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
  
  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }
  
  private async loadJSON(url: string): Promise<any> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load JSON: ${url} - ${response.statusText}`);
    }
    return response.json();
  }
  
  private async loadText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load text: ${url} - ${response.statusText}`);
    }
    return response.text();
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

  list(): Asset[] {
    return Array.from(this.cache.values());
  }
}

