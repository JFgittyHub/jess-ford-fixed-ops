/** Global flag overrides are for dev and tests. Production builds ignore them. */
export function devOverridesAllowed() {
  try {
    const env = import.meta.env as { DEV?: boolean; PROD?: boolean } | undefined;
    if (env?.PROD) return false;
    if (env?.DEV) return true;
  } catch {
    /* The test runner is not Vite. */
  }
  return typeof process === "undefined" || process.env.NODE_ENV !== "production";
}
