import type {
  DockviewApi,
  SerializedDockview,
  IDockviewPanel
} from 'dockview-core';
import type { Graph } from '@/nodes/Graph';
import type { Node } from '@/nodes/Node';

// Panel type identifiers
export type PanelType = 'graph' | 'inspector' | 'viewer' | 'log' | 'code';

// Parameters passed to each panel
export interface CascadePanelParams {
  id: string;
  type: PanelType;
  title: string;
  // Panel-specific params
  nodeId?: string;      // For inspector/code panels
  graphId?: string;     // For graph panels
}

// Shared context passed to all panels
export interface PanelContext {
  graph: Graph | undefined;
  selectedNode: Node | null;
  selectedAnnotation: string | null;
  activeTool: string;
  activeLibrary: string | null;
  documentName: string;
  presentationMode: boolean;
  onRecordHistory?: () => void;
  onNodeSelect?: (node: Node | null) => void;
  onAnnotationSelect?: (annotationId: string | null) => void;
  onToolChange?: (tool: string) => void;
  onLibraryToggle?: (libraryId: string | null) => void;
  onAction?: (action: string) => void;
  onNameChange?: (name: string) => void;
  onOpenNodePanel?: (position?: { x: number; y: number }) => void;
}

// Store state
export interface DockviewState {
  api: DockviewApi | null;
  activePanel: string | null;
  panels: Map<string, CascadePanelParams>;
  isReady: boolean;
}

// Layout preset
export interface LayoutPreset {
  name: string;
  layout: SerializedDockview;
}

// Panel component props
export interface BasePanelProps {
  panelId: string;
  panelParams: CascadePanelParams;
}

// Extended panel props with dockview API
export interface PanelProps extends BasePanelProps {
  api: IDockviewPanel;
  width: number;
  height: number;
}
