/**
 * The `cascade.core.*` nodes authored as definition-v1, registered for Studio.
 *
 * Marcus hit the gap this closes: *"Failed to load default graph: Unknown
 * Cascade node type: cascade.core.Time"*. `geo` and `pop` both call
 * `registerDefinitionNodes`; `core` never did, because when the adapter was
 * written every core node was a hand-written class. Four are not.
 *
 * **`cascade.core.Camera` had the same fault from the day it was written**, and
 * nothing caught it: it exists, it typechecks, it has tests, and no saved graph
 * had used it in Studio yet. A capability that is present but not reachable —
 * the shape this project keeps rediscovering.
 *
 * Only the four are listed. Switch, Merge, Subnet, Input, Output, Random,
 * Remap, Select, Null and Freeze are class-based in Studio and those classes
 * are what every saved graph resolves to; handing the same names to the adapter
 * would swap a working implementation for an untested one.
 */
import {
  cameraRegistration,
  feedbackRegistration,
  previousRegistration,
  timeRegistration,
} from '../../../packages/runtime/src/builtins/core/index.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

registerDefinitionNodes([
  cameraRegistration,
  timeRegistration,
  feedbackRegistration,
  previousRegistration,
]);
