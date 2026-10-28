import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewClientSecretFromEnv } from "./preview.ts";

describe("preview OAuth client", () => {
  it("reads the sandbox secret from the environment and ignores blanks", () => {
    assert.equal(previewClientSecretFromEnv({}), undefined);
    assert.equal(previewClientSecretFromEnv({ GROK_PREVIEW_CLIENT_SECRET: "  " }), undefined);
    assert.equal(previewClientSecretFromEnv({ GROK_PREVIEW_CLIENT_SECRET: "injected" }), "injected");
  });
});
