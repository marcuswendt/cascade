import type { Graph } from '@/core/engine/Graph';
import type { Computation } from '@/core/engine/Node';
import type { Asset } from '@/core/engine/AssetManager';

export interface ExportOptions {
  embedAssets?: boolean; // Embed assets as base64 (default: true for single HTML)
  includeSource?: boolean; // Include source code in export
  minify?: boolean; // Minify JavaScript
}

/**
 * Compile graph to executable JavaScript
 */
export function compileGraph(graph: Graph): string {
  const nodes = graph.elements
    .filter(e => e.kind === 'computation')
    .map(node => {
      const comp = node as Computation;
      return {
        id: comp.id,
        type: comp.type,
        code: comp.code,
        position: comp.position,
        inputs: comp.inputs.map(port => ({
          id: port.id,
          name: port.name,
          portType: port.portType,
          dataType: port.dataType,
          value: port.value,
          defaultValue: port.defaultValue
        })),
        outputs: comp.outputs.map(port => ({
          id: port.id,
          name: port.name,
          portType: port.portType,
          dataType: port.dataType,
          value: port.value
        }))
      };
    });

  const connections = graph.connections.map(conn => ({
    id: conn.id,
    from: conn.from,
    to: conn.to,
    type: conn.type
  }));

  // Find entry points (computations with no input connections)
  const entryPoints = graph.elements
    .filter(e => e.kind === 'computation')
    .map(e => e as Computation)
    .filter(comp => comp.inputs.every(p => p.connections.length === 0))
    .map(comp => comp.id);

  return `
const graphData = {
  version: '1.0.0',
  nodes: ${JSON.stringify(nodes, null, 2)},
  connections: ${JSON.stringify(connections, null, 2)},
  entryPoints: ${JSON.stringify(entryPoints)}
};
  `.trim();
}

/**
 * Convert blob to base64 data URL
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert data URL to blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Embed assets as base64 data URLs
 */
export async function embedAssets(assets: Asset[]): Promise<Array<{ id: string; path: string; dataUrl: string; type: string }>> {
  const embedded: Array<{ id: string; path: string; dataUrl: string; type: string }> = [];

  for (const asset of assets) {
    try {
      let dataUrl: string;

      if (asset.type === 'image' && asset.data instanceof HTMLImageElement) {
        // Convert image to canvas then to data URL
        const canvas = document.createElement('canvas');
        canvas.width = asset.data.width;
        canvas.height = asset.data.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(asset.data, 0, 0);
          dataUrl = canvas.toDataURL('image/png');
        } else {
          dataUrl = asset.data.src;
        }
      } else if (asset.type === 'json') {
        dataUrl = `data:application/json;base64,${btoa(JSON.stringify(asset.data))}`;
      } else if (asset.type === 'text') {
        dataUrl = `data:text/plain;base64,${btoa(asset.data)}`;
      } else {
        // For other types, try to fetch and convert
        const response = await fetch(asset.path);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        dataUrl = `data:${blob.type};base64,${base64}`;
      }

      embedded.push({
        id: asset.id,
        path: asset.path,
        dataUrl,
        type: asset.type
      });
    } catch (error) {
      console.warn(`Failed to embed asset ${asset.path}:`, error);
    }
  }

  return embedded;
}

/**
 * Export graph as single HTML file with embedded assets
 */
