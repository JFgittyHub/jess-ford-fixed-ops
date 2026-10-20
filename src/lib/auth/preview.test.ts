import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PREVIEW_CLIENT_ID, previewClientSecretFromEnv, resolveBrokerClient } from "./preview.ts";

describe("preview OAuth client", () => {
  it("reads the sandbox secret from the environment and ignores blanks", () => {
    assert.equal(previewClientSecretFromEnv({}), undefined);
    assert.equal(previewClientSecretFromEnv({ GROK_PREVIEW_CLIENT_SECRET: "  " }), undefined);
    assert.equal(previewClientSecretFromEnv({ GROK_PREVIEW_CLIENT_SECRET: "injected" }), "injected");
  });

  it("uses the preview client only when the app is not deployed", () => {
    const preview = resolveBrokerClient({
      deployed: false,
      previewClientSecret: "sandbox-secret",
    });
    assert.equal(preview.clientId, PREVIEW_CLIENT_ID);
    assert.equal(preview.clientSecret, "sandbox-secret");
  });

  it("fails closed in production when the per-app secret is missing", () => {
    const deployed = resolveBrokerClient({
      deployed: true,
      previewClientSecret: "sandbox-secret",
    });
    assert.equal(deployed.clientId, undefined);
    assert.equal(deployed.clientSecret, undefined);
  });

  it("prefers the per-app client over the preview secret", () => {
    const deployed = resolveBrokerClient({
      deployed: true,
      authClientId: "app-client",
      authClientSecret: "app-secret",
      previewClientSecret: "sandbox-secret",
    });
    assert.deepEqual(
      { clientId: deployed.clientId, clientSecret: deployed.clientSecret },
      { clientId: "app-client", clientSecret: "app-secret" },
    );
  });
});
