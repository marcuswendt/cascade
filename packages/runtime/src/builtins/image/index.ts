import type { DefinitionNodeRegistration } from "../../types.js";
import { contactSheetRegistration } from "./contactSheet.js";

/**
 * The definition-v1 image nodes. One so far: the contact sheet a ladder of
 * variants is judged on. Studio's `cascade.image.*` library (src/nodes/image)
 * is the compatibility engine's and is not listed here.
 */
export {
  composeContactSheet,
  contactSheetDefinition,
  contactSheetLayout,
  contactSheetRegistration,
  executeContactSheet,
  type ContactSheetOptions,
  type SheetLayout,
} from "./contactSheet.js";

export const imageNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([contactSheetRegistration]);
