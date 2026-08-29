/**
 * Renderers for values that deserve more than a one-line summary.
 *
 * Core Svelte renderers and project-owned DOM renderers share this lookup, but
 * keep separate lifecycles. Project implementations stay in their repository.
 */
import type { Component } from 'svelte';
import ProjectValueRendererHost from './ProjectValueRendererHost.svelte';

export interface RendererProps {
  value: any;
  port: any;
  readOnly: boolean;
  mode?: 'compact' | 'inspect' | 'view';
  onChange?: (value: any) => void;
}

type RendererComponent = Component<any>;
export type TypeRendererEntry =
  | { kind: 'svelte'; component: RendererComponent }
  | { kind: 'project'; component: typeof ProjectValueRendererHost; panelName: string; rendererType: string };

const renderers = new Map<string, TypeRendererEntry>();

export function registerTypeRenderer(type: string, component: RendererComponent): void {
  renderers.set(type, { kind: 'svelte', component });
}

export function registerProjectTypeRenderer(type: string, panelName: string): void {
  renderers.set(type, { kind: 'project', component: ProjectValueRendererHost, panelName, rendererType: type });
}

export function typeRenderer(type: string | undefined): TypeRendererEntry | null {
  if (!type) return null;
  return renderers.get(type) ?? null;
}

export function hasTypeRenderer(type: string | undefined): boolean {
  return Boolean(type && renderers.has(type));
}
