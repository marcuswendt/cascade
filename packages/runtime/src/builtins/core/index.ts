import type { DefinitionNodeRegistration } from "../../types.js";
import { packRegistration, pickRegistration } from "./bundle.js";
import { cameraRegistration } from "./camera.js";
import { randomRegistration } from "./random.js";
import { remapRegistration } from "./remap.js";
import { frozenRegistration, mergeRegistration, nullRegistration, selectRegistration, switchRegistration } from "./routing.js";
import {
  feedbackRegistration,
  inputRegistration,
  outputRegistration,
  previousRegistration,
  subnetRegistration,
} from "./structural.js";
import { timeRegistration } from "./time.js";

export {
  cameraRegistration,
  feedbackRegistration,
  frozenRegistration,
  previousRegistration,
  inputRegistration,
  mergeRegistration,
  nullRegistration,
  outputRegistration,
  packRegistration,
  pickRegistration,
  randomRegistration,
  remapRegistration,
  selectRegistration,
  subnetRegistration,
  switchRegistration,
  timeRegistration,
};

export const coreNodeRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  subnetRegistration,
  inputRegistration,
  outputRegistration,
  switchRegistration,
  mergeRegistration,
  nullRegistration,
  selectRegistration,
  pickRegistration,
  packRegistration,
  randomRegistration,
  remapRegistration,
  cameraRegistration,
  timeRegistration,
  feedbackRegistration,
  previousRegistration,
  frozenRegistration,
]);

const registrationsById = new Map(
  coreNodeRegistrations.map((registration) => [registration.moduleId, registration]),
);

export function coreNodeRegistration(moduleId: string): DefinitionNodeRegistration | undefined {
  return registrationsById.get(moduleId);
}
