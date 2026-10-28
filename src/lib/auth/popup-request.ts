/**
 * Build the request the dev-server auth popup forwards to Better Auth.
 *
 * The host header is only the popup's own URL. Sandbox detection reads
 * `GROK_PREVIEW_HOST` or `GROK_SANDBOX_HOST` from the process environment the
 * platform set. This function must not write either of those.
 */
export function createAuthPopupRequest(
  headers: Record<string, string | string[] | undefined>,
  rawUrl: string,
  socketEncrypted = false,
): Request {
  const host = String(headers["x-forwarded-host"] ?? headers.host ?? "localhost:8080");
  const proto = String(headers["x-forwarded-proto"] ?? (socketEncrypted ? "https" : "http"));
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) requestHeaders.append(key, entry);
    } else {
      requestHeaders.set(key, value);
    }
  }
  if (!requestHeaders.has("host")) requestHeaders.set("host", host);
  return new Request(`${proto}://${host}${rawUrl}`, {
    method: "GET",
    headers: requestHeaders,
  });
}
