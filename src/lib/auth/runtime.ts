import { isGrokSandbox } from "../env.server.ts";
import { PREVIEW_ALLOWED_HOSTS, resolveBrokerClient } from "./preview.ts";

export type AuthEnv = Record<string, string | undefined>;

const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const PRODUCTION_AUTH_KEYS = [
  "GROK_AUTH_CLIENT_ID",
  "GROK_AUTH_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

export function readAuthEnv(env: AuthEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Why auth must not start, or null when this process may continue.
 * The Grok sandbox may run without federated auth. Everywhere else, a missing
 * client, signing secret, or public URL, or an explicit auth-off flag, refuses
 * startup. Callers must not pass a hard-coded deployed flag.
 */
export function productionAuthFailure(env: AuthEnv = process.env): string | null {
  if (isGrokSandbox(env)) return null;
  const problems: string[] = [];
  if (readAuthEnv(env, "VITE_AUTH_ENABLED") === "false") {
    problems.push("VITE_AUTH_ENABLED=false is refused outside the Grok sandbox");
  }
  for (const key of PRODUCTION_AUTH_KEYS) {
    if (!readAuthEnv(env, key)) problems.push(`${key} is required`);
  }
  if (problems.length === 0) return null;
  return `Refusing to start auth outside the Grok sandbox: ${problems.join("; ")}.`;
}

export function assertProductionAuth(env: AuthEnv = process.env): void {
  const failure = productionAuthFailure(env);
  if (failure) throw new Error(failure);
}

export type AuthBaseURL =
  | string
  | {
      allowedHosts: string[];
      protocol: "auto";
      fallback: string;
    };

/** Client, origins, and base URL derived only from the process environment. */
export function resolveAuthSurface(env: AuthEnv = process.env) {
  const sandbox = isGrokSandbox(env);
  const failure = productionAuthFailure(env);
  const client = resolveBrokerClient({
    deployed: !sandbox,
    authClientId: readAuthEnv(env, "GROK_AUTH_CLIENT_ID"),
    authClientSecret: readAuthEnv(env, "GROK_AUTH_CLIENT_SECRET"),
    previewClientSecret: sandbox ? readAuthEnv(env, "GROK_PREVIEW_CLIENT_SECRET") : undefined,
  });
  const explicit = readAuthEnv(env, "BETTER_AUTH_URL");
  const previewHosts = sandbox ? [...PREVIEW_ALLOWED_HOSTS] : [];
  const trustedOrigins = !sandbox
    ? explicit
      ? [explicit]
      : []
    : explicit
      ? [explicit, ...LOCAL_DEV_ORIGINS]
      : [
          ...previewHosts,
          ...previewHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
          ...LOCAL_DEV_ORIGINS,
        ];
  const baseURL: AuthBaseURL = !sandbox
    ? (explicit ?? "")
    : (explicit ?? {
        allowedHosts: [...previewHosts, "localhost", "127.0.0.1", "[::1]"],
        protocol: "auto",
        fallback: "http://localhost:8080",
      });
  return {
    sandbox,
    failure,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    trustedOrigins,
    baseURL,
    authSecret: readAuthEnv(env, "BETTER_AUTH_SECRET"),
  };
}
