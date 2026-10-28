import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isGrokSandbox } from "../env.server.ts";
import { PREVIEW_CLIENT_ID } from "./preview.ts";
import { createAuthPopupRequest } from "./popup-request.ts";
import { assertProductionAuth, resolveAuthSurface } from "./runtime.ts";

describe("auth popup host", () => {
  it("refuses a spoofed X-Forwarded-Host and does not enter sandbox mode", () => {
    const markerBefore = process.env.GROK_PREVIEW_HOST;
    const sandboxBefore = process.env.GROK_SANDBOX_HOST;
    const request = createAuthPopupRequest(
      {
        "x-forwarded-host": "attacker.grok-sandbox.com",
        host: "localhost:8080",
        "x-forwarded-proto": "https",
      },
      "/auth/popup?providerId=grok-google",
    );
    assert.equal(process.env.GROK_PREVIEW_HOST, markerBefore);
    assert.equal(process.env.GROK_SANDBOX_HOST, sandboxBefore);
    assert.equal(new URL(request.url).hostname, "attacker.grok-sandbox.com");

    const env = {
      NODE_ENV: "development",
      GROK_PREVIEW_CLIENT_SECRET: "sandbox-secret",
      HOST: "attacker.grok-sandbox.com",
      "x-forwarded-host": "attacker.grok-sandbox.com",
      "X-Forwarded-Host": "attacker.grok-sandbox.com",
    };
    assert.equal(isGrokSandbox(env), false);
    const surface = resolveAuthSurface(env);
    assert.equal(surface.sandbox, false);
    assert.notEqual(surface.clientId, PREVIEW_CLIENT_ID);
    assert.throws(() => assertProductionAuth(env), /Refusing to start auth outside the Grok sandbox/);

    const vite = readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");
    const popup = readFileSync(new URL("./popup-request.ts", import.meta.url), "utf8");
    assert.equal(/process\.env\.GROK_(PREVIEW|SANDBOX)_HOST\s*=/.test(vite), false);
    assert.equal(/process\.env\.GROK_(PREVIEW|SANDBOX)_HOST\s*=/.test(popup), false);
    assert.match(vite, /createAuthPopupRequest/);
  });
});
