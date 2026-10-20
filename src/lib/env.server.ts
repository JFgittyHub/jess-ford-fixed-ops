export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function readEnv(source: Record<string, string | undefined>, key: string): string | undefined {
  const value = source[key]?.trim();
  return value ? value : undefined;
}

/**
 * Hosts the Grok app builder uses for a live preview. `*.grok-sandbox.com` is
 * the iframe preview. The other three are the path-based preview fronts in
 * `preview-path-prefix.ts`. This workspace's dev process sets none of them:
 * no `GROK_*` variable and no sandbox marker file is present, and `npm run dev`
 * only makes `NODE_ENV` development inside Vite. A shop PC looks the same, so
 * development mode alone is not the sandbox. Request headers, including
 * `X-Forwarded-Host`, are not a marker.
 */
const SANDBOX_PREVIEW_HOSTS = new Set([
  "grok-sandbox.com",
  "preview.grok.genai.mil",
  "preview.grok.mil",
  "preview.grokgsac.com",
]);

/** Env vars that may carry the preview host. The preview secret is not one of them. */
export const SANDBOX_HOST_ENV_KEYS = ["GROK_PREVIEW_HOST", "GROK_SANDBOX_HOST"] as const;

/** True when `value` is a Grok live-preview host, with or without a scheme or port. */
export function isSandboxPreviewHost(value: string): boolean {
  let host = value.trim().toLowerCase();
  if (!host) return false;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return false;
    }
  }
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end > 0 ? host.slice(1, end) : host;
  } else if (host.includes(":")) {
    host = host.slice(0, host.indexOf(":"));
  }
  if (!host) return false;
  if (SANDBOX_PREVIEW_HOSTS.has(host)) return true;
  return host.endsWith(".grok-sandbox.com");
}

function hasSandboxHostMarker(source: Record<string, string | undefined>): boolean {
  return SANDBOX_HOST_ENV_KEYS.some((key) => {
    const value = readEnv(source, key);
    return value ? isSandboxPreviewHost(value) : false;
  });
}

/**
 * True only for the Grok live-preview sandbox.
 *
 * Requires a development process, no Vercel deploy markers, no project id,
 * and a positive preview-host marker. `NODE_ENV=development` by itself is
 * not enough: that is also `npm run dev` on a shop PC. An unset `NODE_ENV`
 * is not a sandbox either.
 */
export function isGrokSandbox(source: Record<string, string | undefined> = process.env): boolean {
  if (readEnv(source, "VERCEL") || readEnv(source, "VERCEL_ENV") || readEnv(source, "GROK_PROJECT_ID")) {
    return false;
  }
  if (source.NODE_ENV !== "development") return false;
  return hasSandboxHostMarker(source);
}

/** Workspace preview vs deployed app. Gate audience and auth both use this. */
export function isWorkspacePreview(): boolean {
  return isGrokSandbox();
}
