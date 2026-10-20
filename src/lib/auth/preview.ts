/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`).
 *
 * The public client id stays here. The client secret does not: the platform
 * injects `GROK_PREVIEW_CLIENT_SECRET` for the sandbox only. It must equal the
 * broker's `GROK_PREVIEW_CLIENT_SECRET` (the broker stores only
 * `base64url(SHA-256)` of that value). Only a Grok sandbox
 * (`NODE_ENV=development`, and no `VERCEL`, `VERCEL_ENV`, or `GROK_PROJECT_ID`)
 * may use this client. Every other process needs its own `GROK_AUTH_CLIENT_ID`
 * and `GROK_AUTH_CLIENT_SECRET`, and refuses to start without them.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** Sandbox-only secret. Empty when the platform did not inject it. */
export function previewClientSecretFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = env.GROK_PREVIEW_CLIENT_SECRET?.trim();
  return value ? value : undefined;
}

/**
 * Deployed apps take only the per-app client. The preview client is a fallback
 * for a workspace that has no `GROK_PROJECT_ID`, and only when its secret was
 * injected. Never substitute the preview secret in production.
 */
export function resolveBrokerClient(options: {
  deployed: boolean;
  authClientId?: string;
  authClientSecret?: string;
  previewClientSecret?: string;
}): { clientId: string | undefined; clientSecret: string | undefined } {
  if (options.deployed) {
    return {
      clientId: options.authClientId,
      clientSecret: options.authClientSecret,
    };
  }
  return {
    clientId: options.authClientId ?? PREVIEW_CLIENT_ID,
    clientSecret: options.authClientSecret ?? options.previewClientSecret,
  };
}

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
