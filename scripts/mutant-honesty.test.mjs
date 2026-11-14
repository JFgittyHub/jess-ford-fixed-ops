import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("the mutant runner says the corpus is not here and does not invent a kill rate", () => {
  const run = spawnSync(process.execPath, ["scripts/mutant-run.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  const output = `${run.stdout}\n${run.stderr}`;
  assert.match(output, /not in this repository/);
  assert.match(output, /does not invent a new percentage/);
  assert.equal(/kill rate[^\\n]*100%/.test(output), false);
  assert.equal(run.status, 0);
});