export async function exportSingleHTML(graph: Graph, projectName: string = 'Cascade Project'): Promise<string> {
  // Get all assets from asset manager
  const assets = graph.assetManager.list();
  
  // Embed assets
  const embeddedAssets = await embedAssets(assets);

  // Compile graph
  const compiledGraph = compileGraph(graph);

  // Generate runtime (minimal version)
  const runtime = getMinimalRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #0a0a0a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #cascade-root {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="cascade-root"></div>
  
  <script>
    // Minimal Cascade Runtime
    ${runtime}
    
    // Embedded assets
    const ASSETS = ${JSON.stringify(embeddedAssets, null, 2)};
    
    // Override fetch for asset loading
    const originalFetch = window.fetch;
    window.fetch = function(url) {
      const asset = ASSETS.find(a => url.includes(a.path) || url.includes(a.id));
      if (asset) {
        return Promise.resolve(new Response(
          dataUrlToBlob(asset.dataUrl)
        ));
      }
      return originalFetch.apply(this, arguments);
    };
    
    // Helper function
    function dataUrlToBlob(dataUrl) {
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    }
    
    // Compiled graph
    ${compiledGraph}
    
    // Start execution
    Cascade.run(graphData, document.getElementById('cascade-root'));
  </script>
</body>
</html>`;
}

/**
 * Get minimal runtime code
 */
function getMinimalRuntime(): string {
  return `
(function() {
  'use strict';
  
  class CascadeRuntime {
    static run(graphData, container) {
      const graph = this.buildGraph(graphData);
      
      // Find entry points and start execution
      const entryNodes = graphData.entryPoints
        .map(id => graph.nodes.find(e => e.id === id))
        .filter(Boolean);
      
      entryNodes.forEach(node => {
        graph.execute(node);
      });
      
      // Mount scene container
      if (container && graph.sceneContainer) {
        container.appendChild(graph.sceneContainer);
      }
    }
    
    static buildGraph(graphData) {
      // Minimal Node class
      class Node {
        constructor(id, type) {
          this.id = id;
          this.kind = 'computation';
          this.type = type;
          this.inputs = [];
          this.outputs = [];
          this.position = { x: 0, y: 0 };
          this.code = '';
        }
        
        in(name, defaultValue, options = {}) {
          const port = {
            id: this.id + '_in_' + name,
            name,
            portType: name === 'trigger' ? 'trigger' : 'param',
            dataType: options.type || 'any',
            value: defaultValue,
            defaultValue,
            options,
            connections: []
          };
          this.inputs.push(port);
          return port;
        }
        
        out(name, portType = 'param') {
          const port = {
            id: this.id + '_out_' + name,
            name,
            portType,
            dataType: 'any',
            value: undefined,
            connections: [],
            setValue: (value) => {
              port.value = value;
              port.connections.forEach(conn => {
                const targetNode = graph.nodes.find(e => e.id === conn.to.nodeId);
                if (targetNode) {
                  const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
                  if (targetPort) {
                    targetPort.value = value;
                    if (targetPort.onChange) targetPort.onChange(value);
                  }
                }
              });
            },
            trigger: (props) => {
              port.connections.forEach(conn => {
                const targetNode = graph.nodes.find(e => e.id === conn.to.nodeId);
                if (targetNode) {
                  const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
                  if (targetPort && targetPort.onTrigger) {
                    targetPort.onTrigger(props);
                  }
                }
              });
            }
          };
          this.outputs.push(port);
          return port;
        }
        
        setFunction(fn) {
          this.nodeFunction = fn;
        }
        
        async execute() {
          if (this.nodeFunction) {
            try {
              await this.nodeFunction(this, graph);
            } catch (err) {
              console.error('Node execution error:', err);
            }
          }
        }
        
        log(...args) {
          console.log('[' + this.id + ']', ...args);
        }
        
        async require(packageName, version) {
          return graph.packageManager.load(packageName, version);
        }
      }
      
      // Minimal PackageManager for runtime
      class PackageManager {
        constructor() {
          this.cache = new Map();
        }
        
        async load(packageName, version = 'latest') {
          const key = packageName + '@' + version;
          if (this.cache.has(key)) {
            return this.cache.get(key);
          }
          
          const versionPart = version === 'latest' ? '' : '@' + version;
          const url = 'https://esm.sh/' + packageName + versionPart;
          
          try {
            const module = await import(url);
            const result = module.default || module;
            this.cache.set(key, result);
            return result;
          } catch (error) {
            throw new Error('Failed to load package ' + key + ': ' + error.message);
          }
        }
      }
      
      // Minimal Graph class
      class Graph {
        constructor() {
          this.nodes = [];
          this.connections = [];
          this.sceneContainer = document.createElement('div');
          this.sceneContainer.id = 'cascade-scene';
          this.sceneContainer.style.width = '100%';
          this.sceneContainer.style.height = '100%';
          this.packageManager = new PackageManager();
        }
        
        addNode(type, position) {
          const id = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          const node = new Node(id, type);
          node.position = position;
          this.nodes.push(node);
          return node;
        }
        
        getNode(nodeId) {
          return this.nodes.find(n => n.id === nodeId) || null;
        }
        
        connect(fromPort, toPort) {
          // Parse port IDs to extract element IDs and indices
          const fromParts = fromPort.id.split('_');
          const toParts = toPort.id.split('_');
          const fromElementId = fromParts.slice(0, -2).join('_');
          const toElementId = toParts.slice(0, -2).join('_');
          
          const connection = {
            id: 'conn_' + Date.now(),
            from: { nodeId: fromElementId, portId: fromPort.id },
            to: { nodeId: toElementId, portId: toPort.id },
            type: fromPort.portType
          };
          this.connections.push(connection);
          fromPort.connections.push(connection);
          toPort.connections.push(connection);
          return connection;
        }
        
        execute(entryNode) {
          if (entryNode) {
            entryNode.execute();
          } else {
            this.nodes.forEach(node => {
              if (node.inputs.every(p => p.connections.length === 0)) {
                node.execute();
              }
            });
          }
        }
      }
      
      const graph = new Graph();
      
      // Create nodes
      graphData.nodes.forEach(nodeData => {
        const node = graph.addNode(nodeData.type, nodeData.position);
        node.id = nodeData.id;
        node.code = nodeData.code || '';
        
        // Restore ports
        nodeData.inputs.forEach(portData => {
          const port = node.in(portData.name, portData.defaultValue, { type: portData.dataType });
          port.id = portData.id;
          port.value = portData.value;
        });
        
        nodeData.outputs.forEach(portData => {
          const port = node.out(portData.name, portData.portType);
          port.id = portData.id;
          port.value = portData.value;
        });
        
        // Compile and set function if code exists
        if (node.code) {
          try {
            // Wrap code in async function to support top-level await
            const wrappedCode = 'return (async function(node, graph) {\n' + node.code + '\n})(node, graph);';
            const nodeFunction = new Function('node', 'graph', wrappedCode);
            node.setFunction(nodeFunction);
          } catch (err) {
            console.warn('Failed to compile node ' + node.id + ':', err);
          }
        }
      });
      
      // Restore connections
      graphData.connections.forEach(connData => {
        const fromNode = graph.getNode(connData.from.nodeId);
        const toNode = graph.getNode(connData.to.nodeId);
        if (fromNode && toNode) {
          const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
          const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
          if (fromPort && toPort) {
            graph.connect(fromPort, toPort);
          }
        }
      });
      
      return graph;
    }
  }
  
  // Export to global
  window.Cascade = CascadeRuntime;
})();
  `.trim();
}

/**
 * Download file as blob
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/html') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export graph as folder structure (HTML + assets)
 */
export async function exportFolder(graph: Graph, projectName: string = 'Cascade Project'): Promise<void> {
  // Get all assets from asset manager
  const assets = graph.assetManager.list();
  
  // Compile graph
  const compiledGraph = compileGraph(graph);
  
  // Generate runtime
  const runtime = getMinimalRuntime();
  
  // Create HTML file
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #0a0a0a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #cascade-root {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="cascade-root"></div>
  
  <script src="./runtime.js"></script>
  <script src="./graph.js"></script>
  <script>
    // Start execution
    Cascade.run(graphData, document.getElementById('cascade-root'));
  </script>
</body>
</html>`;
  
  // Create runtime.js
  const runtimeJs = `// Minimal Cascade Runtime
${runtime}`;
  
  // Create graph.js
  const graphJs = `// Compiled graph
${compiledGraph}`;
  
  // Create assets manifest
  const assetsManifest = JSON.stringify(assets.map(asset => ({
    id: asset.id,
    path: asset.path,
    type: asset.type,
    size: asset.size
  })), null, 2);
  
  // Download files as ZIP would require a library, so we'll download them individually
  // For now, we'll create a simple approach: download the main files
  // In a real implementation, you'd use JSZip or similar
  
  // Download HTML
  downloadFile(html, 'index.html', 'text/html');
  
  // Download runtime.js
  setTimeout(() => {
    downloadFile(runtimeJs, 'runtime.js', 'application/javascript');
  }, 100);
  
  // Download graph.js
  setTimeout(() => {
    downloadFile(graphJs, 'graph.js', 'application/javascript');
  }, 200);
  
  // Download assets manifest
  setTimeout(() => {
    downloadFile(assetsManifest, 'assets.json', 'application/json');
  }, 300);
  
  // Note: Individual asset files would need to be downloaded separately
  // or packaged in a ZIP. For now, we provide the manifest.
  console.log('Folder export initiated. Download the files and organize them in a folder structure:');
  console.log('- index.html');
  console.log('- runtime.js');
  console.log('- graph.js');
  console.log('- assets.json');
  console.log('- assets/ (create this folder and add your asset files)');
}

