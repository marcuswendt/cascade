/**
 * Local Storage Adapter
 *
 * Filesystem-based storage implementation for Electron desktop app.
 * Uses the cascadeElectron bridge for file operations.
 */

import type { StorageAdapter, Project, Graph, GraphContent, Asset } from './types';

// Type declarations for Window.cascadeElectron are in src/vite-env.d.ts

/**
 * Get the cascadeElectron bridge (only available in Electron)
 */
function getElectronBridge() {
  if (typeof window === 'undefined' || !window.cascadeElectron) {
    throw new Error('LocalStorageAdapter requires Electron environment');
  }
  return window.cascadeElectron;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    json: 'application/json',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * LocalStorageAdapter - Filesystem-based storage for Electron
 */
export class LocalStorageAdapter implements StorageAdapter {
  private bridge = getElectronBridge();

  constructor(private folderPath: string) {}

  get projectRoot(): string {
    return this.folderPath;
  }

  // ============ Project Metadata ============

  async getProject(): Promise<Project> {
    const metaPath = this.bridge.path.join(this.folderPath, 'project.json');

    try {
      const content = await this.bridge.fs.readFile(metaPath);
      const data = JSON.parse(content);
      return {
        name: data.name,
        description: data.description,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };
    } catch {
      // Auto-generate from folder name if project.json doesn't exist
      const name = this.bridge.path.basename(this.folderPath);
      return {
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  async updateProject(data: Partial<Project>): Promise<Project> {
    const current = await this.getProject();
    const updated: Project = {
      ...current,
      ...data,
      updatedAt: new Date(),
    };

    const metaPath = this.bridge.path.join(this.folderPath, 'project.json');
    await this.bridge.fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          name: updated.name,
          description: updated.description,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
        null,
        2
      )
    );

    return updated;
  }

  // ============ Graphs ============

  async listGraphs(): Promise<Graph[]> {
    const graphsDir = this.bridge.path.join(this.folderPath, 'graphs');

    try {
      const entries = await this.bridge.fs.readdir(graphsDir);
      const graphs: Graph[] = [];

      for (const entry of entries) {
        const name = entry.name;
        if (name && name.endsWith('.cascade')) {
          const slug = name.replace('.cascade', '');
          const graph = await this.getGraph(slug);
          if (graph) graphs.push(graph);
        }
      }

      return graphs;
    } catch {
      return [];
    }
  }

  async getGraph(slug: string): Promise<Graph | null> {
    const graphPath = this.bridge.path.join(this.folderPath, 'graphs', `${slug}.cascade`);

    try {
      const content = await this.bridge.fs.readFile(graphPath);
      const parsed = JSON.parse(content);
      const stats = await this.bridge.fs.stat(graphPath);

      return {
        slug,
        name: parsed.name || slug,
        content: parsed,
        updatedAt: new Date(stats.mtime || stats.mtimeMs || Date.now()),
      };
    } catch {
      return null;
    }
  }

  async saveGraph(slug: string, content: GraphContent): Promise<Graph> {
    const graphsDir = this.bridge.path.join(this.folderPath, 'graphs');
    await this.bridge.fs.mkdir(graphsDir);

    const graphPath = this.bridge.path.join(graphsDir, `${slug}.cascade`);
    await this.bridge.fs.writeFile(graphPath, JSON.stringify(content, null, 2));

    return {
      slug,
      name: content.name || slug,
      content,
      updatedAt: new Date(),
    };
  }

  async createGraph(name: string): Promise<Graph> {
    const slug = this.slugify(name);
    const content: GraphContent = {
      name,
      nodes: [],
      connections: [],
      annotations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    return this.saveGraph(slug, content);
  }

  async deleteGraph(slug: string): Promise<void> {
    const graphPath = this.bridge.path.join(this.folderPath, 'graphs', `${slug}.cascade`);
    await this.bridge.fs.unlink(graphPath);
  }

  async renameGraph(slug: string, newName: string): Promise<Graph> {
    const graph = await this.getGraph(slug);
    if (!graph) throw new Error(`Graph "${slug}" not found`);

    const newSlug = this.slugify(newName);
    const newContent = { ...graph.content, name: newName };

    // Save with new name
    await this.saveGraph(newSlug, newContent);

    // Delete old file if slug changed
    if (newSlug !== slug) {
      await this.deleteGraph(slug);
    }

    return { ...graph, slug: newSlug, name: newName, content: newContent };
  }

  // ============ Assets ============

  async listAssets(): Promise<Asset[]> {
    const assetsDir = this.bridge.path.join(this.folderPath, 'assets');
    const assets: Asset[] = [];

    const walk = async (dir: string, prefix: string = '') => {
      try {
        const entries = await this.bridge.fs.readdir(dir);

        for (const entry of entries) {
          const name = entry.name;
          if (!name) continue;
          const isDirectory = entry.isDirectory?.() ?? false;
          const relativePath = prefix ? `${prefix}/${name}` : name;
          const fullPath = this.bridge.path.join(dir, name);

          if (isDirectory) {
            await walk(fullPath, relativePath);
          } else {
            try {
              const stats = await this.bridge.fs.stat(fullPath);
              assets.push({
                filename: name,
                path: `assets/${relativePath}`,
                mimeType: getMimeType(name),
                sizeBytes: stats.size || 0,
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    await walk(assetsDir);
    return assets;
  }

  getAssetUrl(assetPath: string): string {
    // Use cascade-asset:// protocol registered by Electron
    return `cascade-asset://${encodeURIComponent(this.folderPath)}/${assetPath}`;
  }

  async importAsset(file: File, targetPath?: string): Promise<Asset> {
    const filename = targetPath || file.name;
    const fullPath = this.bridge.path.join(this.folderPath, 'assets', filename);
    const dirPath = this.bridge.path.dirname(fullPath);

    // Ensure directory exists
    await this.bridge.fs.mkdir(dirPath);

    // Read file content and write
    const content = await file.text();
    await this.bridge.fs.writeFile(fullPath, content);

    return {
      filename: this.bridge.path.basename(filename),
      path: `assets/${filename}`,
      mimeType: file.type || getMimeType(filename),
      sizeBytes: file.size,
    };
  }

  async deleteAsset(assetPath: string): Promise<void> {
    const fullPath = this.bridge.path.join(this.folderPath, assetPath);
    await this.bridge.fs.unlink(fullPath);
  }

  // ============ Helpers ============

  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'untitled'
    );
  }
}
