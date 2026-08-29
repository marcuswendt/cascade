import type { RuntimeHost } from "./types.js";
import type { NodeRuntimeHostOptions } from "./types.js";

export function createNodeRuntimeHost(
  options: NodeRuntimeHostOptions,
): RuntimeHost {
  const {
    modules,
    legacyShell,
    now = () => Date.now(),
    report = () => {},
    ...capabilities
  } = options;
  return {
    environment: "server",
    modules,
    legacyShell,
    capabilities,
    now,
    report,
  };
}
