import { devOverridesAllowed } from "./dev-overrides";

/**
 * This build reflects repair orders from Dealertrack. It does not create them
 * and it does not change them. Scheduling, staff setup, and store settings stay
 * editable. Turn a flag back on when that piece of Dealertrack write-back exists.
 */
export const RO_CREATION_ENABLED = false;
export const RO_WRITES_ENABLED = false;

export const RO_CREATE_REFUSAL = "Repair orders are created in Dealertrack, not in this build.";
export const RO_WRITE_REFUSAL = "Read-only — repair orders come from Dealertrack.";

type FlagName = "__RO_CREATION_ENABLED__" | "__RO_WRITES_ENABLED__";

function flag(name: FlagName, fallback: boolean) {
  if (!devOverridesAllowed()) return fallback;
  const override = (globalThis as Record<string, unknown>)[name];
  return typeof override === "boolean" ? override : fallback;
}

export function roCreationEnabled() {
  return flag("__RO_CREATION_ENABLED__", RO_CREATION_ENABLED);
}

export function roWritesEnabled() {
  return flag("__RO_WRITES_ENABLED__", RO_WRITES_ENABLED);
}
