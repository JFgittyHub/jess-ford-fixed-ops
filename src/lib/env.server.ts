export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function readEnv(source: Record<string, string | undefined>, key: string): string | undefined {
  const value = source[key]?.trim();
  return value ? value : undefined;
}

/**
 * True only for the Grok live-preview sandbox.
 *
 * That process is positively a development server, and it is not Vercel and
 * has no deployed project id. A plain Vercel deploy sets `VERCEL` /
 * `VERCEL_ENV`. Any production Node process sets `NODE_ENV=production`.
 * Either one is production even when `GROK_PROJECT_ID` was never injected.
 * An unset `NODE_ENV` is production too: missing config is not a sandbox.
 */
export function isGrokSandbox(source: Record<string, string | undefined> = process.env): boolean {
  if (readEnv(source, "VERCEL") || readEnv(source, "VERCEL_ENV") || readEnv(source, "GROK_PROJECT_ID")) {
    return false;
  }
  return source.NODE_ENV === "development";
}

/** Workspace preview vs deployed app. Gate audience and auth both use this. */
export function isWorkspacePreview(): boolean {
  return isGrokSandbox();
}
