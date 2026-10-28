import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PREVIEW_CLIENT_ID } from "./preview.ts";
import { assertProductionAuth, resolveAuthSurface } from "./runtime.ts";

const PREVIEW_SECRET = "sandbox-secret";

function closed(env: Record<string, string | undefined>) {
  const surface = resolveAuthSurface(env);
  assert.equal(surface.sandbox, false);
  assert.equal(surface.clientId, undefined);
  assert.equal(surface.clientSecret, undefined);
  assert.equal(
    surface.trustedOrigins.some((origin) => origin.includes("grok-sandbox.com")),
    false,
  );
  assert.match(surface.failure ?? "", /Refusing to start auth outside the Grok sandbox/);
  assert.throws(() => assertProductionAuth(env), /Refusing to start auth outside the Grok sandbox/);
}

describe("auth startup outside the Grok sandbox", () => {
  it("treats NODE_ENV=production as production even with a preview secret and no project id", () => {
    closed({
      NODE_ENV: "production",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
  });

  it("treats VERCEL_ENV=production as production even when NODE_ENV is development", () => {
    closed({
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
  });

  it("treats VERCEL=1 as production", () => {
    closed({
      NODE_ENV: "development",
      VERCEL: "1",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
  });

  it("treats GROK_PROJECT_ID as production and ignores the preview secret", () => {
    closed({
      NODE_ENV: "development",
      GROK_PROJECT_ID: "proj-123",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
  });

  it("refuses VITE_AUTH_ENABLED=false outside the sandbox even when the other settings exist", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VITE_AUTH_ENABLED: "false",
      GROK_AUTH_CLIENT_ID: "app-client",
      GROK_AUTH_CLIENT_SECRET: "app-secret",
      BETTER_AUTH_SECRET: "signing-secret",
      BETTER_AUTH_URL: "https://service.example",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    };
    const surface = resolveAuthSurface(env);
    assert.equal(surface.sandbox, false);
    assert.equal(surface.clientId, "app-client");
    assert.equal(surface.clientSecret, "app-secret");
    assert.deepEqual(surface.trustedOrigins, ["https://service.example"]);
    assert.match(surface.failure ?? "", /VITE_AUTH_ENABLED=false/);
    assert.throws(() => assertProductionAuth(env), /VITE_AUTH_ENABLED=false/);
  });

  it("starts a configured production app without the preview client or sandbox origins", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      GROK_AUTH_CLIENT_ID: "app-client",
      GROK_AUTH_CLIENT_SECRET: "app-secret",
      BETTER_AUTH_SECRET: "signing-secret",
      BETTER_AUTH_URL: "https://service.example",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    };
    const surface = resolveAuthSurface(env);
    assert.equal(surface.sandbox, false);
    assert.equal(surface.failure, null);
    assert.equal(surface.clientId, "app-client");
    assert.equal(surface.clientSecret, "app-secret");
    assert.equal(surface.authSecret, "signing-secret");
    assert.deepEqual(surface.trustedOrigins, ["https://service.example"]);
    assert.equal(surface.baseURL, "https://service.example");
    assert.doesNotThrow(() => assertProductionAuth(env));
  });

  it("does not treat an unset NODE_ENV as the sandbox", () => {
    closed({ GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET });
  });
});

describe("auth startup in the Grok sandbox", () => {
  it("does not treat NODE_ENV=development as the sandbox", () => {
    closed({
      NODE_ENV: "development",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
      HOST: "shop-pc.local",
    });
  });

  it("uses the preview client only when a Grok preview host is set", () => {
    const surface = resolveAuthSurface({
      NODE_ENV: "development",
      GROK_PREVIEW_HOST: "https://abc.grok-sandbox.com",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
    assert.equal(surface.sandbox, true);
    assert.equal(surface.failure, null);
    assert.equal(surface.clientId, PREVIEW_CLIENT_ID);
    assert.equal(surface.clientSecret, PREVIEW_SECRET);
    assert.ok(surface.trustedOrigins.includes("*.grok-sandbox.com"));
    assert.ok(surface.trustedOrigins.includes("https://*.grok-sandbox.com"));
    assert.doesNotThrow(() =>
      assertProductionAuth({
        NODE_ENV: "development",
        GROK_PREVIEW_HOST: "abc.grok-sandbox.com",
        GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
      }),
    );
  });

  it("accepts the path-based preview hosts and rejects the same host on Vercel", () => {
    const marked = resolveAuthSurface({
      NODE_ENV: "development",
      GROK_SANDBOX_HOST: "preview.grok.mil",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
    assert.equal(marked.sandbox, true);
    assert.equal(marked.clientId, PREVIEW_CLIENT_ID);
    closed({
      NODE_ENV: "development",
      VERCEL: "1",
      GROK_PREVIEW_HOST: "abc.grok-sandbox.com",
      GROK_PREVIEW_CLIENT_SECRET: PREVIEW_SECRET,
    });
  });
});
