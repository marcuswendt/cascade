import type { NodeDefinition, NodeExecute } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";
import { equalsDefinition, notBlankDefinition, rangeDefinition, trueDefinition } from "./definitions.js";

/**
 * `cascade.assert.*`: nodes that fail a run.
 *
 * An agent checking its own render used to do it outside the graph (a QR code
 * scanned by a separate script, a blank frame noticed by eye). An assertion
 * node puts the check in the graph: when it does not hold, the node throws,
 * the run fails with a non-zero exit, and `run --json` carries the message,
 * `{ ok: false, error: { message: "Assertion failed in \"…\" …" } }`.
 *
 * Each passes its input through, so an assertion can sit inline and is cooked
 * whenever what is downstream of it is. An unconsumed `NotBlank` is not saved
 * as an image output (`src/cli/imageOutputs.ts` skips this namespace).
 *
 * Portable since 2026-11-07, so Studio registers them too: `NotBlank` takes the
 * host's in-memory pixels when it has them and otherwise decodes the PNG (or
 * PPM) with the realm's `DecompressionStream` rather than `node:zlib`. The
 * declarations are in `definitions.ts` and the bodies in `checks.ts`, behind a
 * dynamic import, because this list is in Studio's first-paint bundle.
 */
export const ASSERT_NAMESPACE = "cascade.assert.";

export * from "./definitions.js";

function lazy<D extends NodeDefinition>(
  name: string,
  definition: D,
  load: () => Promise<NodeExecute<D>>,
): DefinitionNodeRegistration<D> {
  return { kind: "definition-v1", moduleId: `${ASSERT_NAMESPACE}${name}`, definition, loadExecute: load };
}

export const rangeRegistration = lazy("Range", rangeDefinition, async () => (await import("./checks.js")).executeRange);
export const equalsRegistration = lazy("Equals", equalsDefinition, async () => (await import("./checks.js")).executeEquals);
export const trueRegistration = lazy("True", trueDefinition, async () => (await import("./checks.js")).executeTrue);
export const notBlankRegistration = lazy("NotBlank", notBlankDefinition, async () => (await import("./checks.js")).executeNotBlank);

export const assertNodeRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  equalsRegistration,
  notBlankRegistration,
  rangeRegistration,
  trueRegistration,
] as DefinitionNodeRegistration[]);
