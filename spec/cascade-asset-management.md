# Cascade Asset Management Specification

## Overview

All project assets (images, audio, video, fonts, JSON data, 3D models, etc.) are stored in a dedicated folder alongside the graph JSON file. This ensures projects are **completely self-contained** and can be easily shared, versioned in Git, and exported as standalone bundles.

---

## Project Structure

```
my-project/
├── flow-field.cascade.json          # Main graph file
├── assets/                          # All project assets
│   ├── images/
│   │   ├── background.jpg
│   │   ├── texture-001.png
│   │   └── sprites/
│   │       ├── particle.png
│   │       └── glow.png
│   ├── audio/
│   │   ├── ambient.mp3
│   │   └── hit.wav
│   ├── data/
│   │   ├── points.json
│   │   └── config.toml
│   ├── fonts/
│   │   └── custom.ttf
│   └── models/
│       └── scene.gltf
├── nodes/                           # Custom nodes (optional)
│   └── CustomEffect.node.ts
└── README.md                        # Project documentation
```

---

## Asset Referencing

### In Graph JSON

Assets are referenced using **relative paths** from the graph file:

```json
{
  "nodes": [
    {
      "id": "image_1",
      "type": "ImageLoader",
      "params": {
        "path": "./assets/images/background.jpg"
      }
    },
    {
      "id": "audio_1",
      "type": "AudioPlayer",
      "params": {
        "path": "./assets/audio/ambient.mp3"
      }
    }
  ],
  "assets": {
    "manifest": [
      {
        "id": "bg-image",
        "path": "./assets/images/background.jpg",
        "type": "image",
        "size": 2048576,
        "hash": "sha256:abc123...",
        "metadata": {
          "width": 1920,
          "height": 1080,
          "format": "jpeg"
        }
      },
      {
        "id": "ambient-sound",
        "path": "./assets/audio/ambient.mp3",
        "type": "audio",
        "size": 5242880,
        "hash": "sha256:def456...",
        "metadata": {
          "duration": 180,
          "format": "mp3",
          "bitrate": 320
        }
      }
    ]
  }
}
```

### In Node Code

Nodes access assets through the graph context:

```typescript
export default async function(node: NodeContext, graph: GraphContext) {
  // Method 1: Direct path (relative to graph file)
  const imagePath = node.in('path', './assets/images/bg.jpg', {
    type: 'asset',
    accept: ['image/*']
  });
  
  // Method 2: Asset ID from manifest
  const assetId = node.in('asset', 'bg-image', {
    type: 'asset-ref'
  });
  
  const trigger = node.in('load', 'trigger');
  const output = node.out('image');
  
  trigger.onTrigger = async () => {
    // Load via graph asset manager
    const image = await graph.assets.load(imagePath.value);
    
    // Or load via ID
    const image2 = await graph.assets.get(assetId.value);
    
    output.setValue(image);
    node.preview = image;
  };
}
```

---

## Asset Manager API

### Graph Context Interface

```typescript
interface GraphContext {
  assets: AssetManager;
  // ... other properties
}

interface AssetManager {
  /**
   * Load an asset by path (relative to graph file)
   * Automatically caches loaded assets
   */
  load(path: string): Promise<Asset>;
  
  /**
   * Load an asset by manifest ID
   */
  get(id: string): Promise<Asset>;
  
  /**
   * Add a new asset to the project
   * Copies file to assets folder and updates manifest
   */
  add(file: File, options?: AddAssetOptions): Promise<string>;
  
  /**
   * Remove an asset from project
   * Only removes if not referenced by any node
   */
  remove(id: string): Promise<void>;
  
  /**
   * Get all assets of a specific type
   */
  list(filter?: AssetFilter): Asset[];
  
  /**
   * Resolve relative path to absolute URL
   */
  resolve(path: string): string;
  
  /**
   * Watch for asset changes (hot reload)
   */
  watch(path: string, callback: (asset: Asset) => void): () => void;
  
  /**
   * Preload multiple assets
   */
  preload(paths: string[]): Promise<void>;
  
  /**
   * Clear unused assets
   */
  cleanup(): Promise<string[]>;
}

interface Asset {
  id: string;
  path: string;
  type: AssetType;
  data: any; // Loaded data (Image, AudioBuffer, ArrayBuffer, etc.)
  metadata: Record<string, any>;
  size: number;
  hash: string;
}

type AssetType = 
  | 'image' 
  | 'audio' 
  | 'video' 
  | 'font' 
  | 'json' 
  | 'text'
  | 'binary'
  | 'model'
  | 'shader';

interface AddAssetOptions {
  id?: string;           // Custom ID (auto-generated if not provided)
  folder?: string;       // Subfolder within assets/ (e.g., 'images')
  name?: string;         // Custom filename (uses original if not provided)
  metadata?: Record<string, any>;
}
```

