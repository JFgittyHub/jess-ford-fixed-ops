import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import guard from "../../../server/plugins/auth-guard.ts";

const KEYS = [
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "GROK_PROJECT_ID",
  "GROK_PREVIEW_HOST",
  "GROK_SANDBOX_HOST",
  "VITE_AUTH_ENABLED",
  "GROK_AUTH_CLIENT_ID",
  "GROK_AUTH_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GROK_PREVIEW_CLIENT_SECRET",
] as const;

const previous: Record<string, string | undefined> = {};

function remember() {
  for (const key of KEYS) previous[key] = process.env[key];
}

function restore() {
  for (const key of KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("auth boot guard", () => {
  afterEach(() => {
    restore();
  });

  it("throws at server boot when production auth settings are missing", () => {
    remember();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.GROK_PROJECT_ID;
    delete process.env.GROK_PREVIEW_HOST;
    delete process.env.GROK_SANDBOX_HOST;
    delete process.env.GROK_AUTH_CLIENT_ID;
    delete process.env.GROK_AUTH_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.GROK_PREVIEW_CLIENT_SECRET;
    assert.throws(() => guard({} as never), /Refusing to start auth outside the Grok sandbox/);
  });

  it("boots when the preview host marks the Grok sandbox", () => {
    remember();
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.GROK_PROJECT_ID;
    process.env.GROK_PREVIEW_HOST = "session.grok-sandbox.com";
    delete process.env.GROK_AUTH_CLIENT_ID;
    delete process.env.GROK_AUTH_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    assert.doesNotThrow(() => guard({} as never));
  });
});
