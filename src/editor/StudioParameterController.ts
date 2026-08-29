import type { Node } from '@/nodes/Node';

/** One mutation path for Inspector controls and project panels. */
export function setStudioParameter(
  node: Node | null | undefined,
  name: string,
  value: any,
  recordHistory?: () => void,
): void {
  const parameter = node?.parameters.find(candidate => candidate.name === name);
  if (!node || !parameter) throw new Error(`Unknown parameter ${node?.id ?? '<missing>'}.${name}`);
  recordHistory?.();
  node.setParameter(name, value);
}