---

## UI Integration

### Asset Browser Panel

```
┌─────────────────────────────────────┐
│ Assets                        [+]   │ ← Add asset button
├─────────────────────────────────────┤
│ 📁 images/                          │
│   └─ 🖼️  background.jpg    2.1 MB   │
│   └─ 🖼️  texture-001.png   512 KB   │
│                                     │
│ 📁 audio/                           │
│   └─ 🔊 ambient.mp3        5.2 MB   │
│   └─ 🔊 hit.wav            48 KB    │
│                                     │
│ 📁 data/                            │
│   └─ 📄 points.json        12 KB    │
│                                     │
│ Used: 7.8 MB / 12 assets           │
│ [Clean Unused]                      │
└─────────────────────────────────────┘
```

### Adding Assets

**1. Via Drag & Drop**
```typescript
// User drags image file onto canvas
graph.canvas.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files[0];
  
  // Auto-categorize by MIME type
  const folder = getAssetFolder(file.type);
  
  // Add to project
  const assetId = await graph.assets.add(file, {
    folder: folder,
    metadata: {
      addedBy: 'drag-drop',
      addedAt: Date.now()
    }
  });
  
  // Create node at drop position
  graph.addNode('ImageLoader', {
    position: { x: e.offsetX, y: e.offsetY },
    params: {
      asset: assetId
    }
  });
});
```

**2. Via File Picker**
```typescript
// Node parameter shows file picker
const imagePath = node.in('path', '', {
  type: 'asset',
  accept: ['image/*'],
  ui: 'file-picker'
});

// UI renders as:
// [background.jpg] [Change...] [📂]
```

**3. Via Asset Browser**
```typescript
// Right-click in asset browser → "Import Asset"
// Shows file dialog
// Automatically copies to assets/ folder
```

### Asset Parameter Types

```typescript
// Image asset
const image = node.in('image', null, {
  type: 'asset',
  accept: ['image/png', 'image/jpeg', 'image/webp'],
  preview: true  // Show thumbnail in inspector
});

// Audio asset
const audio = node.in('sound', null, {
  type: 'asset',
  accept: ['audio/*'],
  preload: true  // Load immediately when set
});

// Multiple assets
const textures = node.in('textures', [], {
  type: 'asset-array',
  accept: ['image/*'],
  min: 1,
  max: 8
});

// Asset with inline preview
node.inspector = {
  image: {
    type: 'asset',
    preview: 'inline',  // Show 200x200 preview
    onChange: async (path) => {
      const img = await graph.assets.load(path);
      node.preview = img;
    }
  }
};
```

---

## Asset Loading Implementation

### Image Assets

```typescript
// src/core/AssetManager.ts
class AssetManager {
  private cache = new Map<string, Asset>();
  private projectRoot: string;
  
  async load(path: string): Promise<Asset> {
    // Check cache
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }
    
    // Resolve path
    const absolutePath = this.resolve(path);
    
    // Load based on type
    const type = this.getAssetType(path);
    let data: any;
    
    switch (type) {
      case 'image':
        data = await this.loadImage(absolutePath);
        break;
      case 'audio':
        data = await this.loadAudio(absolutePath);
        break;
      case 'json':
        data = await this.loadJSON(absolutePath);
        break;
      case 'text':
        data = await this.loadText(absolutePath);
        break;
      case 'binary':
        data = await this.loadBinary(absolutePath);
        break;
      default:
        throw new Error(`Unknown asset type: ${type}`);
    }
    
    // Create asset object
    const asset: Asset = {
      id: this.generateId(path),
      path,
      type,
      data,
      metadata: await this.extractMetadata(data, type),
      size: await this.getSize(absolutePath),
      hash: await this.hash(absolutePath)
    };
    
    // Cache it
    this.cache.set(path, asset);
    
    return asset;
  }
  
  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  
  private async loadAudio(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    return await audioContext.decodeAudioData(arrayBuffer);
  }
  
  private async loadJSON(url: string): Promise<any> {
    const response = await fetch(url);
    return await response.json();
  }
  
  private async loadText(url: string): Promise<string> {
    const response = await fetch(url);
    return await response.text();
  }
  
  private async loadBinary(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    return await response.arrayBuffer();
  }
}
```

