/**
 * Renderers for values that deserve more than a one-line summary.
 *
 * Keyed by type name, so adding one is registering a component rather than
 * editing a chain of conditionals inside the Inspector. Cascade registers the
 * core types here; namespaced project types register alongside them.
 *
 * The seam is deliberate and not yet finished: these are compiled into Cascade,
 * so a project can't ship its own renderer without a build. The registry is what
 * makes that a later change to ONE file rather than a rewrite — a project
 * manifest naming a component is the obvious next step.
 */
import type { ComponentType } from 'svelte';

export interface RendererProps {
  value: any;
  port: any;
  readOnly: boolean;
  mode?: 'compact' | 'inspect' | 'view';
  onChange?: (value: any) => void;
}

const renderers = new Map<string, ComponentType>();

export function registerTypeRenderer(type: string, component: ComponentType): void {
  renderers.set(type, component);
}

export function typeRenderer(type: string | undefined): ComponentType | null {
  if (!type) return null;
  return renderers.get(type) ?? null;
}

export function hasTypeRenderer(type: string | undefined): boolean {
  return Boolean(type && renderers.has(type));
}
