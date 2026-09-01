import type { DefinitionNodeRegistration } from "../../types.js";
import { randomRegistration } from "./random.js";
import { remapRegistration } from "./remap.js";
import { mergeRegistration, nullRegistration, selectRegistration, switchRegistration } from "./routing.js";
import { inputRegistration, outputRegistration, subnetRegistration } from "./structural.js";

export {
  inputRegistration,
  mergeRegistration,
  nullRegistration,
  outputRegistration,
  randomRegistration,
  remapRegistration,
  selectRegistration,
  subnetRegistration,
  switchRegistration,
};

export const coreNodeRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  subnetRegistration,
  inputRegistration,
  outputRegistration,
  switchRegistration,
  mergeRegistration,
  nullRegistration,
  selectRegistration,
  randomRegistration,
  remapRegistration,
]);

const registrationsById = new Map(
  coreNodeRegistrations.map((registration) => [registration.moduleId, registration]),
);

export function coreNodeRegistration(moduleId: string): DefinitionNodeRegistration | undefined {
  return registrationsById.get(moduleId);
}