### Hot Reloading Assets

```typescript
// Watch for asset changes during development
graph.assets.watch('./assets/images/bg.jpg', (asset) => {
  console.log('Asset updated:', asset.path);
  
  // Update all nodes using this asset
  graph.nodes.forEach(node => {
    node.inputs.forEach(input => {
      if (input.value === asset.path) {
        input.setValue(asset.path, { force: true });
      }
    });
  });
});
```

---

## Export with Assets

### Single HTML Bundle

When exporting to a single HTML file, assets are embedded as base64:

```typescript
async function exportSingleHTML(graph: Graph): Promise<string> {
  const assets = await graph.assets.list();
  
  // Embed assets as data URLs
  const embeddedAssets = await Promise.all(
    assets.map(async (asset) => {
      const data = await fetch(asset.path).then(r => r.blob());
      const base64 = await blobToBase64(data);
      
      return {
        id: asset.id,
        path: asset.path,
        dataUrl: `data:${data.type};base64,${base64}`
      };
    })
  );
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>${graph.metadata.name}</title>
</head>
<body>
  <script>
    // Embedded asset map
    const ASSETS = ${JSON.stringify(embeddedAssets)};
    
    // Override fetch for asset loading
    const originalFetch = window.fetch;
    window.fetch = function(url) {
      const asset = ASSETS.find(a => url.includes(a.path));
      if (asset) {
        return Promise.resolve(new Response(
          dataUrlToBlob(asset.dataUrl)
        ));
      }
      return originalFetch.apply(this, arguments);
    };
    
    // Graph code...
    ${graph.compile()}
  </script>
</body>
</html>
  `;
}
```

### HTML + Assets Folder

For larger projects, export as a folder:

```
exported-project/
├── index.html           # Main HTML file
├── cascade-runtime.js   # Minimal runtime
├── graph.js            # Compiled graph
└── assets/             # Copied assets
    ├── images/
    ├── audio/
    └── data/
