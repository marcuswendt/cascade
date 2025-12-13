/**
 * Cascade Global API
 *
 * Module-level functions for node access, time queries, and selection management.
 * Inspired by Houdini's hou module.
 */

import type { Node } from '../nodes/Node.js';
import type { Graph } from '../nodes/Graph.js';
import { expressionEngine } from './expressions/index.js';

/**
 * CascadeContext holds the global state for the cascade API
 */
class CascadeContext {
  private _graph: Graph | null = null;
  private _pwd: Node | null = null;
  private _frame: number = 1;
  private _fps: number = 30;
  private _selectedNodes: Set<string> = new Set();

  // Callback for selection changes (set by editor)
  onSelectionChange?: (nodeIds: string[]) => void;

  /**
   * Initialize with a graph reference
   */
  setGraph(graph: Graph): void {
    this._graph = graph;
    expressionEngine.setGraph(graph);
  }

  /**
   * Get the current graph
   */
  getGraph(): Graph | null {
    return this._graph;
  }

  // ============ Node Access ============

  /**
   * Find a node by path (absolute or relative to pwd)
   */
  node(path: string): Node | null {
    if (!this._graph) return null;

    // Absolute path
    if (path.startsWith('/')) {
      return this.resolveAbsolutePath(path);
    }

    // Relative path from pwd
    if (this._pwd) {
      return this._pwd.node(path);
    }

    // If no pwd, treat as relative from root
    return this.resolveAbsolutePath('/' + path);
  }

  /**
   * Find a parameter by path (e.g., "/node1/radius")
   */
  parm(path: string): ReturnType<Node['parm']> {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) return null;

    const nodePath = path.substring(0, lastSlash) || '/';
    const parmName = path.substring(lastSlash + 1);

    const node = this.node(nodePath);
    return node?.parm(parmName) ?? null;
  }

  /**
   * Get the root node (virtual - returns null, represents "/")
   * In Cascade, root is not a real node but the graph itself
   */
  root(): Node | null {
    // Return null to represent root level
    // Use graph.nodes.filter(n => !n.parent) to get root-level nodes
    return null;
  }

  /**
   * Get current working directory/network
   */
  pwd(): Node | null {
    return this._pwd;
  }

  /**
   * Set current working directory/network
   */
  setPwd(node: Node | null): void {
    this._pwd = node;
  }

  /**
   * Navigate to a path (like cd command)
   */
  cd(path: string): void {
    if (path === '/') {
      this._pwd = null;
      return;
    }

    const target = this.node(path);
    if (target && target.isNetwork()) {
      this._pwd = target;
    }
  }

  // ============ Selection ============

  /**
   * Get all selected nodes
   */
  selectedNodes(): Node[] {
    if (!this._graph) return [];
    return Array.from(this._selectedNodes)
      .map(id => this._graph!.getNode(id))
      .filter((n): n is Node => n !== null);
  }

  /**
   * Get selected node IDs
   */
  selectedNodeIds(): string[] {
    return Array.from(this._selectedNodes);
  }

  /**
   * Set selection (internal use by editor)
   */
  setSelection(nodeIds: string[]): void {
    this._selectedNodes = new Set(nodeIds);
    this.onSelectionChange?.(nodeIds);
  }

  /**
   * Clear all selection
   */
  clearAllSelected(): void {
    this._selectedNodes.clear();
    this.onSelectionChange?.([]);
  }

  // ============ Time/Playback ============

  /**
   * Get current frame number
   */
  frame(): number {
    return this._frame;
  }

  /**
   * Get current time in seconds
   */
  time(): number {
    return this._frame / this._fps;
  }

  /**
   * Get frames per second
   */
  fps(): number {
    return this._fps;
  }

  /**
   * Set current frame
   */
  setFrame(frame: number): void {
    this._frame = Math.max(1, Math.floor(frame));
    expressionEngine.setFrame(this._frame);
  }

  /**
   * Set current time (converts to frame)
   */
  setTime(time: number): void {
    this._frame = Math.max(1, Math.floor(time * this._fps));
    expressionEngine.setFrame(this._frame);
  }

  /**
   * Set FPS
   */
  setFps(fps: number): void {
    this._fps = Math.max(1, fps);
    expressionEngine.setFps(this._fps);
  }

  // ============ Channel Shortcuts ============

  /**
   * Get parameter value as number (shorthand)
   */
  ch(path: string): number {
    const p = this.parm(path);
    return p?.evalAsFloat() ?? 0;
  }

  /**
   * Get parameter value as string (shorthand)
   */
  chs(path: string): string {
    const p = this.parm(path);
    return p?.evalAsString() ?? '';
  }

  /**
   * Get parameter value as vector (shorthand)
   */
  chv(path: string): number[] {
    const p = this.parm(path);
    const val = p?.eval();
    if (Array.isArray(val)) return val;
    if (typeof val === 'number') return [val];
    return [];
  }

  // ============ Time-Dependent Updates ============

  /**
   * Mark all time-dependent nodes as dirty
   * Call this at the start of each frame in the animation loop
   */
  markTimeDependentDirty(): void {
    if (!this._graph) return;
    for (const node of this._graph.nodes) {
      if (node.isTimeDependent) {
        node.markDirty();
      }
    }
  }

  /**
   * Get all time-dependent nodes in the graph
   */
  getTimeDependentNodes(): Node[] {
    if (!this._graph) return [];
    return this._graph.nodes.filter(n => n.isTimeDependent);
  }

  /**
   * Advance to next frame and mark time-dependent nodes dirty
   * Convenience method for animation loops
   */
  nextFrame(): number {
    this.setFrame(this._frame + 1);
    this.markTimeDependentDirty();
    return this._frame;
  }

  // ============ Internal Helpers ============

  private resolveAbsolutePath(path: string): Node | null {
    if (!this._graph) return null;

    // Remove leading slash and split
    const segments = path.replace(/^\//, '').split('/').filter(s => s.length > 0);

    if (segments.length === 0) {
      return null; // Root level
    }

    // Start from root-level nodes
    let current: Node | null = null;
    const rootNodes: Node[] = this._graph.nodes.filter((n: Node) => !n.parent);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const searchIn: Node[] = current ? current.children() : rootNodes;
      const found: Node | undefined = searchIn.find((n: Node) => n.id === segment);

      if (!found) return null;
      current = found;
    }

    return current;
  }
}

// Global singleton instance
export const cascade = new CascadeContext();

// Export the context class for testing
export { CascadeContext };
