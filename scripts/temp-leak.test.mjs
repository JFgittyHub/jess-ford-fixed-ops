import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SUITES = [
  "scripts/brand-check.test.mjs",
  "scripts/write-atomic.test.mjs",
  "scripts/with-app-env.test.mjs",
  "scripts/check-auth-invariant.test.mjs",
  "scripts/migration-plan.test.mjs",
  "scripts/grok-pwa-plugin.test.mjs",
];

test("script suites leave no temp directories", () => {
  const scratch = mkdtempSync(join(tmpdir(), "temp-leak-probe-"));
  try {
    const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_CHANNEL") || key === "NODE_TEST_CONTEXT") delete env[key];
    }
    const run = spawnSync(process.execPath, ["--test", ...SUITES], {
      cwd: dirname(dirname(fileURLToPath(import.meta.url))),
      env,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /# pass [1-9]/);
    assert.deepEqual(readdirSync(scratch), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
