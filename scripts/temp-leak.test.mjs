import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { test } from "node:test";

const PREFIXES = ["brand-check-", "auth-invariant-", "grok-og-", "auth-schema-", "app-env-", "write-atomic-"];

test("script suites leave no temp directories in /tmp", () => {
  const before = new Set(readdirSync("/tmp").filter((name) => PREFIXES.some((prefix) => name.startsWith(prefix))));
  const run = spawnSync(process.execPath, ["--test", "scripts/brand-check.test.mjs", "scripts/write-atomic.test.mjs", "scripts/with-app-env.test.mjs", "scripts/check-auth-invariant.test.mjs", "scripts/migration-plan.test.mjs", "scripts/grok-pwa-plugin.test.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const after = readdirSync("/tmp").filter((name) => PREFIXES.some((prefix) => name.startsWith(prefix)) && !before.has(name));
  assert.deepEqual(after, []);
});
