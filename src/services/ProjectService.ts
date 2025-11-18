import type { Graph } from '@/core/engine/Graph';

export interface Project {
  id: string;
  name: string;
  created: string;
  modified: string;
  description?: string;
}

export class ProjectService {
  baseURL: string = 'http://localhost:3030';
  wsURL: string = 'ws://localhost:3031';
  private ws: WebSocket | null = null;
  private onHotReloadCallbacks: Function[] = [];
  private onGraphUpdateCallbacks: Function[] = [];
  
  // Project Operations
  async list(): Promise<Project[]> {
    const response = await fetch(`${this.baseURL}/api/projects`);
    if (!response.ok) {
      throw new Error(`Failed to list projects: ${response.statusText}`);
    }
    return response.json();
  }
  
  async create(name: string, description?: string): Promise<Project> {
    const response = await fetch(`${this.baseURL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      throw new Error(`Failed to create project: ${response.statusText}`);
    }
    return response.json();
  }
  
  async load(id: string): Promise<Project> {
    const response = await fetch(`${this.baseURL}/api/projects/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to load project: ${response.statusText}`);
    }
    return response.json();
  }
  
  async delete(id: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/projects/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete project: ${response.statusText}`);
    }
  }
  
  async rename(id: string, name: string, description?: string): Promise<Project> {
    const response = await fetch(`${this.baseURL}/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      throw new Error(`Failed to rename project: ${response.statusText}`);
    }
    return response.json();
  }
  
  // Graph Operations
  async saveGraph(projectId: string, graph: Graph): Promise<void> {
    const graphData = graph.toJSON();
    const response = await fetch(`${this.baseURL}/api/projects/${projectId}/graph`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphData)
    });
    if (!response.ok) {
      throw new Error(`Failed to save graph: ${response.statusText}`);
    }
  }
  
  async loadGraph(projectId: string): Promise<any> {
    const response = await fetch(`${this.baseURL}/api/projects/${projectId}/graph`);
    if (!response.ok) {
      throw new Error(`Failed to load graph: ${response.statusText}`);
    }
    return response.json();
  }
  
  // Asset Operations
  async uploadAsset(projectId: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${this.baseURL}/api/projects/${projectId}/assets`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(`Failed to upload asset: ${response.statusText}`);
    }
    return response.json();
  }
  
  async deleteAsset(projectId: string, assetPath: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/projects/${projectId}/assets/${assetPath}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete asset: ${response.statusText}`);
    }
  }
  
  getAssetUrl(projectId: string, assetPath: string): string {
    return `${this.baseURL}/api/projects/${projectId}/assets/${assetPath}`;
  }
  
  // WebSocket
  connect(): WebSocket {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    
    this.ws = new WebSocket(this.wsURL);
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'file-changed' || data.type === 'asset-added' || data.type === 'asset-removed') {
        this.onHotReloadCallbacks.forEach(callback => {
          try {
            callback(data);
          } catch (err) {
            console.error('Error in hot reload callback:', err);
          }
        });
      }
      
      if (data.type === 'graph-updated') {
        this.onGraphUpdateCallbacks.forEach(callback => {
          try {
            callback(data);
          } catch (err) {
            console.error('Error in graph update callback:', err);
          }
        });
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket closed, reconnecting...');
      setTimeout(() => this.connect(), 3000);
    };
    
    return this.ws;
  }
  
  onHotReload(callback: Function): void {
    this.onHotReloadCallbacks.push(callback);
  }
  
  onGraphUpdate(callback: Function): void {
    this.onGraphUpdateCallbacks.push(callback);
  }
}

