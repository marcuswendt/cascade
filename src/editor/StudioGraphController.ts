import type { Graph } from '@/nodes/Graph';
import { bumpGraphStructure } from './stores/graphStructure';

export interface StructureRefresh {
  connections?: boolean;
  elements?: boolean;
  nodes?: boolean;
}

const CONNECTIONS: StructureRefresh = { connections: true };
const ALL_STRUCTURE: StructureRefresh = { connections: true, elements: true, nodes: true };

/**
 * The Studio's reactive boundary around mutable Graph operations.
 *
 * Graph owns structure and invariants; this class only publishes completed
 * mutations to Svelte. Keeping that publication in one place prevents editor
 * call sites from cloning arrays and bumping stores in subtly different ways.
 */
export class StudioGraphController {
  constructor(
    private readonly resolveGraph: () => Graph | undefined,
    private readonly invalidate: () => void = bumpGraphStructure
  ) {}

  restoreConnections(): boolean {
    const graph = this.resolveGraph();
    if (!graph) return false;

    graph.restoreConnections();
    this.publish(graph, { connections: true, elements: true });
    return true;
  }

  connect(fromPort: any, toPort: any) {
    const graph = this.requireGraph();
    const connection = graph.connect(fromPort, toPort);
    this.publish(graph, CONNECTIONS);
    return connection;
  }

  disconnect(connectionId: string): boolean {
    const graph = this.resolveGraph();
    if (!graph) return false;

    graph.disconnect(connectionId);
    this.publish(graph, CONNECTIONS);
    return true;
  }

  disconnectMany(connectionIds: Iterable<string>): boolean {
    const graph = this.resolveGraph();
    if (!graph) return false;

    for (const connectionId of connectionIds) graph.disconnect(connectionId);
    this.publish(graph, CONNECTIONS);
    return true;
  }

  renameElement(oldId: string, newId: string): boolean {
    const graph = this.resolveGraph();
    if (!graph || !graph.renameElement(oldId, newId)) return false;

    this.publish(graph, ALL_STRUCTURE);
    return true;
  }

  removeElement(id: string): boolean {
    const graph = this.resolveGraph();
    if (!graph || !graph.getElement(id)) return false;

    graph.removeElement(id);
    this.publish(graph, ALL_STRUCTURE);
    return true;
  }

  reparentElement(elementId: string, parentId: string | null): boolean {
    const graph = this.resolveGraph();
    const element = graph?.getElement(elementId);
    const parent = parentId ? graph?.getNode(parentId) ?? null : null;
    if (!graph || !element || (parentId && !parent)) return false;
    if (!graph.reparentElement(element, parent)) return false;

    this.publish(graph, { elements: true, nodes: true });
    return true;
  }

  refresh(changed: StructureRefresh = ALL_STRUCTURE): boolean {
    const graph = this.resolveGraph();
    if (!graph) return false;

    this.publish(graph, changed);
    return true;
  }

  private requireGraph(): Graph {
    const graph = this.resolveGraph();
    if (!graph) throw new Error('No graph is loaded');
    return graph;
  }

  private publish(graph: Graph, changed: StructureRefresh): void {
    if (changed.connections) graph.connections = [...graph.connections];
    if (changed.elements) graph.elements = [...graph.elements];
    if (changed.nodes) graph.nodes = [...graph.nodes];
    this.invalidate();
  }
}
