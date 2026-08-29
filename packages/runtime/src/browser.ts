import type { BrowserRuntimeHostOptions, RuntimeHost } from "./types.js";

export function createBrowserRuntimeHost(
  options: BrowserRuntimeHostOptions,
): RuntimeHost {
  const {
    modules,
    legacyShell,
    now = () => Date.now(),
    report = () => {},
    ...capabilities
  } = options;
  return {
    environment: "browser",
    modules,
    legacyShell,
    capabilities,
    now,
    report,
  };
}
