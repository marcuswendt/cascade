import type { AssetLoader } from './AssetManager.js';

interface FileReader {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
}

/** Node-only asset IO. Browser entry points must not import this module. */
export class NodeAssetLoader implements AssetLoader {
  constructor(private readonly files: FileReader) {}

  loadImage(path: string): Promise<Uint8Array> {
    return this.files.readFile(path);
  }

  async loadJSON(path: string): Promise<unknown> {
    return JSON.parse(await this.files.readFile(path, 'utf-8'));
  }

  loadText(path: string): Promise<string> {
    return this.files.readFile(path, 'utf-8');
  }

  async loadBinary(path: string): Promise<ArrayBuffer> {
    const data = await this.files.readFile(path);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
}