```

```typescript
async function exportWithAssets(graph: Graph, outputDir: string) {
  // Copy assets folder
  await fs.copy(
    path.join(graph.projectRoot, 'assets'),
    path.join(outputDir, 'assets')
  );
  
  // Generate index.html with relative asset paths
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${graph.metadata.name}</title>
  <script src="cascade-runtime.js"></script>
</head>
<body>
  <script src="graph.js"></script>
</body>
</html>
  `;
  
  await fs.writeFile(path.join(outputDir, 'index.html'), html);
}
```

---

## Example: Complete Image Processing Node

```typescript
// src/nodes/library/ImageProcessor.node.ts
export default async function(node: NodeContext, graph: GraphContext) {
  // Image input with asset picker
  const imagePath = node.in('image', '', {
    type: 'asset',
    accept: ['image/*'],
    description: 'Source image to process'
  });
  
  // Effect parameters
  const brightness = node.in('brightness', 1, {
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1
  });
  
  const contrast = node.in('contrast', 1, {
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1
  });
  
  const trigger = node.in('process', 'trigger');
  const output = node.out('canvas');
  const onComplete = node.out('onComplete', 'trigger');
  
  // State
  let sourceImage: HTMLImageElement | null = null;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  
  node.onReady = () => {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!;
  };
  
  // Load image when path changes
  imagePath.onChange = async (path) => {
    if (!path) return;
    
    try {
      // Load via asset manager
      const asset = await graph.assets.load(path);
      sourceImage = asset.data as HTMLImageElement;
      
      // Update canvas size
      canvas.width = sourceImage.width;
      canvas.height = sourceImage.height;
      
      node.comment = `${sourceImage.width}×${sourceImage.height}`;
    } catch (error) {
      node.error = `Failed to load image: ${error.message}`;
      sourceImage = null;
    }
  };
  
  // Process image
  trigger.onTrigger = () => {
    if (!sourceImage) {
      node.error = 'No image loaded';
      return;
    }
    
    // Draw source image
    ctx.drawImage(sourceImage, 0, 0);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Apply brightness and contrast
    const b = brightness.value;
    const c = contrast.value;
    const factor = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
    
    for (let i = 0; i < data.length; i += 4) {
      // Apply brightness
      data[i] *= b;
      data[i + 1] *= b;
      data[i + 2] *= b;
      
      // Apply contrast
      data[i] = factor * (data[i] - 128) + 128;
      data[i + 1] = factor * (data[i + 1] - 128) + 128;
      data[i + 2] = factor * (data[i + 2] - 128) + 128;
      
      // Clamp values
      data[i] = Math.max(0, Math.min(255, data[i]));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1]));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2]));
    }
    
    // Put processed image back
    ctx.putImageData(imageData, 0, 0);
    
    // Output
    output.setValue(canvas);
    node.preview = canvas;
    onComplete.trigger();
  };
}
```

---

## Asset Types Reference

### Supported Formats

```typescript
const SUPPORTED_ASSETS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac'],
  video: ['.mp4', '.webm', '.ogv'],
  model: ['.gltf', '.glb', '.obj', '.fbx'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
  data: ['.json', '.csv', '.xml', '.yaml', '.toml'],
  text: ['.txt', '.md', '.glsl', '.frag', '.vert'],
  binary: ['.bin', '.dat']
};
```

### MIME Type Detection

```typescript
function getAssetType(filename: string): AssetType {
  const ext = path.extname(filename).toLowerCase();
  
  if (SUPPORTED_ASSETS.image.includes(ext)) return 'image';
  if (SUPPORTED_ASSETS.audio.includes(ext)) return 'audio';
  if (SUPPORTED_ASSETS.video.includes(ext)) return 'video';
  if (SUPPORTED_ASSETS.model.includes(ext)) return 'model';
  if (SUPPORTED_ASSETS.font.includes(ext)) return 'font';
  if (SUPPORTED_ASSETS.data.includes(ext)) return 'json';
  if (SUPPORTED_ASSETS.text.includes(ext)) return 'text';
  
  return 'binary';
}
```

---

## Best Practices

### 1. Always Use Relative Paths
```typescript
// ✅ Good - relative to graph file
imagePath: './assets/images/bg.jpg'

// ❌ Bad - absolute path (not portable)
imagePath: '/Users/marcus/projects/cascade/my-project/assets/images/bg.jpg'

// ❌ Bad - web URL (requires internet)
imagePath: 'https://example.com/image.jpg'
```

### 2. Organize by Type
```
assets/
├── images/      # All images
├── audio/       # All audio
├── data/        # JSON, CSV, etc.
└── shaders/     # GLSL files
```

### 3. Use Descriptive Names
```typescript
// ✅ Good
'assets/images/particle-glow-256.png'
'assets/audio/ambient-forest-loop.mp3'

// ❌ Bad
'assets/img1.png'
'assets/sound.mp3'
```

### 4. Include Metadata
```json
{
  "assets": {
    "manifest": [
      {
        "id": "particle-tex",
        "path": "./assets/images/particle.png",
        "type": "image",
        "metadata": {
          "purpose": "Particle sprite for flow field",
          "source": "Generated in Photoshop",
          "license": "CC0"
        }
      }
    ]
  }
}
```

### 5. Clean Unused Assets
```bash
# Run cleanup to remove unreferenced assets
cascade clean --unused
# Removes assets not referenced by any node
```

---

## CLI Commands

```bash
# Add asset to current project
cascade add asset image.jpg --folder images

# List all project assets
cascade list assets

# Find unused assets
cascade find --unused

# Remove unused assets
cascade clean --unused --dry-run  # Preview
cascade clean --unused             # Actually remove

# Optimize assets (compress images, etc.)
cascade optimize assets

# Export with assets
cascade export --with-assets ./output
```

---

## Git Integration

### .gitignore Template
```gitignore
# Node modules
node_modules/

# Build output
dist/
.cascade/

# Large assets (use Git LFS)
*.psd
*.ai
*.wav
*.mp4

# Temporary files
*.tmp
.DS_Store
```

### Git LFS for Large Assets
```bash
# Track large files with Git LFS
git lfs track "*.psd"
git lfs track "*.wav"
git lfs track "*.mp4"
git lfs track "assets/**/*.png"

# Commit .gitattributes
git add .gitattributes
git commit -m "Configure Git LFS for large assets"
```

---

## Key Benefits

✅ **Self-Contained Projects** - Everything needed is in one folder
✅ **Easy Sharing** - Zip and send, or clone from Git
✅ **Version Control** - Assets tracked alongside code
✅ **Portable Exports** - Bundles work anywhere
✅ **No Broken Links** - Relative paths always work
✅ **Hot Reload** - Assets update live during development
✅ **Type Safety** - Asset types validated at load time
✅ **Performance** - Assets cached automatically

This system ensures Cascade projects are **production-ready** and **collaborative-friendly** from day one!
