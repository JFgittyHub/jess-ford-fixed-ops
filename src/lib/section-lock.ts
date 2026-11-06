import { devOverridesAllowed } from "./dev-overrides";

/**
 * Brandon, Nov 2, 2026, 10:48 AM: Repair estimates is grayed out with the
 * other locked sections. Pulse, Appointments, Overrides, and Repair orders stay open.
 */
export const SECTION_LOCK_ENABLED = true;

export const LOCKED_SECTIONS = [
  "/estimates",
  "/dispatch",
  "/tech-board",
  "/advisors",
  "/service-managers",
  "/parts",
  "/expenses",
  "/customers",
  "/reports",
  "/labor-ops",
  "/pay-types",
  "/fees",
] as const;

export const SECTION_LOCK_NOTICE = "This section is coming later";
export const SECTION_LOCK_HINT = "Coming later";

function flagEnabled() {
  if (!devOverridesAllowed()) return SECTION_LOCK_ENABLED;
  const override = (globalThis as { __SECTION_LOCK_ENABLED__?: boolean }).__SECTION_LOCK_ENABLED__;
  return typeof override === "boolean" ? override : SECTION_LOCK_ENABLED;
}

export function sectionLockEnabled() {
  return flagEnabled();
}

/**
 * Decode, lowercase, collapse repeated slashes, and drop the trailing slash,
 * query, and hash. `/Fees`, `/%46ees`, `//Fees`, and `/Fees?x=1` all match.
 */
export function normalizeDeskPath(path: string) {
  let clean = path.split("?")[0]?.split("#")[0] ?? "";
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* Keep a path that is not valid encoding. */
  }
  clean = clean.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  return clean;
}

/** A locked path, including any sub-route under it. */
export function isLockedPath(path: string) {
  if (!flagEnabled()) return false;
  const clean = normalizeDeskPath(path);
  return LOCKED_SECTIONS.some((locked) => clean === locked || clean.startsWith(`${locked}/`));
}

/** Lowercase and decoded, keeping a path-based preview prefix intact. */
export function canonicalDeskPath(pathname: string) {
  const prefix = /^\/hds-[A-Za-z0-9]+-\d+-[A-Za-z0-9]+(?=\/|$)/.exec(pathname)?.[0] ?? "";
  const rest = prefix ? pathname.slice(prefix.length) || "/" : pathname;
  const normalized = normalizeDeskPath(rest);
  if (!prefix) return normalized;
  return normalized === "/" ? prefix : `${prefix}${normalized}`;
}
