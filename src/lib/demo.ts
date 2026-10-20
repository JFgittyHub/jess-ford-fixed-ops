/**
 * Sample customers, repair orders, and scorecard months are off unless this
 * is on. Set `VITE_DEMO_MODE` to the exact string `true` or `1` (spaces around
 * it are ignored). `yes`, `on`, `TRUE`, and every other value stay off.
 * Only `VITE_` variables reach the browser.
 */
export function isExplicitDemoFlag(flag: string | null | undefined): boolean {
  if (typeof flag !== "string") return false;
  const value = flag.trim();
  return value === "true" || value === "1";
}

export function isDemoMode(flag?: string): boolean {
  const raw = flag !== undefined ? flag : readDemoEnv();
  return isExplicitDemoFlag(raw);
}

/**
 * The whole desk, including settings and the staff picker, is open only when
 * demo mode is explicitly confirmed. Phase 2 replaces this with the Entra
 * identity check.
 *
 * Fails closed. Confirmation is the demo flag plus the sample dataset. A
 * development server is not confirmation, and neither is a missing, unreadable,
 * or ambiguous flag. There is no admin bypass.
 */
export function confirmedDemoStaffAccess(input: {
  demoFlag?: string | null;
  dataset?: string | null;
} = {}): boolean {
  const demoFlag = "demoFlag" in input ? input.demoFlag : readDemoFlag();
  if (input.dataset !== "sample") return false;
  return isExplicitDemoFlag(demoFlag);
}

function readDemoEnv(): string {
  const value = readDemoFlag();
  return value ?? "";
}

function readDemoFlag(): string | null {
  try {
    const env = import.meta.env as { VITE_DEMO_MODE?: string } | undefined;
    if (!env) return null;
    return typeof env.VITE_DEMO_MODE === "string" ? env.VITE_DEMO_MODE : null;
  } catch {
    return null;
  }
}
