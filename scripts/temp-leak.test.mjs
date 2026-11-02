import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const FILES = [
  "brand-check.test.mjs",
  "write-atomic.test.mjs",
  "with-app-env.test.mjs",
  "check-auth-invariant.test.mjs",
  "migration-plan.test.mjs",
  "grok-pwa-plugin.test.mjs",
];

test("script suites remove their temp directories", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /rmSync\(/, file);
    assert.match(source, /test\.after\(/, file);
  }
});

