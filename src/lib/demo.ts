/**
 * Sample customers, repair orders, and scorecard months are off unless this
 * is on. Set `VITE_DEMO_MODE` to `1`, `true`, `yes`, or `on`, or load the
 * sample month from Settings. Only `VITE_` variables reach the browser.
 */
export function isDemoMode(flag?: string): boolean {
  const raw = flag !== undefined ? flag : readDemoEnv();
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function readDemoEnv(): string {
  const env = import.meta.env as { VITE_DEMO_MODE?: string } | undefined;
  const value = env?.VITE_DEMO_MODE;
  return typeof value === "string" ? value : "";
}
