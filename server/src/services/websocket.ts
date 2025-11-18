import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import path from 'path';
import { promises as fs } from 'fs';

const PROJECTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', 'cascade-projects');

interface WSEvent {
  type: 'file-changed' | 'graph-updated' | 'asset-added' | 'asset-removed';
  projectId: string;
  data: any;
}

export function setupWebSocket(wss: WebSocketServer) {
  const clients = new Set<WebSocket>();
  const watchers = new Map<string, chokidar.FSWatcher>();
  
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    console.log('WebSocket client connected');
    
    ws.on('close', () => {
      clients.delete(ws);
      console.log('WebSocket client disconnected');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
  
  // Watch project directories for file changes
  async function watchProject(projectId: string) {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    
    if (watchers.has(projectId)) {
      return; // Already watching
    }
    
    try {
      const watcher = chokidar.watch(projectPath, {
        ignored: /node_modules/,
        persistent: true
      });
      
      watcher.on('change', async (filePath) => {
        const relativePath = path.relative(projectPath, filePath);
        
        // Determine event type
        let eventType: WSEvent['type'] = 'file-changed';
        if (relativePath === 'graph.cascade.json') {
          eventType = 'graph-updated';
        } else if (relativePath.startsWith('assets/')) {
          eventType = 'asset-added';
        }
        
        // Broadcast to all clients
        const event: WSEvent = {
          type: eventType,
          projectId,
          data: { path: relativePath }
        };
        
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(event));
          }
        });
      });
      
      watchers.set(projectId, watcher);
    } catch (error) {
      console.error(`Failed to watch project ${projectId}:`, error);
    }
  }
  
  // Watch all existing projects
  async function watchAllProjects() {
    try {
      const projects = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
      projects
        .filter(dirent => dirent.isDirectory())
        .forEach(dirent => {
          watchProject(dirent.name);
        });
    } catch (error) {
      console.error('Failed to watch projects:', error);
    }
  }
  
  // Start watching
  watchAllProjects();
  
  // Cleanup on server shutdown
  process.on('SIGINT', () => {
    watchers.forEach(watcher => watcher.close());
    wss.close();
  });
}

