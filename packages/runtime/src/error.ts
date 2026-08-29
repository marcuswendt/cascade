import type { Diagnostic } from "@cascade/contracts";

export class CascadeRuntimeError extends Error {
  readonly name = "CascadeRuntimeError";
  constructor(
    readonly code: string,
    readonly diagnostics: readonly Diagnostic[],
    message = diagnostics[0]?.message ?? code,
  ) {
    super(message);
  }
}
